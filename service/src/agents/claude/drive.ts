import { randomUUID, type UUID } from 'node:crypto';
import type {
  CanUseTool,
  HookCallbackMatcher,
  Options,
  PermissionMode,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentModels,
  ApprovalMode,
  Attachment,
  ChatId,
  ChatSettings,
  TokenUse,
} from '@grimoire/contract';
import type { ChatEvents, LiveChat } from '../adapter';
import { CacheTracker, type ReplyUsage } from './cache';
import { readUserSettings } from './effort';
import type { FollowUpsKept } from './follow-ups';
import type { MessageQueue } from './message-queue';
import { ASK_TOOL, alwaysAllowOf, toClaudeAnswers, toQuestions } from './permissions';
import { sdk } from './probe';
import { readOnlyHooks } from './read-only';
import { withReferences } from './references';
import { generatedTitle, title } from './saved-chats';
import { type AgentToolInput, type PickerSources, RATER_PROMPT, pickFor } from './subagents';
import { ClaudeTranscript } from './transcript';

// Claude Code leaves the thinking out unless asked for its summary, which the page shows.
export const CLI_ARGS = { 'thinking-display': 'summarized' };

export const MODES: Record<ApprovalMode, PermissionMode> = {
  ask: 'default',
  'accept-edits': 'acceptEdits',
  plan: 'plan',
  'allow-all': 'auto',
};

/** How long a subagent waits for its model to be picked before it runs as it would have. */
export const PICK_TIMEOUT_S = 30;

/** A promise you settle from outside. */
export class Deferred<T> {
  resolve!: (value: T) => void;
  readonly promise = new Promise<T>((resolve) => (this.resolve = resolve));
}

/** What a live query needs besides its messages: where they go, and what it asks of the adapter. */
export interface Drive {
  chatId: ChatId;
  settings: ChatSettings;
  started: Promise<Query>;
  input: MessageQueue<SDKUserMessage>;
  events: ChatEvents;
  /** Settled here, for the process's hook that picks each subagent's model. */
  picking: Deferred<PickerSources>;
  /** Where the process's tool keeps the separate tasks it offered. */
  followUps: FollowUpsKept;
  /** Claude Code's models, against which a subagent's is picked. */
  models: () => Promise<AgentModels>;
  /** The model that rates a subagent's task. */
  quickModel: () => string;
}

/** Follows a live query: its messages become the chat's events. */
export function drive({
  chatId,
  settings,
  started,
  input,
  events,
  picking,
  followUps,
  models,
  quickModel,
}: Drive): LiveChat {
  // The model and effort the chat runs at now, against which a subagent's is picked.
  const current = { model: settings.model, effort: settings.effort };
  let definitions: Promise<{ name: string; model?: string }[]> | undefined;
  picking.resolve({
    settings: () => current,
    models,
    definitions: () => (definitions ??= started.then((live) => live.supportedAgents())),
    rate: (task, signal) => rate(RATER_PROMPT, task, quickModel(), signal),
    env: { ...process.env, ...userSettingsEnv() },
  });
  const transcript = new ClaudeTranscript(true, events);
  const cache = new CacheTracker();
  // Claude Code names a new chat during its first turn: looked for as each reply comes, one read at a time, until it has.
  let named = false;
  let naming = false;
  const lookForName = () => {
    if (named || naming) return;
    naming = true;
    generatedTitle(chatId, settings.cwd)
      .then(
        (title) => {
          if (!title) return;
          named = true;
          events.title(title);
        },
        () => {},
      )
      .finally(() => (naming = false));
  };
  void (async () => {
    try {
      const live = await started;
      for await (const message of live) {
        transcript.apply(message);
        // At most one a turn, after its result.
        if (message.type === 'prompt_suggestion') events.suggestion(message.suggestion);
        if (message.type === 'assistant' && message.parent_tool_use_id === null) {
          cache.reply(message.message.usage as ReplyUsage, Date.now());
          lookForName();
        }
        if (message.type === 'system' && message.subtype === 'compact_boundary')
          cache.compacted(Date.now(), message.compact_metadata.post_tokens);
        if (message.type !== 'result') continue;
        events.turnEnded(resultError(message));
        // What the turn offered shows once it ended, unless the next has begun.
        const offered = followUps.take();
        if (offered?.length) events.followUps(offered);
        if (cache.cache) events.cache(cache.cache);
        live.getContextUsage({ detail: 'summary' }).then(
          (usage) => {
            events.context({ used: usage.totalTokens, limit: usage.rawMaxTokens });
            // A compaction that didn't say how long its summary is shows it only here.
            if (cache.measured(usage.totalTokens)) events.cache(cache.cache!);
          },
          () => {},
        );
        // Claude Code names the chat after its first turns.
        title(chatId, settings.cwd).then(events.title, () => {});
      }
      events.closed();
    } catch (error) {
      events.closed(error instanceof Error ? error.message : String(error));
    }
  })();

  return {
    send: (text, id, attachments = []) =>
      input.push(userMessage(text, id, attachments, settings.cwd)),
    interrupt: async () => {
      await (await started).interrupt();
    },
    // The MCP servers change when the hub starts the process again.
    configure: async ({ model, mode, effort }) => {
      const live = await started;
      if (model) await live.setModel(model);
      if (effort) await live.applyFlagSettings({ effortLevel: effort });
      if (model) current.model = model;
      if (effort) current.effort = effort;
      if (mode) await live.setPermissionMode(MODES[mode]);
    },
    undo: async (entryId) => {
      const result = await (await started).rewindFiles(entryId);
      if (!result.canRewind) throw new Error(result.error ?? "Claude Code can't undo this message");
    },
    close: () => {
      input.end();
      void started.then((live) => live.close());
    },
  };
}

/**
 * A chat's hooks, once the chat whose process this is is known: each
 * subagent's model and effort picked for its task, as `sources` says, and
 * no edits while the chat only reads, as `events` say.
 */
export function chatHooks(
  sources: () => Promise<PickerSources>,
  events: () => Promise<ChatEvents>,
): Options['hooks'] {
  return { PreToolUse: [subagentHook(sources), readOnlyHooks(events)] };
}

/** Asks the chat's events for each approval, and answers Claude Code the way it expects. */
export function approvalsTo(events: () => Promise<ChatEvents>): CanUseTool {
  return async (tool, toolInput, { signal, suggestions, title, toolUseID }) => {
    const asks = tool === ASK_TOOL;
    const alwaysAllow = asks ? undefined : alwaysAllowOf(suggestions);
    const verdict = await (
      await events()
    ).approval(
      {
        id: toolUseID ?? randomUUID(),
        tool,
        input: toolInput,
        ...(title ? { title } : {}),
        ...(alwaysAllow ? { alwaysAllow } : {}),
        ...(asks ? { questions: toQuestions(toolInput) } : {}),
      },
      signal,
    );
    if (verdict === 'deny') return { behavior: 'deny', message: 'The user declined this.' };
    if (typeof verdict === 'object')
      return {
        behavior: 'allow',
        updatedInput: { ...toolInput, answers: toClaudeAnswers(toolInput, verdict.answers) },
      };
    return {
      behavior: 'allow',
      updatedInput: toolInput,
      ...(verdict === 'allow-always' && suggestions ? { updatedPermissions: suggestions } : {}),
    };
  };
}

/**
 * Asks the model, as the prompt says, about a task: what a subagent's or a
 * new chat's first message needs, or anything else Grimoire asks. It runs
 * on a Claude Code process of its own that loads none of your settings,
 * has no tools and saves nothing.
 */
export async function rate(
  prompt: string,
  task: string,
  model: string,
  signal: AbortSignal,
  spent?: (uses: TokenUse[]) => void,
): Promise<string> {
  const { query } = await sdk();
  const abortController = new AbortController();
  if (signal.aborted) abortController.abort();
  signal.addEventListener('abort', () => abortController.abort(), { once: true });
  const rater = query({
    prompt: task,
    options: {
      model,
      systemPrompt: prompt,
      tools: [],
      settingSources: [],
      mcpServers: {},
      strictMcpConfig: true,
      persistSession: false,
      maxTurns: 1,
      thinking: { type: 'disabled' },
      permissionMode: MODES.ask,
      abortController,
    },
  });
  const transcript =
    spent &&
    new ClaudeTranscript(true, {
      entry: () => {},
      text: () => {},
      status: () => {},
      plan: () => {},
      tokens: spent,
    });
  for await (const message of rater) {
    if (message.type === 'result') return message.subtype === 'success' ? message.result : '';
    transcript?.apply(message);
  }
  return '';
}

/**
 * Your message, under its entry's ID: Claude Code keeps it, and undoes by it.
 * Its files go as @-references and its pictures as image blocks, before the
 * text: Claude Code only reads the references when the text comes last.
 */
export function userMessage(
  text: string,
  uuid: string,
  attachments: readonly Attachment[],
  cwd: string,
): SDKUserMessage {
  const written = withReferences(text, attachments, cwd);
  const pictures = attachments.flatMap((attachment) =>
    attachment.kind === 'picture'
      ? [
          {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: attachment.mediaType as 'image/png',
              data: attachment.data,
            },
          },
        ]
      : [],
  );
  return {
    type: 'user',
    // The hub makes entry IDs with randomUUID().
    uuid: uuid as UUID,
    message: {
      role: 'user',
      content: pictures.length
        ? [...pictures, ...(written ? [{ type: 'text' as const, text: written }] : [])]
        : written,
    },
    parent_tool_use_id: null,
  };
}

/**
 * Has each subagent's model and effort picked for its task. A pick that
 * fails, or takes too long, leaves the subagent as Claude Code would run it.
 */
function subagentHook(sources: () => Promise<PickerSources>): HookCallbackMatcher {
  return {
    matcher: 'Agent|Task',
    timeout: PICK_TIMEOUT_S,
    hooks: [
      async (hook, _toolUseId, { signal }) => {
        if (hook.hook_event_name !== 'PreToolUse') return {};
        try {
          const picked = await pickFor(hook.tool_input as AgentToolInput, await sources(), signal);
          return picked
            ? { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...picked } } }
            : {};
        } catch {
          return {};
        }
      },
    ],
  };
}

/** The environment your Claude Code user settings give it, such as CLAUDE_CODE_SUBAGENT_MODEL. */
function userSettingsEnv(): Record<string, string> {
  const { env } = readUserSettings() as { env?: unknown };
  return typeof env === 'object' && env !== null ? (env as Record<string, string>) : {};
}

function resultError(result: Extract<SDKMessage, { type: 'result' }>): string | undefined {
  if (result.subtype === 'success') return result.is_error ? result.result : undefined;
  return result.errors.join('\n') || result.subtype;
}
