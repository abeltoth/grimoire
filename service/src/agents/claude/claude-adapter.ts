import { randomUUID, type UUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import type {
  CanUseTool,
  ModelInfo,
  PermissionMode,
  Query,
  SDKMessage,
  SDKUserMessage,
  SpareProcess,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentCommand,
  AgentInfo,
  AgentMemories,
  AgentModels,
  AgentSetup,
  ApprovalMode,
  ChatId,
  ChatSettings,
  Enclosure,
  Entry,
  PlanUsage,
} from '@grimoire/contract';
import type { AgentAdapter, ChatEvents, ChatHistory, LiveChat, SavedChat } from '../adapter';
import { CacheTracker, type ReplyUsage } from './cache';
import { readUserSettings } from './effort';
import { memorySettings, readMemories } from './memories';
import { MessageQueue } from './message-queue';
import { toAgentModels } from './models';
import { ASK_TOOL, alwaysAllowOf, toClaudeAnswers, toQuestions } from './permissions';
import { withReferences } from './references';
import { commandFiles, readSettingsFile, settingsFilesIn, toSetup } from './setup';
import { ClaudeTranscript, turnEnd } from './transcript';
import { toPlanUsage } from './usage';

// Loaded on first use: it's large, and the service starts without it.
const sdk = () => import('@anthropic-ai/claude-agent-sdk');

// Claude Code keeps its plan with its task tools only when asked to; the Outline shows it.
const ENV = { ...process.env, CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' };

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
  private modelList: Promise<ModelInfo[]> | undefined;
  private readonly commandLists = new Map<string, { at: number; list: Promise<AgentCommand[]> }>();

  readonly info: AgentInfo = {
    id: 'claude-code',
    name: 'Claude Code',
    capabilities: ['rename', 'fork', 'undo', 'compact'],
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
    const cache = new CacheTracker();
    for (const message of await getSessionMessages(chatId, await this.savedIn(chatId, cwd))) {
      // Claude Code saves when each message came, though the SDK's type leaves it out.
      const at = Date.parse((message as { timestamp?: string }).timestamp ?? '');
      transcript.apply(message, at);
      if (message.type === 'assistant' && message.parent_tool_use_id === null && Number.isFinite(at))
        cache.reply((message.message as { usage?: ReplyUsage }).usage, at);
    }
    return {
      entries: transcript.entries,
      plan: transcript.plan,
      ...(cache.cache ? { cache: cache.cache } : {}),
    };
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

  /** The memories Claude Code keeps on its own for a folder, where its settings say. */
  async memories(cwd: string): Promise<AgentMemories> {
    const home = homedir();
    const settings = settingsFilesIn(cwd, home, process.platform).map((file) => readSettingsFile(file));
    return readMemories({
      cwd,
      home,
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
    const started: Promise<Query> = sdk().then(({ query }) =>
      query({
        prompt: input,
        options: {
          cwd: settings.cwd,
          ...(settings.model ? { model: settings.model } : {}),
          ...(settings.effort ? { effort: settings.effort } : {}),
          permissionMode: MODES[settings.mode ?? 'ask'],
          // Lets you pick Full access, now or later; it doesn't skip any asking by itself.
          allowDangerouslySkipPermissions: true,
          includePartialMessages: true,
          // Undo restores files from these checkpoints.
          enableFileCheckpointing: true,
          env: ENV,
          extraArgs: CLI_ARGS,
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
    enclosures: Enclosure[] = [],
  ): Promise<LiveChat> {
    const spare = this.takeSpare();
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
            extraArgs: CLI_ARGS,
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
    const cache = new CacheTracker();
    void (async () => {
      try {
        const live = await started;
        for await (const message of live) {
          transcript.apply(message);
          if (message.type === 'assistant' && message.parent_tool_use_id === null)
            cache.reply(message.message.usage as ReplyUsage, Date.now());
          if (message.type !== 'result') continue;
          events.turnEnded(resultError(message));
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
      configure: async ({ model, mode, effort }) => {
        const live = await started;
        if (model) await live.setModel(model);
        if (effort) await live.applyFlagSettings({ effortLevel: effort });
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
    const usage = await probe.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
      skipBehaviors: true,
    });
    return toPlanUsage(usage, Date.now());
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
  const probe = query({ prompt: input, options: { cwd, permissionMode: MODES.ask, env: ENV } });
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
    const settings = settingsFilesIn(cwd, home, process.platform).map((file) => readSettingsFile(file));
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
        path.join(home, '.claude', 'commands'),
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
