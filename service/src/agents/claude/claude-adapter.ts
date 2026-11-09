import { randomUUID, type UUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import type {
  CanUseTool,
  HookCallbackMatcher,
  ModelInfo,
  Options,
  PermissionMode,
  Query,
  SDKMessage,
  SDKUserMessage,
  SpareProcess,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentAccount,
  AgentCommand,
  AgentInfo,
  AgentModels,
  ApprovalMode,
  ChatId,
  ChatSettings,
  ChatSummary,
  Attachment,
  SubagentRun,
} from '@grimoire/contract';
import type { AgentAdapter, ChatEvents, ChatHistory, LiveChat, SignInRun } from '../adapter';
import { CacheTracker, type ReplyUsage } from './cache';
import { claudeHome } from './config-dir';
import { readUserSettings } from './effort';
import { FollowUpsKept, savedFollowUps } from './follow-ups';
import { GRIMOIRE_SERVER, grimoireOptions } from './grimoire-tools';
import { mcpOff, mcpSettings } from './mcp';
import { MessageQueue } from './message-queue';
import { toAgentModels } from './models';
import { claudeEnv as env, sdk } from './probe';
import { ASK_TOOL, alwaysAllowOf, toClaudeAnswers, toQuestions } from './permissions';
import { readOnlyHooks } from './read-only';
import { withReferences } from './references';
import { type AgentToolInput, type PickerSources, RATER_PROMPT, pickFor, readRating } from './subagents';
import { AUTO_PROMPT, autoPick, messageForRater } from './auto-model';
import { readAccount, signIn } from './sign-in';
import { type AddTodo, TodoChat } from './todos';
import {
  type ClaudeMessage,
  ClaudeTranscript,
  subagentAgentId,
  subagentCallIn,
  runBeganWith,
  savedSubagentState,
  turnEnd,
  wholeRun,
} from './transcript';

// Claude Code leaves the thinking out unless asked for its summary, which the page shows.
const CLI_ARGS = { 'thinking-display': 'summarized' };

/** How long a folder's commands are kept before Claude Code is asked again. */
const COMMANDS_FRESH_MS = 60_000;

const MODES: Record<ApprovalMode, PermissionMode> = {
  ask: 'default',
  'accept-edits': 'acceptEdits',
  plan: 'plan',
  'allow-all': 'auto',
};

/** How long a subagent waits for its model to be picked before it runs as it would have. */
const PICK_TIMEOUT_S = 30;

/**
 * A parked Claude Code process, and where its approvals go, and its
 * subagents' models are picked, once a chat claims it.
 */
interface Spare {
  process: Promise<SpareProcess>;
  claimedBy: Deferred<ChatEvents>;
  picking: Deferred<PickerSources>;
  /** The MCP servers kept from starting in it, sorted: a chat with others starts on a process of its own. */
  mcpOff: string[];
  /** Where its tool keeps the separate tasks offered, for the chat that claims it. */
  followUps: FollowUpsKept;
  /** The chat its tool adds cards to the board in: the one that claims it. */
  todoChat: TodoChat;
}

/**
 * Claude Code through the Agent SDK (ADR-005), signed in with the user's
 * own Claude login. One Claude Code process per live chat, and one spare
 * kept parked so a new chat starts at once (ADR-010).
 */
export class ClaudeAdapter implements AgentAdapter {
  private spare: Spare | undefined;
  private modelList: Promise<ModelInfo[]> | undefined;
  private readonly commandLists = new Map<string, { at: number; list: Promise<AgentCommand[]> }>();

  /**
   * `mcpOffEverywhere` names the MCP servers turned off in every chat,
   * `suggestions` says whether Claude Code suggests your next message, and
   * `followUps` whether the agent may offer separate tasks, as they are
   * when a process starts.
   */
  constructor(
    private readonly mcpOffEverywhere: () => readonly string[] = () => [],
    private readonly suggestions: () => boolean = () => true,
    private readonly followUps: () => boolean = () => true,
  ) {}

  private addTodo: AddTodo = () => {
    throw new Error('There is no Kanban board here');
  };

  /** Puts each task the agent adds on the Kanban board with `add`, from processes started before as well. */
  addTodosWith(add: AddTodo): void {
    this.addTodo = add;
  }

  readonly info: AgentInfo = {
    id: 'claude-code',
    name: 'Claude Code',
    capabilities: ['rename', 'fork', 'undo', 'compact', 'sign-in'],
  };

  async listChats(cwd?: string): Promise<ChatSummary[]> {
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
    const { getSessionMessages, getSubagentMessages, listSubagents } = await sdk();
    const transcript = new ClaudeTranscript(false);
    const cache = new CacheTracker();
    const saved = await this.savedIn(chatId, cwd);
    const messages = await getSessionMessages(chatId, saved);
    for (const message of messages) {
      const at = timeOf(message);
      transcript.apply(message, at);
      if (message.type === 'assistant' && message.parent_tool_use_id === null && Number.isFinite(at))
        cache.reply((message.message as { usage?: ReplyUsage }).usage, at);
    }
    // Subagents' runs are saved apart; what they spent counts toward the turns they ran in.
    for (const agentId of await listSubagents(chatId, saved)) {
      for (const message of await getSubagentMessages(chatId, agentId, saved))
        transcript.applySubagent(message, timeOf(message));
    }
    // The cards the last turn offered come back from its call of the tool.
    const followUps = savedFollowUps(messages);
    return {
      entries: transcript.entries,
      plan: transcript.plan,
      ...(cache.cache ? { cache: cache.cache } : {}),
      ...(followUps ? { followUps } : {}),
    };
  }

  async subagent(chatId: ChatId, cwd: string, toolId: string): Promise<SubagentRun> {
    const { getSessionMessages, getSubagentMessages, listSubagents } = await sdk();
    const saved = await this.savedIn(chatId, cwd);
    const ids = await listSubagents(chatId, saved);
    const runs = new Map<string, Promise<ClaudeMessage[]>>();
    const runOf = (id: string) => {
      if (!runs.has(id)) runs.set(id, getSubagentMessages(chatId, id, saved));
      return runs.get(id)!;
    };
    // The chat made the tool call; a subagent's subagent is started from inside its run.
    let call = subagentCallIn(await getSessionMessages(chatId, saved), toolId);
    for (const id of ids) {
      if (call) break;
      call = subagentCallIn(await runOf(id), toolId);
    }
    // Its result names the run; a result that doesn't, the run that began with its task.
    let agentId = call?.result && subagentAgentId(call.result.text);
    // A message sent to a subagent names it as its recipient.
    if (!agentId && call?.sentTo && ids.includes(call.sentTo)) agentId = call.sentTo;
    if (!agentId && call?.prompt) {
      for (const id of ids) {
        if (runBeganWith(await runOf(id), call.prompt)) {
          agentId = id;
          break;
        }
      }
    }
    if (!agentId) return { entries: [], ...(call ? { state: savedSubagentState([], call.result) } : {}) };
    // A message resumed the subagent's run: all of it shows, where it is with what it was sent last.
    if (call?.sentTo) {
      const entries = wholeRun(await runOf(agentId));
      const since = entries.findLastIndex((entry) => entry.kind === 'user') + 1;
      return { entries, state: savedSubagentState(entries.slice(since), call.result) };
    }
    const run = new ClaudeTranscript(false);
    for (const message of await runOf(agentId)) run.applyRun(message);
    // Its task is the tool call's input; what it was sent later isn't yours.
    const entries = run.entries.filter((entry) => entry.kind === 'agent');
    return { entries, state: savedSubagentState(entries, call?.result) };
  }

  async fork(chatId: ChatId, cwd: string, entryId: string, title: string): Promise<ChatId> {
    const { forkSession, getSessionMessages } = await sdk();
    const saved = await this.savedIn(chatId, cwd);
    const upToMessageId = turnEnd(await getSessionMessages(chatId, saved), entryId);
    const { sessionId } = await forkSession(chatId, {
      ...saved,
      title,
      ...(upToMessageId ? { upToMessageId } : {}),
    });
    return sessionId;
  }

  async rename(chatId: ChatId, cwd: string, title: string): Promise<void> {
    const { renameSession } = await sdk();
    await renameSession(chatId, title, await this.savedIn(chatId, cwd));
  }

  async title(chatId: ChatId, cwd: string): Promise<string> {
    const { getSessionInfo } = await sdk();
    const info = await getSessionInfo(chatId, await this.savedIn(chatId, cwd));
    return info?.customTitle ?? info?.summary ?? '';
  }

  /** The title you or Claude Code gave the chat, without falling back on its first prompt; undefined until it has one. */
  private async generatedTitle(chatId: ChatId, cwd: string): Promise<string | undefined> {
    const { getSessionInfo } = await sdk();
    return (await getSessionInfo(chatId, await this.savedIn(chatId, cwd)))?.customTitle || undefined;
  }

  /**
   * Where to look for a saved chat: its folder, or every folder when it was
   * saved under another, as a chat begun in a worktree that now works in
   * its repository's folder is.
   */
  private async savedIn(chatId: ChatId, cwd: string): Promise<{ dir?: string }> {
    const { getSessionInfo } = await sdk();
    return (await getSessionInfo(chatId, { dir: cwd })) ? { dir: cwd } : {};
  }

  /**
   * Claude Code's model aliases, such as Opus 5.5, and their effort levels.
   * The models are asked for once; the default efforts are read from your
   * settings each time, as /effort in a terminal can change them.
   */
  models(): Promise<AgentModels> {
    this.modelList ??= listModels().catch((error: unknown) => {
      this.modelList = undefined;
      throw error;
    });
    return this.modelList.then((all) => toAgentModels(all, readUserSettings()));
  }

  /**
   * Auto: Haiku reads a new chat's first message and says which model and
   * effort will do it well; undefined when it can't say in time, or names
   * a model Claude Code doesn't offer.
   */
  async pickModel(text: string): Promise<Pick<ChatSettings, 'model' | 'effort'> | undefined> {
    const answer = await rate(AUTO_PROMPT, messageForRater(text), AbortSignal.timeout(PICK_TIMEOUT_S * 1000));
    const rating = readRating(answer);
    return rating && autoPick(rating, await this.models());
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

  /** Who Claude Code is signed in as, as `claude auth status` says. */
  account(): Promise<AgentAccount | null> {
    return readAccount();
  }

  /**
   * Signs Claude Code in to another claude.ai account, as /login does, so
   * terminal Claude Code uses it too. Once signed in, what Claude Code said
   * under the last account is asked again, and the spare starts again
   * under the new one.
   */
  signIn(email: string, page: (url: string) => void): SignInRun {
    const run = signIn(email, page);
    return {
      ...run,
      done: run.done.then(() => {
        this.reset();
        this.warm();
      }),
    };
  }

  /**
   * Forgets what Claude Code said, its models and commands, and stops the
   * spare: for when it's signed in to another account, or uses another
   * Claude folder.
   */
  reset(): void {
    this.modelList = undefined;
    this.commandLists.clear();
    this.dispose();
  }

  run(
    chatId: ChatId,
    settings: ChatSettings,
    resume: boolean,
    events: ChatEvents,
    title?: string,
  ): LiveChat {
    const input = new MessageQueue<SDKUserMessage>();
    const picking = new Deferred<PickerSources>();
    const followUps = new FollowUpsKept();
    const todoChat = new TodoChat();
    todoChat.set({ chatId, agent: this.info.id, cwd: settings.cwd });
    const off = this.mcpOff(settings);
    const offered = this.followUps();
    const started: Promise<Query> = sdk().then((made) =>
      made.query({
        prompt: input,
        options: {
          cwd: settings.cwd,
          ...(settings.model ? { model: settings.model } : {}),
          ...(settings.effort ? { effort: settings.effort } : {}),
          permissionMode: MODES[settings.mode ?? 'ask'],
          ...(off.length ? { settings: mcpSettings(off) } : {}),
          // Lets you pick Full access, now or later; it doesn't skip any asking by itself.
          allowDangerouslySkipPermissions: true,
          includePartialMessages: true,
          // Each turn's hooks show on it, as they run.
          includeHookEvents: true,
          // Undo restores files from these checkpoints.
          enableFileCheckpointing: true,
          promptSuggestions: this.suggestions(),
          env: env(),
          extraArgs: CLI_ARGS,
          ...(resume ? { resume: chatId } : { sessionId: chatId, ...(title ? { title } : {}) }),
          ...grimoireOptions(made, {
            ...(offered ? { followUps } : {}),
            todos: { chat: todoChat, add: (draft, madeIn) => this.addTodo(draft, madeIn) },
          }),
          canUseTool: approvalsTo(async () => events),
          hooks: chatHooks(() => picking.promise, async () => events),
        },
      }),
    );
    return this.drive(chatId, settings, started, input, events, picking, followUps);
  }

  /**
   * Starts a new chat on the spare process when one is parked; Claude Code
   * then picks the session ID. When there's no spare, the spare refuses the
   * claim, or it was started with other MCP servers off, the chat starts on
   * a process of its own.
   */
  async start(
    settings: ChatSettings,
    text: string,
    id: string,
    bind: (chatId: ChatId) => ChatEvents,
    title?: string,
    attachments: Attachment[] = [],
  ): Promise<LiveChat> {
    let spare = this.takeSpare();
    if (spare && !sameNames(spare.mcpOff, this.mcpOff(settings))) {
      void spare.process.then((process) => process.close(), () => {});
      spare = undefined;
    }
    try {
      if (spare) return await this.claim(spare, settings, text, id, bind, title, attachments);
    } catch {
      // Refused, or the spare died: start the usual way.
    } finally {
      this.warm();
    }
    const chatId = randomUUID();
    const live = this.run(chatId, settings, false, bind(chatId), title);
    live.send(text, id, attachments);
    return live;
  }

  warm(): void {
    if (this.spare) return;
    const claimedBy = new Deferred<ChatEvents>();
    const picking = new Deferred<PickerSources>();
    const followUps = new FollowUpsKept();
    const todoChat = new TodoChat();
    const off = this.mcpOff();
    const offered = this.followUps();
    const spare: Spare = {
      claimedBy,
      picking,
      mcpOff: off,
      followUps,
      todoChat,
      process: sdk().then((made) =>
        made.prewarm({
          options: {
            includePartialMessages: true,
            includeHookEvents: true,
            permissionMode: MODES.ask,
            ...(off.length ? { settings: mcpSettings(off) } : {}),
            allowDangerouslySkipPermissions: true,
            enableFileCheckpointing: true,
            // Sent as the process starts, so a claim can't change it.
            promptSuggestions: this.suggestions(),
            env: env(),
            extraArgs: CLI_ARGS,
            // Its tools' calls go to the chat that claims it: its separate tasks once its turn ends.
            ...grimoireOptions(made, {
              ...(offered ? { followUps } : {}),
              todos: { chat: todoChat, add: (draft, madeIn) => this.addTodo(draft, madeIn) },
            }),
            canUseTool: approvalsTo(() => claimedBy.promise),
            hooks: chatHooks(() => picking.promise, () => claimedBy.promise),
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

  /**
   * The MCP servers off for a chat, or for a spare: Grimoire's own tool
   * server is never among them, whatever another server of that name.
   */
  private mcpOff(settings?: ChatSettings): string[] {
    return mcpOff(this.mcpOffEverywhere(), settings).filter((name) => name !== GRIMOIRE_SERVER);
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
    title: string | undefined,
    attachments: Attachment[],
  ): Promise<LiveChat> {
    const process = await spare.process;
    const input = new MessageQueue<SDKUserMessage>();
    input.push(userMessage(text, id, attachments, settings.cwd));
    const query = process.claim({
      prompt: input,
      options: {
        cwd: settings.cwd,
        ...(settings.model ? { model: settings.model } : {}),
        permissionMode: MODES[settings.mode ?? 'ask'],
        ...(settings.effort ? { settings: { effortLevel: settings.effort } } : {}),
        ...(title ? { title } : {}),
      },
    });
    let chatId: ChatId;
    try {
      ({ sessionId: chatId } = await process.claimed);
    } catch (error) {
      // Only the model or effort was refused, and the chat runs on the defaults: it carries the claim.
      const claim = (error as { claim?: { sessionId: string } }).claim;
      const refused = error instanceof Error && /^(option|settings)_not_applied/.test(error.message);
      if (!(refused && claim)) {
        process.close();
        throw error;
      }
      chatId = claim.sessionId;
    }
    const events = bind(chatId);
    spare.todoChat.set({ chatId, agent: this.info.id, cwd: settings.cwd });
    spare.claimedBy.resolve(events);
    return this.drive(chatId, settings, Promise.resolve(query), input, events, spare.picking, spare.followUps);
  }

  /** Follows a live query: its messages become the chat's events. */
  private drive(
    chatId: ChatId,
    settings: ChatSettings,
    started: Promise<Query>,
    input: MessageQueue<SDKUserMessage>,
    events: ChatEvents,
    picking: Deferred<PickerSources>,
    followUps: FollowUpsKept,
  ): LiveChat {
    // The model and effort the chat runs at now, against which a subagent's is picked.
    const current = { model: settings.model, effort: settings.effort };
    let definitions: Promise<{ name: string; model?: string }[]> | undefined;
    picking.resolve({
      settings: () => current,
      models: () => this.models(),
      definitions: () => (definitions ??= started.then((live) => live.supportedAgents())),
      rate: (task, signal) => rate(RATER_PROMPT, task, signal),
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
      this.generatedTitle(chatId, settings.cwd)
        .then((title) => {
          if (!title) return;
          named = true;
          events.title(title);
        }, () => {})
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
          if (message.type !== 'result') continue;
          events.turnEnded(resultError(message));
          // What the turn offered shows once it ended, unless the next has begun.
          const offered = followUps.take();
          if (offered?.length) events.followUps(offered);
          if (cache.cache) events.cache(cache.cache);
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
}

/** When a saved message came, in ms since the epoch; Claude Code saves it, though the SDK's type leaves it out. */
function timeOf(message: object): number {
  return Date.parse((message as { timestamp?: string }).timestamp ?? '');
}

/**
 * A chat's hooks, once the chat whose process this is is known: each
 * subagent's model and effort picked for its task, as `sources` says, and
 * no edits while the chat only reads, as `events` say.
 */
function chatHooks(sources: () => Promise<PickerSources>, events: () => Promise<ChatEvents>): Options['hooks'] {
  return { PreToolUse: [subagentHook(sources), readOnlyHooks(events)] };
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

/**
 * Asks Haiku, as the prompt says, what a task needs: a subagent's, or a new
 * chat's first message. It runs on a Claude Code process of its own that
 * loads none of your settings, has no tools and saves nothing.
 */
async function rate(prompt: string, task: string, signal: AbortSignal): Promise<string> {
  const { query } = await sdk();
  const abortController = new AbortController();
  if (signal.aborted) abortController.abort();
  signal.addEventListener('abort', () => abortController.abort(), { once: true });
  const rater = query({
    prompt: task,
    options: {
      model: 'haiku',
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
  for await (const message of rater) {
    if (message.type === 'result') return message.subtype === 'success' ? message.result : '';
  }
  return '';
}

/** The environment your Claude Code user settings give it, such as CLAUDE_CODE_SUBAGENT_MODEL. */
function userSettingsEnv(): Record<string, string> {
  const { env } = readUserSettings() as { env?: unknown };
  return typeof env === 'object' && env !== null ? (env as Record<string, string>) : {};
}

/** Asks a Claude Code process that never gets a message for the models it offers. */
async function listModels(): Promise<ModelInfo[]> {
  const { query } = await sdk();
  const input = new MessageQueue<SDKUserMessage>();
  const probe = query({ prompt: input, options: { permissionMode: MODES.ask } });
  try {
    return await probe.supportedModels();
  } finally {
    input.end();
    probe.close();
  }
}

/** Asks a Claude Code process in the folder that never gets a message for its commands and skills. */
async function listCommands(cwd: string): Promise<AgentCommand[]> {
  const { query } = await sdk();
  const input = new MessageQueue<SDKUserMessage>();
  const probe = query({ prompt: input, options: { cwd, permissionMode: MODES.ask, env: env() } });
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

/**
 * Your message, under its entry's ID: Claude Code keeps it, and undoes by it.
 * Its files go as @-references and its pictures as image blocks, before the
 * text: Claude Code only reads the references when the text comes last.
 */
function userMessage(
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

/** Whether two sorted lists name the same. */
function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}
