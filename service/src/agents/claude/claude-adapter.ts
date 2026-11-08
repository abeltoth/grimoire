import { randomUUID, type UUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import type {
  CanUseTool,
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
  AgentMemories,
  AgentModels,
  AgentSetup,
  ApprovalMode,
  ChatId,
  ChatSettings,
  Enclosure,
  HelperRun,
  PlanUsage,
  UsageBreakdown,
} from '@grimoire/contract';
import type { AgentAdapter, ChatEvents, ChatHistory, LiveChat, SavedChat, SignInRun } from '../adapter';
import { CacheTracker, type ReplyUsage } from './cache';
import { claudeHome } from './config-dir';
import { readUserSettings } from './effort';
import { FollowUpsKept, savedFollowUps } from './follow-ups';
import { GRIMOIRE_SERVER, grimoireOptions } from './grimoire-tools';
import { mcpOff, mcpSettings } from './mcp';
import { memorySettings, readMemories } from './memories';
import { MessageQueue } from './message-queue';
import { toAgentModels } from './models';
import { ASK_TOOL, alwaysAllowOf, toClaudeAnswers, toQuestions } from './permissions';
import { withReferences } from './references';
import { commandFiles, readSettingsFile, settingsFilesIn, toSetup } from './setup';
import { type AgentToolInput, type PickerSources, RATER_PROMPT, pickFor, readRating } from './subagents';
import { AUTO_PROMPT, autoPick, entryForRater } from './auto-model';
import { readAccount, signIn } from './sign-in';
import { type AddTodo, TodoChat } from './todos';
import {
  type ClaudeMessage,
  ClaudeTranscript,
  helperAgentId,
  helperCallIn,
  runBeganWith,
  savedHelperState,
  turnEnd,
  wholeRun,
} from './transcript';
import { toPlanUsage, toUsageBreakdown } from './usage';

// Loaded on first use: it's large, and the service starts without it.
const sdk = () => import('@anthropic-ai/claude-agent-sdk');

// Claude Code keeps its plan with its task tools only when asked to; the Outline shows it.
// Read at each start, as switching profiles changes which Claude folder it uses.
const env = () => ({ ...process.env, CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' });

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
   * when a process starts. `addTodo` puts a task the agent adds on the
   * Kanban board.
   */
  constructor(
    private readonly mcpOffEverywhere: () => readonly string[] = () => [],
    private readonly suggestions: () => boolean = () => true,
    private readonly followUps: () => boolean = () => true,
    private readonly addTodo: AddTodo = () => {
      throw new Error('There is no Kanban board here');
    },
  ) {}

  readonly info: AgentInfo = {
    id: 'claude-code',
    name: 'Claude Code',
    capabilities: ['rename', 'fork', 'undo', 'compact', 'sign-in'],
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

  async helper(chatId: ChatId, cwd: string, toolId: string): Promise<HelperRun> {
    const { getSessionMessages, getSubagentMessages, listSubagents } = await sdk();
    const saved = await this.savedIn(chatId, cwd);
    const ids = await listSubagents(chatId, saved);
    const runs = new Map<string, Promise<ClaudeMessage[]>>();
    const runOf = (id: string) => {
      if (!runs.has(id)) runs.set(id, getSubagentMessages(chatId, id, saved));
      return runs.get(id)!;
    };
    // The chat made the tool call; a helper's helper is started from inside its run.
    let call = helperCallIn(await getSessionMessages(chatId, saved), toolId);
    for (const id of ids) {
      if (call) break;
      call = helperCallIn(await runOf(id), toolId);
    }
    // Its result names the run; a result that doesn't, the run that began with its task.
    let agentId = call?.result && helperAgentId(call.result.text);
    // A message sent to a helper names it as its recipient.
    if (!agentId && call?.sentTo && ids.includes(call.sentTo)) agentId = call.sentTo;
    if (!agentId && call?.prompt) {
      for (const id of ids) {
        if (runBeganWith(await runOf(id), call.prompt)) {
          agentId = id;
          break;
        }
      }
    }
    if (!agentId) return { entries: [], ...(call ? { state: savedHelperState([], call.result) } : {}) };
    // A message resumed the helper's run: all of it shows, where it is with what it was sent last.
    if (call?.sentTo) {
      const entries = wholeRun(await runOf(agentId));
      const since = entries.findLastIndex((entry) => entry.kind === 'user') + 1;
      return { entries, state: savedHelperState(entries.slice(since), call.result) };
    }
    const run = new ClaudeTranscript(false);
    for (const message of await runOf(agentId)) run.applyRun(message);
    // Its task is the tool call's input; what it was sent later isn't yours.
    const entries = run.entries.filter((entry) => entry.kind === 'agent');
    return { entries, state: savedHelperState(entries, call?.result) };
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

  /**
   * Where to look for a saved chat: its folder, or every folder when it was
   * saved under another. A chat forked into a worktree is saved under the
   * folder it was forked from; Claude Code looks there from the worktree's
   * top, but not from a folder inside it.
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
   * Auto: Haiku reads a new chat's first entry and says which model and
   * effort will do it well; undefined when it can't say in time, or names
   * a model Claude Code doesn't offer.
   */
  async pickModel(text: string): Promise<Pick<ChatSettings, 'model' | 'effort'> | undefined> {
    const answer = await rate(AUTO_PROMPT, entryForRater(text), AbortSignal.timeout(PICK_TIMEOUT_S * 1000));
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

  usage(): Promise<PlanUsage> {
    return readUsage();
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

  /** What Claude Code's own scan of its transcripts says took the plan's usage, as /usage shows it. */
  usageBreakdown(): Promise<UsageBreakdown | null> {
    return readBreakdown();
  }

  /** The memories Claude Code keeps on its own for a folder, where its settings say. */
  async memories(cwd: string): Promise<AgentMemories> {
    const home = homedir();
    const claudeFolder = claudeHome();
    const settings = settingsFilesIn(cwd, claudeFolder, process.platform).map((file) =>
      readSettingsFile(file),
    );
    return readMemories({
      cwd,
      claudeFolder,
      settings: memorySettings(
        settings.map(({ source, settings: own }) => ({
          source: source as 'user' | 'project' | 'local' | 'managed',
          settings: own,
        })),
        home,
      ),
      at: Date.now(),
    });
  }

  /** What Claude Code loads in a folder: its memory, skills, subagents, commands, hooks, MCP servers, plugins and permissions. */
  setup(cwd: string): Promise<AgentSetup> {
    return readSetup(cwd);
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
            todos: { chat: todoChat, add: this.addTodo },
          }),
          canUseTool: approvalsTo(async () => events),
          hooks: subagentHooks(() => picking.promise),
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
    enclosures: Enclosure[] = [],
  ): Promise<LiveChat> {
    let spare = this.takeSpare();
    if (spare && !sameNames(spare.mcpOff, this.mcpOff(settings))) {
      void spare.process.then((process) => process.close(), () => {});
      spare = undefined;
    }
    try {
      if (spare) return await this.claim(spare, settings, text, id, bind, title, enclosures);
    } catch {
      // Refused, or the spare died: start the usual way.
    } finally {
      this.warm();
    }
    const chatId = randomUUID();
    const live = this.run(chatId, settings, false, bind(chatId), title);
    live.send(text, id, enclosures);
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
              todos: { chat: todoChat, add: this.addTodo },
            }),
            canUseTool: approvalsTo(() => claimedBy.promise),
            hooks: subagentHooks(() => picking.promise),
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
    enclosures: Enclosure[],
  ): Promise<LiveChat> {
    const process = await spare.process;
    const input = new MessageQueue<SDKUserMessage>();
    input.push(userMessage(text, id, enclosures, settings.cwd));
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
    void (async () => {
      try {
        const live = await started;
        for await (const message of live) {
          transcript.apply(message);
          // At most one a turn, after its result.
          if (message.type === 'prompt_suggestion') events.suggestion(message.suggestion);
          if (message.type === 'assistant' && message.parent_tool_use_id === null)
            cache.reply(message.message.usage as ReplyUsage, Date.now());
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
      send: (text, id, enclosures = []) =>
        input.push(userMessage(text, id, enclosures, settings.cwd)),
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
        if (!result.canRewind) throw new Error(result.error ?? "Claude Code can't undo this entry");
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
 * Has each subagent's model and effort picked for its task, once the chat
 * whose process this is is known, as `sources` says. A pick that fails, or
 * takes too long, leaves the subagent as Claude Code would run it.
 */
function subagentHooks(sources: () => Promise<PickerSources>): Options['hooks'] {
  return {
    PreToolUse: [
      {
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
      },
    ],
  };
}

/**
 * Asks Haiku, as the prompt says, what a task needs: a subagent's, or a new
 * chat's first entry. It runs on a Claude Code process of its own that
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

/** Asks a Claude Code process that never gets a message what /usage shows of the plan's limits. */
async function readUsage(): Promise<PlanUsage> {
  const { query } = await sdk();
  const input = new MessageQueue<SDKUserMessage>();
  const probe = query({ prompt: input, options: { permissionMode: MODES.ask } });
  try {
    // Experimental in the SDK: its name and answer may change in any release.
    const [usage, account] = await Promise.all([
      probe.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
      // Whose limits they are, so each account's history is kept apart.
      probe.accountInfo().catch(() => undefined),
    ]);
    const plan = toPlanUsage(usage, Date.now());
    return account?.email ? { ...plan, account: account.email } : plan;
  } finally {
    input.end();
    probe.close();
  }
}

/** Asks a Claude Code process that never gets a message what /usage shows of where the plan's usage went. */
async function readBreakdown(): Promise<UsageBreakdown | null> {
  const { query } = await sdk();
  const input = new MessageQueue<SDKUserMessage>();
  const probe = query({ prompt: input, options: { permissionMode: MODES.ask } });
  try {
    // Experimental in the SDK: its name and answer may change in any release.
    const usage = await probe.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
      skipBehaviors: false,
    });
    return toUsageBreakdown(usage, Date.now());
  } finally {
    input.end();
    probe.close();
  }
}

/** How long to wait for MCP servers to connect before listing what they bring. */
const MCP_SETTLE_MS = 5_000;

/**
 * Asks a Claude Code process in the folder that never gets a message what
 * it loads, waiting a moment for its MCP servers to connect, and reads the
 * hooks and permission rules from the settings files it reads.
 */
async function readSetup(cwd: string): Promise<AgentSetup> {
  const { query } = await sdk();
  const input = new MessageQueue<SDKUserMessage>();
  const probe = query({ prompt: input, options: { cwd, permissionMode: MODES.ask, env: env() } });
  try {
    const since = Date.now();
    let mcpServers = await probe.mcpServerStatus();
    while (mcpServers.some((server) => server.status === 'pending') && Date.now() - since < MCP_SETTLE_MS) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      mcpServers = await probe.mcpServerStatus();
    }
    const usage = await probe.getContextUsage({ detail: 'full' });
    const agents = await probe.supportedAgents();
    const commands = await probe.supportedCommands();
    const { skills } = await probe.reloadSkills();
    const { plugins } = await probe.reloadPlugins();
    const home = homedir();
    const claudeFolder = claudeHome();
    const settings = settingsFilesIn(cwd, claudeFolder, process.platform).map((file) =>
      readSettingsFile(file),
    );
    const pluginHooks = plugins
      .filter((plugin) => plugin.path !== 'builtin')
      .map((plugin) =>
        readSettingsFile(
          { source: 'plugin', path: path.join(plugin.path, 'hooks', 'hooks.json') },
          plugin.name,
        ),
      )
      .filter((file) => file.exists);
    return toSetup({
      cwd,
      home,
      answers: { usage, mcpServers, agents, commands, skills, plugins },
      settings,
      pluginHooks,
      commandFiles: commandFiles([
        path.join(cwd, '.claude', 'commands'),
        path.join(claudeFolder, 'commands'),
      ]),
      at: Date.now(),
    });
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
  enclosures: readonly Enclosure[],
  cwd: string,
): SDKUserMessage {
  const written = withReferences(text, enclosures, cwd);
  const pictures = enclosures.flatMap((enclosure) =>
    enclosure.kind === 'picture'
      ? [
          {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: enclosure.mediaType as 'image/png',
              data: enclosure.data,
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
