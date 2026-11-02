import { randomUUID, type UUID } from 'node:crypto';
import type {
  CanUseTool,
  PermissionMode,
  Query,
  SDKMessage,
  SDKUserMessage,
  SpareProcess,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentCommand,
  AgentInfo,
  AgentModels,
  ApprovalMode,
  ChatId,
  ChatSettings,
  Entry,
} from '@grimoire/contract';
import type { AgentAdapter, ChatEvents, ChatHistory, LiveChat, SavedChat } from '../adapter';
import { MessageQueue } from './message-queue';
import { ASK_TOOL, alwaysAllowOf, toClaudeAnswers, toQuestions } from './permissions';
import { ClaudeTranscript, turnEnd } from './transcript';

// Loaded on first use: it's large, and the service starts without it.
const sdk = () => import('@anthropic-ai/claude-agent-sdk');

// Claude Code keeps its plan with its task tools only when asked to; the Outline shows it.
const ENV = { ...process.env, CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' };

/** How long a folder's commands are kept before Claude Code is asked again. */
const COMMANDS_FRESH_MS = 60_000;

const MODES: Record<ApprovalMode, PermissionMode> = {
  ask: 'default',
  'accept-edits': 'acceptEdits',
  plan: 'plan',
  'allow-all': 'bypassPermissions',
};

/** A parked Claude Code process, and where its approvals go once a chat claims it. */
interface Spare {
  process: Promise<SpareProcess>;
  claimedBy: Deferred<ChatEvents>;
}

/**
 * Claude Code through the Agent SDK (ADR-005), signed in with the user's
 * own Claude login. One Claude Code process per live chat, and one spare
 * kept parked so a new chat starts at once (ADR-010).
 */
export class ClaudeAdapter implements AgentAdapter {
  private spare: Spare | undefined;
  private modelList: Promise<AgentModels> | undefined;
  private readonly commandLists = new Map<string, { at: number; list: Promise<AgentCommand[]> }>();

  readonly info: AgentInfo = {
    id: 'claude-code',
    name: 'Claude Code',
    capabilities: ['rename', 'fork', 'undo', 'tags'],
  };

  async listChats(cwd?: string): Promise<SavedChat[]> {
    const { listSessions } = await sdk();
    const sessions = await listSessions(cwd ? { dir: cwd } : undefined);
    return sessions
      .map((session) => ({
        id: session.sessionId,
        agent: this.info.id,
        title: session.customTitle ?? session.summary,
        ...(session.cwd ? { cwd: session.cwd } : {}),
        updatedAt: session.lastModified,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async history(chatId: ChatId, cwd: string): Promise<ChatHistory> {
    const { getSessionMessages } = await sdk();
    const transcript = new ClaudeTranscript(false);
    for (const message of await getSessionMessages(chatId, { dir: cwd })) transcript.apply(message);
    return { entries: transcript.entries, plan: transcript.plan };
  }

  async fork(chatId: ChatId, cwd: string, entryId: string, title: string): Promise<ChatId> {
    const { forkSession, getSessionMessages } = await sdk();
    const upToMessageId = turnEnd(await getSessionMessages(chatId, { dir: cwd }), entryId);
    const { sessionId } = await forkSession(chatId, {
      dir: cwd,
      title,
      ...(upToMessageId ? { upToMessageId } : {}),
    });
    return sessionId;
  }

  async rename(chatId: ChatId, cwd: string, title: string): Promise<void> {
    const { renameSession } = await sdk();
    await renameSession(chatId, title, { dir: cwd });
  }

  async title(chatId: ChatId, cwd: string): Promise<string> {
    const { getSessionInfo } = await sdk();
    const info = await getSessionInfo(chatId, { dir: cwd });
    return info?.customTitle ?? info?.summary ?? '';
  }

  /** Claude Code's model aliases, such as Opus 5.5; the dated model IDs are left out. */
  models(): Promise<AgentModels> {
    this.modelList ??= listModels().catch((error: unknown) => {
      this.modelList = undefined;
      throw error;
    });
    return this.modelList;
  }

  /** Claude Code's commands and skills in a folder, kept for a minute. */
  commands(cwd: string): Promise<AgentCommand[]> {
    const cached = this.commandLists.get(cwd);
    if (cached && Date.now() - cached.at < COMMANDS_FRESH_MS) return cached.list;
    const list = listCommands(cwd).catch((error: unknown) => {
      this.commandLists.delete(cwd);
      throw error;
    });
    this.commandLists.set(cwd, { at: Date.now(), list });
    return list;
  }

  run(
    chatId: ChatId,
    settings: ChatSettings,
    resume: boolean,
    events: ChatEvents,
    title?: string,
  ): LiveChat {
    const input = new MessageQueue<SDKUserMessage>();
    const started: Promise<Query> = sdk().then(({ query }) =>
      query({
        prompt: input,
        options: {
          cwd: settings.cwd,
          ...(settings.model ? { model: settings.model } : {}),
          permissionMode: MODES[settings.mode ?? 'ask'],
          // Lets you pick Full access, now or later; it doesn't skip any asking by itself.
          allowDangerouslySkipPermissions: true,
          includePartialMessages: true,
          // Undo restores files from these checkpoints.
          enableFileCheckpointing: true,
          env: ENV,
          ...(resume ? { resume: chatId } : { sessionId: chatId, ...(title ? { title } : {}) }),
          canUseTool: approvalsTo(async () => events),
        },
      }),
    );
    return this.drive(chatId, settings, started, input, events);
  }

  /**
   * Starts a new chat on the spare process when one is parked; Claude Code
   * then picks the session ID. When there's no spare, or the spare refuses
   * the claim, the chat starts on a process of its own.
   */
  async start(
    settings: ChatSettings,
    text: string,
    id: string,
    bind: (chatId: ChatId) => ChatEvents,
    title?: string,
  ): Promise<LiveChat> {
    const spare = this.takeSpare();
    try {
      if (spare) return await this.claim(spare, settings, text, id, bind, title);
    } catch {
      // Refused, or the spare died: start the usual way.
    } finally {
      this.warm();
    }
    const chatId = randomUUID();
    const live = this.run(chatId, settings, false, bind(chatId), title);
    live.send(text, id);
    return live;
  }

  warm(): void {
    if (this.spare) return;
    const claimedBy = new Deferred<ChatEvents>();
    const spare: Spare = {
      claimedBy,
      process: sdk().then(({ prewarm }) =>
        prewarm({
          options: {
            includePartialMessages: true,
            permissionMode: MODES.ask,
            allowDangerouslySkipPermissions: true,
            enableFileCheckpointing: true,
            env: ENV,
            canUseTool: approvalsTo(() => claimedBy.promise),
          },
        }),
      ),
    };
    this.spare = spare;
    // A spare that fails to start, or dies parked, is dropped; the next chat starts one.
    const drop = () => {
      if (this.spare === spare) this.spare = undefined;
    };
    spare.process.then((process) => process.exited.then(drop), drop);
  }

  dispose(): void {
    const spare = this.takeSpare();
    void spare?.process.then((process) => process.close(), () => {});
  }

  private takeSpare(): Spare | undefined {
    const spare = this.spare;
    this.spare = undefined;
    return spare;
  }

  private async claim(
    spare: Spare,
    settings: ChatSettings,
    text: string,
    id: string,
    bind: (chatId: ChatId) => ChatEvents,
    title?: string,
  ): Promise<LiveChat> {
    const process = await spare.process;
    const input = new MessageQueue<SDKUserMessage>();
    input.push(userMessage(text, id));
    const query = process.claim({
      prompt: input,
      options: {
        cwd: settings.cwd,
        ...(settings.model ? { model: settings.model } : {}),
        permissionMode: MODES[settings.mode ?? 'ask'],
        ...(title ? { title } : {}),
      },
    });
    let chatId: ChatId;
    try {
      ({ sessionId: chatId } = await process.claimed);
    } catch (error) {
      // Only the model was refused: the chat runs, on the default model.
      const claim = (error as { claim?: { sessionId: string } }).claim;
      if (!(error instanceof Error && error.message.startsWith('option_not_applied') && claim)) {
        process.close();
        throw error;
      }
      chatId = claim.sessionId;
    }
    const events = bind(chatId);
    spare.claimedBy.resolve(events);
    return this.drive(chatId, settings, Promise.resolve(query), input, events);
  }

  /** Follows a live query: its messages become the chat's events. */
  private drive(
    chatId: ChatId,
    settings: ChatSettings,
    started: Promise<Query>,
    input: MessageQueue<SDKUserMessage>,
    events: ChatEvents,
  ): LiveChat {
    const transcript = new ClaudeTranscript(true, events);
    void (async () => {
      try {
        const live = await started;
        for await (const message of live) {
          transcript.apply(message);
          if (message.type !== 'result') continue;
          events.turnEnded(resultError(message));
          live.getContextUsage({ detail: 'summary' }).then(
            (usage) => events.context({ used: usage.totalTokens, limit: usage.rawMaxTokens }),
            () => {},
          );
          // Claude Code names the chat after its first turns.
          this.title(chatId, settings.cwd).then(events.title, () => {});
        }
        events.closed();
      } catch (error) {
        events.closed(error instanceof Error ? error.message : String(error));
      }
    })();

    return {
      send: (text, id) => input.push(userMessage(text, id)),
      interrupt: async () => {
        await (await started).interrupt();
      },
      configure: async ({ model, mode }) => {
        const live = await started;
        if (model) await live.setModel(model);
        if (mode) await live.setPermissionMode(MODES[mode]);
      },
      undo: async (entryId) => {
        const result = await (await started).rewindFiles(entryId);
        if (!result.canRewind) throw new Error(result.error ?? "Claude Code can't undo this entry");
      },
      close: () => {
        input.end();
        void started.then((live) => live.close());
      },
    };
  }
}

/** Asks a Claude Code process that never gets a message for the models it offers. */
async function listModels(): Promise<AgentModels> {
  const { query } = await sdk();
  const input = new MessageQueue<SDKUserMessage>();
  const probe = query({ prompt: input, options: { permissionMode: MODES.ask } });
  try {
    const all = await probe.supportedModels();
    const aliases = all.filter(({ value }) => value !== 'default' && !value.startsWith('claude-'));
    const fallback = all.find(({ value }) => value === 'default')?.resolvedModel;
    const byDefault = aliases.find(({ resolvedModel }) => resolvedModel === fallback);
    return {
      models: aliases.map(({ value, displayName, description }) => ({
        id: value,
        name: displayName,
        description,
      })),
      ...(byDefault ? { default: byDefault.value } : {}),
    };
  } finally {
    input.end();
    probe.close();
  }
}

/** Asks a Claude Code process in the folder that never gets a message for its commands and skills. */
async function listCommands(cwd: string): Promise<AgentCommand[]> {
  const { query } = await sdk();
  const input = new MessageQueue<SDKUserMessage>();
  const probe = query({ prompt: input, options: { cwd, permissionMode: MODES.ask, env: ENV } });
  try {
    const all = await probe.supportedCommands();
    const skills = new Set((await probe.reloadSkills()).skills.map((skill) => skill.name));
    const seen = new Set<string>();
    return all.flatMap(({ name, description, argumentHint }): AgentCommand[] => {
      // Names with two underscores are Claude Code's own plumbing; a name listed twice runs the first.
      if (name.startsWith('__') || seen.has(name)) return [];
      seen.add(name);
      return [
        {
          name,
          description,
          ...(argumentHint ? { argumentHint } : {}),
          kind: skills.has(name) ? 'skill' : 'command',
        },
      ];
    });
  } finally {
    input.end();
    probe.close();
  }
}

/** A promise you settle from outside. */
class Deferred<T> {
  resolve!: (value: T) => void;
  readonly promise = new Promise<T>((resolve) => (this.resolve = resolve));
}

/** Your message, under its entry's ID: Claude Code keeps it, and undoes by it. */
function userMessage(text: string, uuid: string): SDKUserMessage {
  // The hub makes entry IDs with randomUUID().
  return {
    type: 'user',
    uuid: uuid as UUID,
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
  };
}

/** Asks the chat's events for each approval, and answers Claude Code the way it expects. */
function approvalsTo(events: () => Promise<ChatEvents>): CanUseTool {
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

function resultError(result: Extract<SDKMessage, { type: 'result' }>): string | undefined {
  if (result.subtype === 'success') return result.is_error ? result.result : undefined;
  return result.errors.join('\n') || result.subtype;
}
