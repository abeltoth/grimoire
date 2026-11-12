import type {
  AgentEntry,
  ChatStatus,
  Attachment,
  CompactionEntry,
  Entry,
  SubagentState,
  SubagentStats,
  HookRun,
  PictureAttachment,
  PlanStep,
  TokenCounts,
  TokenUse,
  ToolBlock,
  UserEntry,
} from '@grimoire/contract';
import { addTokens } from '@grimoire/contract';
import { type CompactMessage, SavedCompactions, compactionOf, withLiveSummary } from './compaction';
import {
  type ApiBlock,
  type ApiMessage,
  type ClaudeMessage,
  type HookMessage,
  type StreamEvent,
  type TaskMessage,
  toBlock,
  toolResult,
} from './messages';
import { HookRuns } from './hook-runs';
import { splitReferences } from './references';
import { statsFromResult, statsFromUsage } from './subagent-stats';

export interface TranscriptListener {
  entry(entry: Entry): void;
  text(entryId: string, block: number, text: string): void;
  status(status: Exclude<ChatStatus, 'idle' | 'waiting'>): void;
  plan(plan: PlanStep[]): void;
  /** What the running turn has spent so far, by model. */
  tokens?(uses: TokenUse[]): void;
  /** A new or changed entry in the run of the subagent the tool call `toolId` started. */
  subagentEntry?(toolId: string, entry: Entry): void;
  /** The subagent the tool call `toolId` started began, or ended its task. */
  subagentState?(toolId: string, state: SubagentState): void;
  /** What the agent said of how the subagent the tool call `toolId` started runs and what it took. */
  subagentStats?(toolId: string, stats: SubagentStats): void;
  /** The hooks that ran on the live turn so far, and any begun before it that still run. */
  hooks?(runs: HookRun[]): void;
}

/** How a task Claude Code ran ended, as a subagent's state. */
const TASK_END: Record<string, SubagentState> = {
  completed: 'done',
  failed: 'failed',
  stopped: 'stopped',
};

/** A turn's replies' tokens by API message ID; Claude Code repeats a reply's on each of its blocks. */
type Spent = Map<string, TokenUse>;

const PLAN_STATUS: Record<string, PlanStep['status']> = {
  pending: 'pending',
  in_progress: 'active',
  completed: 'done',
};

/**
 * Builds the agent-neutral transcript from Claude Code's messages: those
 * saved in a session file, or those streaming from a live query.
 *
 * Claude Code sends each content block of a reply as its own assistant
 * message, sharing the API message ID, after the block's streamed deltas.
 * Tool results come back as user messages. Its task tools (TaskCreate,
 * TaskUpdate, or the older TodoWrite) keep the plan, once they succeed.
 */
export class ClaudeTranscript {
  readonly entries: Entry[] = [];
  /** Per API message ID: where each streamed block index landed in the entry's blocks. */
  private readonly positions = new Map<string, Map<number, number>>();
  private streamingIndex: number | undefined;
  /** The plan's steps by Claude Code's task ID, in the order it made them. */
  private readonly tasks = new Map<string, PlanStep>();
  /** The saved turn being read: your message that began it, when you wrote it, and what it spent. */
  private turn: SavedTurn | undefined;
  /** Every saved turn read, in order, for the subagents' tokens. */
  private readonly turns: SavedTurn[] = [];
  /** What the live turn has spent so far. */
  private spent: Spent = new Map();
  /** The hooks run on the live turn, and those still running from before it, by Claude Code's ID. */
  private readonly hookRuns = new HookRuns();
  /** The runs of the subagents the chat's tool calls started, by tool call. */
  private readonly subagents = new Map<string, ClaudeTranscript>();
  private readonly savedCompactions = new SavedCompactions();

  /**
   * @param live Your own messages aren't echoed back live; the hub adds them as you send.
   */
  constructor(
    private readonly live: boolean,
    private readonly listener?: TranscriptListener,
  ) {}

  get plan(): PlanStep[] {
    return [...this.tasks.values()].map((step) => ({ ...step }));
  }

  /**
   * @param at When a saved message was written, in ms since the epoch: a
   *   turn took from your message until its last message.
   */
  apply(message: ClaudeMessage, at?: number): void {
    if (message.type === 'system') {
      this.applyTask(message as ClaudeMessage & TaskMessage);
      const hooks = this.hookRuns.apply(message as ClaudeMessage & HookMessage);
      if (hooks) this.listener?.hooks?.(hooks);
    } else if (message.type === 'assistant')
      this.count(message.message as ApiMessage, !!message.parent_tool_use_id, this.turn);
    else if (message.type === 'result' && this.live) this.endTurn();
    else if (message.type === 'user' && message.tool_use_result) this.applyRunTotals(message);
    // Messages inside a subagent's run belong to its tool call's subagent, not the chat.
    if (message.parent_tool_use_id)
      return this.subagentRun(message.parent_tool_use_id).take(message);
    this.take(message, at);
  }

  /** A message from a saved subagent's run, read on its own: its entries are the run's. */
  applyRun(message: ClaudeMessage): void {
    this.take(message);
  }

  /** A subagent's task began, or ended; a background subagent's tool call has its result long before. */
  private applyTask(message: TaskMessage): void {
    const toolId = message.tool_use_id;
    if (!toolId) return;
    const state =
      message.subtype === 'task_started'
        ? 'working'
        : message.subtype === 'task_notification'
          ? TASK_END[message.status ?? '']
          : undefined;
    if (state) this.listener?.subagentState?.(toolId, state);
    const stats: SubagentStats = {
      ...statsFromUsage(message.usage),
      ...(typeof message.is_backgrounded === 'boolean'
        ? { background: message.is_backgrounded }
        : {}),
      ...(typeof message.spawn_depth === 'number' ? { depth: message.spawn_depth } : {}),
    };
    if (Object.keys(stats).length) this.listener?.subagentStats?.(toolId, stats);
  }

  /** The result of a tool call that started a subagent, whose output says what its run took. */
  private applyRunTotals(message: ClaudeMessage): void {
    const stats = statsFromResult(message.tool_use_result);
    if (!Object.keys(stats).length) return;
    const content = (message.message as ApiMessage | undefined)?.content;
    const result = Array.isArray(content)
      ? content.find((block) => block.type === 'tool_result' && block.tool_use_id)
      : undefined;
    if (result) this.listener?.subagentStats?.(result.tool_use_id!, stats);
  }

  /** The live turn ended: the next starts afresh, but for the hooks still running. */
  private endTurn(): void {
    this.spent = new Map();
    this.hookRuns.endTurn();
  }

  /** The transcript of the subagent the tool call `toolId` started, its entries passed on as the subagent's. */
  private subagentRun(toolId: string): ClaudeTranscript {
    let run = this.subagents.get(toolId);
    if (!run) {
      run = new ClaudeTranscript(this.live, {
        entry: (entry) => this.listener?.subagentEntry?.(toolId, entry),
        text: () => {},
        status: () => {},
        plan: () => {},
      });
      this.subagents.set(toolId, run);
    }
    return run;
  }

  private take(message: ClaudeMessage, at?: number): void {
    const entries = this.entries.length;
    if (message.type === 'stream_event') this.applyStreamEvent(message.event as StreamEvent);
    else if (message.type === 'assistant') this.applyAssistant(message.message as ApiMessage);
    else if (message.type === 'system')
      this.addCompaction(compactionOf(message as CompactMessage, this.nextId('compaction')));
    else if (message.type === 'user') {
      const compaction = this.live
        ? withLiveSummary(message, this.entries)
        : this.savedCompactions.take(message, this.entries, this.nextId('compaction'), at);
      if (this.live && compaction) this.listener?.entry(compaction as CompactionEntry);
      else if (typeof compaction === 'object') this.addCompaction(compaction);
      else if (!compaction) this.applyUser(message.uuid, message.message as ApiMessage);
    }
    if (at === undefined || !Number.isFinite(at)) return;
    const last = this.entries.at(-1);
    if (this.entries.length > entries && last?.kind === 'user') {
      this.turn = { entry: last, began: at, spent: new Map() };
      this.turns.push(this.turn);
    } else if (this.turn && at > this.turn.began) this.turn.entry.took = at - this.turn.began;
  }

  /**
   * A message from a saved subagent's run: its tokens count toward the turn
   * it ran in, found by when it came, as nothing in it names the tool call.
   */
  applySubagent(message: ClaudeMessage, at: number): void {
    if (message.type !== 'assistant' || !Number.isFinite(at)) return;
    const turn = this.turns.findLast((t) => t.began <= at);
    this.count(message.message as ApiMessage, true, turn);
  }

  /** Counts a reply's tokens toward the live turn, or the saved one. */
  private count(
    message: ApiMessage | undefined,
    subagent: boolean,
    turn: SavedTurn | undefined,
  ): void {
    const use = message?.id ? tokenUse(message, subagent) : undefined;
    if (!use) return;
    if (this.live) {
      const known = this.spent.get(message!.id!);
      this.spent.set(message!.id!, use);
      if (!known || JSON.stringify(known) !== JSON.stringify(use))
        this.listener?.tokens?.(byModel(this.spent));
    } else if (turn) {
      turn.spent.set(message!.id!, use);
      turn.entry.tokens = { at: turn.began, uses: byModel(turn.spent) };
    }
  }

  private applyStreamEvent(event: StreamEvent): void {
    switch (event.type) {
      case 'message_start':
        if (event.message?.id) this.agentEntry(event.message.id, event.message.model);
        this.listener?.status('thinking');
        break;
      case 'content_block_start': {
        const entry = this.lastAgentEntry();
        const block = event.content_block && toBlock(event.content_block);
        if (!entry || !block || event.index === undefined) return;
        this.streamingIndex = event.index;
        entry.blocks.push(block);
        this.positionsOf(entry.id).set(event.index, entry.blocks.length - 1);
        this.listener?.entry(entry);
        this.listener?.status(block.kind === 'thinking' ? 'thinking' : 'writing');
        break;
      }
      case 'content_block_delta': {
        const entry = this.lastAgentEntry();
        const text = event.delta?.text ?? event.delta?.thinking;
        if (!entry || event.index === undefined || !text) return;
        const position = this.positionsOf(entry.id).get(event.index);
        const block = position === undefined ? undefined : entry.blocks[position];
        if (!block || block.kind === 'tool') return;
        block.text += text;
        this.listener?.text(entry.id, position!, text);
        break;
      }
      case 'message_stop':
        this.streamingIndex = undefined;
        // The reply is done; tools may run before the next one.
        this.listener?.status('thinking');
        break;
    }
  }

  private applyAssistant(message: ApiMessage): void {
    if (!message.id || !Array.isArray(message.content)) return;
    const entry = this.agentEntry(message.id, message.model);
    const blocks = message.content.map(toBlock).filter((block) => block !== undefined);
    const position =
      this.streamingIndex === undefined
        ? undefined
        : this.positionsOf(entry.id).get(this.streamingIndex);
    if (position !== undefined && blocks.length === 1) entry.blocks[position] = blocks[0]!;
    else entry.blocks.push(...blocks);
    this.listener?.entry(entry);
  }

  private applyUser(uuid: string | undefined, message: ApiMessage): void {
    const content = message.content;
    if (typeof content === 'string') return this.addUserText(uuid, content, []);
    if (!Array.isArray(content)) return;

    const texts: string[] = [];
    const pictures: PictureAttachment[] = [];
    for (const block of content) {
      if (block.type === 'tool_result' && block.tool_use_id)
        this.attachResult(block.tool_use_id, block);
      else if (block.type === 'text' && block.text) texts.push(block.text);
      else if (block.type === 'image' && block.source?.type === 'base64' && block.source.data)
        pictures.push({
          kind: 'picture',
          mediaType: block.source.media_type ?? 'image/png',
          data: block.source.data,
        });
    }
    if (texts.length || pictures.length) this.addUserText(uuid, texts.join('\n'), pictures);
  }

  private addCompaction(entry: CompactionEntry | undefined): void {
    if (!entry) return;
    this.entries.push(entry);
    this.listener?.entry(entry);
  }

  /** An ID for an entry Claude Code gave none. */
  private nextId(kind: string): string {
    return `${kind}-${this.entries.length}`;
  }

  /** Your message; the @-references on its last lines are files you attached. */
  private addUserText(
    uuid: string | undefined,
    message: string,
    pictures: PictureAttachment[],
  ): void {
    if (this.live) return;
    const { text, files } = splitReferences(message);
    const attachments: Attachment[] = [...pictures, ...files];
    this.entries.push({
      kind: 'user',
      id: uuid ?? `user-${this.entries.length}`,
      text,
      ...(attachments.length ? { attachments } : {}),
    });
  }

  private attachResult(toolUseId: string, block: ApiBlock): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i]!;
      if (entry.kind !== 'agent') continue;
      const tool = entry.blocks.find((b) => b.kind === 'tool' && b.id === toolUseId);
      if (tool?.kind !== 'tool') continue;
      tool.result = toolResult(block);
      this.listener?.entry(entry);
      if (!tool.result.isError && this.applyPlan(tool)) this.listener?.plan(this.plan);
      return;
    }
  }

  /** Applies a task tool's change to the plan; false for other tools. */
  private applyPlan(tool: ToolBlock): boolean {
    const input = (tool.input ?? {}) as Record<string, unknown>;
    const text = (key: string) => (typeof input[key] === 'string' ? input[key] : undefined);
    switch (tool.tool) {
      case 'TaskCreate': {
        const id = /#(\d+)/.exec(tool.result?.text ?? '')?.[1];
        const subject = text('subject');
        if (!id || !subject) return false;
        const activeText = text('activeForm');
        this.tasks.set(id, {
          text: subject,
          status: 'pending',
          ...(activeText ? { activeText } : {}),
        });
        return true;
      }
      case 'TaskUpdate': {
        const id = text('taskId');
        const step = id && this.tasks.get(id);
        if (!step) return false;
        if (input['status'] === 'deleted') return this.tasks.delete(id);
        const status = PLAN_STATUS[text('status') ?? ''];
        if (status) step.status = status;
        step.text = text('subject') ?? step.text;
        const activeText = text('activeForm');
        if (activeText) step.activeText = activeText;
        return true;
      }
      case 'TodoWrite': {
        const todos = Array.isArray(input['todos'])
          ? (input['todos'] as Record<string, unknown>[])
          : [];
        this.tasks.clear();
        todos.forEach((todo, i) => {
          if (typeof todo['content'] !== 'string') return;
          this.tasks.set(String(i), {
            text: todo['content'],
            status: PLAN_STATUS[String(todo['status'])] ?? 'pending',
            ...(typeof todo['activeForm'] === 'string' ? { activeText: todo['activeForm'] } : {}),
          });
        });
        return true;
      }
      default:
        return false;
    }
  }

  /** The reply `id`, made when it's new; `model` wrote it, unless it's Claude Code's own note. */
  private agentEntry(id: string, model?: string): AgentEntry {
    const known = model && model !== SYNTHETIC_MODEL ? { model } : {};
    const existing = this.entries.find((entry) => entry.id === id);
    if (existing?.kind === 'agent') return Object.assign(existing, known);
    const entry: AgentEntry = { kind: 'agent', id, blocks: [], ...known };
    this.entries.push(entry);
    this.listener?.entry(entry);
    return entry;
  }

  private lastAgentEntry(): AgentEntry | undefined {
    const last = this.entries.at(-1);
    return last?.kind === 'agent' ? last : undefined;
  }

  private positionsOf(entryId: string): Map<number, number> {
    let positions = this.positions.get(entryId);
    if (!positions) this.positions.set(entryId, (positions = new Map()));
    return positions;
  }
}

/** The model Claude Code names on notes of its own, which no model wrote. */
const SYNTHETIC_MODEL = '<synthetic>';

interface SavedTurn {
  entry: UserEntry;
  began: number;
  spent: Spent;
}

/** A reply's tokens; undefined for one with none, such as Claude Code's own notes. */
function tokenUse(message: ApiMessage, subagent: boolean): TokenUse | undefined {
  const usage = message.usage;
  if (!usage || !message.model || message.model === SYNTHETIC_MODEL) return undefined;
  const long = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const counts: TokenCounts = {
    input: usage.input_tokens ?? 0,
    cacheWritten: Math.max((usage.cache_creation_input_tokens ?? 0) - long, 0),
    cacheWrittenLong: long,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
  };
  if (!Object.values(counts).some((n) => n > 0)) return undefined;
  return { model: message.model, ...(subagent ? { subagent } : {}), ...counts };
}

/** A turn's tokens added up by model, the chat's own apart from its subagents'. */
function byModel(spent: Spent): TokenUse[] {
  const uses = new Map<string, TokenUse>();
  for (const use of spent.values()) {
    const key = `${use.subagent ? 'subagent' : 'chat'} ${use.model}`;
    const sum = uses.get(key);
    uses.set(key, sum ? { ...sum, ...addTokens([sum, use]) } : { ...use });
  }
  return [...uses.values()];
}
