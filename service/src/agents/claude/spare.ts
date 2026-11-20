import type { SDKUserMessage, SpareProcess } from '@anthropic-ai/claude-agent-sdk';
import type { AgentId, AgentModels, Attachment, ChatId, ChatSettings } from '@grimoire/contract';
import type { ChatEvents, LiveChat } from '../adapter';
import type { AgentTool } from '../tools';
import { chromeArgs } from './chrome';
import { CLI_ARGS, Deferred, MODES, approvalsTo, chatHooks, drive, userMessage } from './drive';
import { FollowUpsKept } from './follow-ups';
import { ProcessChat, grimoireOptions } from './grimoire-tools';
import { mcpSettings } from './mcp';
import { MessageQueue } from './message-queue';
import { claudeEnv as env, sdk } from './probe';
import type { PickerSources } from './subagents';

/**
 * A parked Claude Code process, and where its approvals go, and its
 * subagents' models are picked, once a chat claims it.
 */
export interface Spare {
  process: Promise<SpareProcess>;
  claimedBy: Deferred<ChatEvents>;
  picking: Deferred<PickerSources>;
  /** The MCP servers kept from starting in it, sorted: a chat with others starts on a process of its own. */
  mcpOff: string[];
  /** Whether it was started connected to Claude in Chrome. */
  chrome: boolean;
  /** Where its tool keeps the separate tasks offered, for the chat that claims it. */
  followUps: FollowUpsKept;
  /** The chat its tools work in: the one that claims it. */
  chat: ProcessChat;
}

/** What a spare starts with, read as it starts, and what the chat that claims it needs. */
export interface SpareSetup {
  agent: AgentId;
  /** The MCP servers off in every chat, sorted, without Grimoire's own. */
  mcpOff: () => string[];
  /** Whether Claude in Chrome is on, read as each process starts. */
  chrome: () => boolean;
  suggestions: () => boolean;
  followUps: () => boolean;
  tools: () => readonly AgentTool[];
  models: () => Promise<AgentModels>;
  /** The model that rates a subagent's task. */
  quickModel: () => string;
}

/** The one Claude Code process kept parked, so a new chat starts at once. */
export class Spares {
  private spare: Spare | undefined;

  constructor(private readonly setup: SpareSetup) {}

  /** Parks a spare, unless one is parked already. */
  warm(): void {
    if (this.spare) return;
    const claimedBy = new Deferred<ChatEvents>();
    const picking = new Deferred<PickerSources>();
    const followUps = new FollowUpsKept();
    const chat = new ProcessChat();
    const off = this.setup.mcpOff();
    const chrome = this.setup.chrome();
    const offered = this.setup.followUps();
    const spare: Spare = {
      claimedBy,
      picking,
      mcpOff: off,
      chrome,
      followUps,
      chat,
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
            promptSuggestions: this.setup.suggestions(),
            env: env(),
            extraArgs: { ...CLI_ARGS, ...chromeArgs(chrome) },
            // Its tools' calls go to the chat that claims it: its separate tasks once its turn ends.
            ...grimoireOptions(made, {
              ...(offered ? { followUps } : {}),
              tools: this.setup.tools(),
              chat,
            }),
            canUseTool: approvalsTo(() => claimedBy.promise),
            hooks: chatHooks(
              () => picking.promise,
              () => claimedBy.promise,
            ),
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

  /**
   * The spare parked, now no longer parked, if it started as a chat with
   * these MCP servers off would now; undefined when there's none, and one
   * started otherwise is stopped.
   */
  take(mcpOff: readonly string[]): Spare | undefined {
    const spare = this.spare;
    this.spare = undefined;
    if (!spare) return undefined;
    if (sameNames(spare.mcpOff, mcpOff) && spare.chrome === this.setup.chrome()) return spare;
    stop(spare);
    return undefined;
  }

  /** Stops the spare parked, if there is one. */
  dispose(): void {
    if (this.spare) stop(this.spare);
    this.spare = undefined;
  }

  /**
   * Starts a chat on a spare with its first message; Claude Code picks the
   * session ID. Rejects when the spare refuses the claim, or has died.
   */
  async claim(
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
      const refused =
        error instanceof Error && /^(option|settings)_not_applied/.test(error.message);
      if (!(refused && claim)) {
        process.close();
        throw error;
      }
      chatId = claim.sessionId;
    }
    const events = bind(chatId);
    spare.chat.set({ chatId, agent: this.setup.agent, cwd: settings.cwd });
    spare.claimedBy.resolve(events);
    return drive({
      chatId,
      settings,
      started: Promise.resolve(query),
      input,
      events,
      picking: spare.picking,
      followUps: spare.followUps,
      models: this.setup.models,
      quickModel: this.setup.quickModel,
    });
  }
}

function stop(spare: Spare): void {
  void spare.process.then(
    (process) => process.close(),
    () => {},
  );
}

/** Whether two sorted lists name the same. */
function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}
