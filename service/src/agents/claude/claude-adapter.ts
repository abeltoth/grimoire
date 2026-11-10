import { randomUUID } from 'node:crypto';
import type { ModelInfo, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentAccount,
  AgentCommand,
  AgentInfo,
  AgentModels,
  ChatId,
  ChatSettings,
  ChatSummary,
  Attachment,
  SubagentRun,
} from '@grimoire/contract';
import type { AgentAdapter, ChatEvents, ChatHistory, LiveChat, SignInRun } from '../adapter';
import type { AgentTool } from '../tools';
import { AUTO_PROMPT, autoPick, messageForRater } from './auto-model';
import {
  CLI_ARGS,
  Deferred,
  MODES,
  PICK_TIMEOUT_S,
  approvalsTo,
  chatHooks,
  drive,
  rate,
} from './drive';
import { readUserSettings } from './effort';
import { FollowUpsKept } from './follow-ups';
import { GRIMOIRE_SERVER, ProcessChat, grimoireOptions } from './grimoire-tools';
import { mcpOff, mcpSettings } from './mcp';
import { MessageQueue } from './message-queue';
import { toAgentModels } from './models';
import { claudeEnv as env, sdk } from './probe';
import * as saved from './saved-chats';
import { readAccount, signIn } from './sign-in';
import { Spares } from './spare';
import { type PickerSources, readRating } from './subagents';

/** How long a folder's commands are kept before Claude Code is asked again. */
const COMMANDS_FRESH_MS = 60_000;

/**
 * Claude Code through the Agent SDK (ADR-005), signed in with the user's
 * own Claude login. One Claude Code process per live chat, and one spare
 * kept parked so a new chat starts at once (ADR-010).
 */
export class ClaudeAdapter implements AgentAdapter {
  private modelList: Promise<ModelInfo[]> | undefined;
  private readonly commandLists = new Map<string, { at: number; list: Promise<AgentCommand[]> }>();
  private readonly spares: Spares;

  /**
   * `mcpOffEverywhere` names the MCP servers turned off in every chat,
   * `suggestions` says whether Claude Code suggests your next message, and
   * `followUps` whether the agent may offer separate tasks, and `tools` the
   * modules' tools, as they are when a process starts.
   */
  constructor(
    private readonly mcpOffEverywhere: () => readonly string[] = () => [],
    private readonly suggestions: () => boolean = () => true,
    private readonly followUps: () => boolean = () => true,
    private readonly tools: () => readonly AgentTool[] = () => [],
  ) {
    this.spares = new Spares({
      agent: this.info.id,
      mcpOff: () => this.mcpOff(),
      suggestions,
      followUps,
      tools,
      models: () => this.models(),
    });
  }

  readonly info: AgentInfo = {
    id: 'claude-code',
    name: 'Claude Code',
    capabilities: ['rename', 'fork', 'undo', 'compact', 'sign-in'],
  };

  listChats(cwd?: string): Promise<ChatSummary[]> {
    return saved.listChats(this.info.id, cwd);
  }

  history(chatId: ChatId, cwd: string): Promise<ChatHistory> {
    return saved.history(chatId, cwd);
  }

  subagent(chatId: ChatId, cwd: string, toolId: string): Promise<SubagentRun> {
    return saved.subagent(chatId, cwd, toolId);
  }

  fork(chatId: ChatId, cwd: string, entryId: string, title: string): Promise<ChatId> {
    return saved.fork(chatId, cwd, entryId, title);
  }

  rename(chatId: ChatId, cwd: string, title: string): Promise<void> {
    return saved.rename(chatId, cwd, title);
  }

  title(chatId: ChatId, cwd: string): Promise<string> {
    return saved.title(chatId, cwd);
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
    const answer = await rate(
      AUTO_PROMPT,
      messageForRater(text),
      AbortSignal.timeout(PICK_TIMEOUT_S * 1000),
    );
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
    const chat = new ProcessChat();
    chat.set({ chatId, agent: this.info.id, cwd: settings.cwd });
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
            tools: this.tools(),
            chat,
          }),
          canUseTool: approvalsTo(async () => events),
          hooks: chatHooks(
            () => picking.promise,
            async () => events,
          ),
        },
      }),
    );
    return drive({
      chatId,
      settings,
      started,
      input,
      events,
      picking,
      followUps,
      models: () => this.models(),
    });
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
    let spare = this.spares.take();
    if (spare && !sameNames(spare.mcpOff, this.mcpOff(settings))) {
      void spare.process.then(
        (process) => process.close(),
        () => {},
      );
      spare = undefined;
    }
    try {
      if (spare)
        return await this.spares.claim(spare, settings, text, id, bind, title, attachments);
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
    this.spares.warm();
  }

  dispose(): void {
    this.spares.dispose();
  }

  /**
   * The MCP servers off for a chat, or for a spare: Grimoire's own tool
   * server is never among them, whatever another server of that name.
   */
  private mcpOff(settings?: ChatSettings): string[] {
    return mcpOff(this.mcpOffEverywhere(), settings).filter((name) => name !== GRIMOIRE_SERVER);
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

/** Whether two sorted lists name the same. */
function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}
