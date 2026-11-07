import type {
  AgentEntry,
  Block,
  ChatStatus,
  Enclosure,
  Entry,
  HelperState,
  PictureEnclosure,
  PlanStep,
  TokenCounts,
  TokenUse,
  ToolBlock,
  ToolResult,
  UserEntry,
} from '@grimoire/contract';
import { addTokens } from '@grimoire/contract';
import type { ReplyUsage } from './cache';
import { splitReferences } from './references';

/** The parts of Claude Code's messages the transcript reads; live and saved messages share them. */
export interface ClaudeMessage {
  type: string;
  uuid?: string;
  parent_tool_use_id?: string | null;
  message?: unknown;
  event?: unknown;
}

/**
 * The ID of the last message in the turn your entry `entryId` began: the one
 * just before your next entry. Undefined when that turn is the chat's last.
 */
export function turnEnd(messages: readonly ClaudeMessage[], entryId: string): string | undefined {
  const at = messages.findIndex((message) => message.uuid === entryId);
  if (at === -1) throw new Error('This entry is not in the chat');
  const next = messages.findIndex((message, i) => i > at && isYourEntry(message));
  return next === -1 ? undefined : messages[next - 1]!.uuid;
}

/** Whether a message is one you wrote, rather than a tool's result. */
function isYourEntry(message: ClaudeMessage): boolean {
  if (message.type !== 'user' || message.parent_tool_use_id) return false;
  const content = (message.message as ApiMessage | undefined)?.content;
  if (typeof content === 'string') return true;
  return (
    Array.isArray(content) &&
    content.some((block) => (block.type === 'text' && block.text) || block.type === 'image')
  );
}

interface ApiMessage {
  id?: string;
  model?: string;
  usage?: ReplyUsage;
  content?: string | ApiBlock[];
}

interface ApiBlock {
  /** An image block's picture. */
  source?: { type: string; media_type?: string; data?: string };
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | ApiBlock[];
  is_error?: boolean;
}

interface StreamEvent {
  type: string;
  index?: number;
  message?: ApiMessage;
  content_block?: ApiBlock;
  delta?: { type: string; text?: string; thinking?: string };
}

export interface TranscriptListener {
  entry(entry: Entry): void;
  text(entryId: string, block: number, text: string): void;
  status(status: Exclude<ChatStatus, 'idle' | 'waiting'>): void;
  plan(plan: PlanStep[]): void;
  /** What the running turn has spent so far, by model. */
  tokens?(uses: TokenUse[]): void;
  /** A new or changed entry in the run of the helper the tool call `toolId` started. */
  helperEntry?(toolId: string, entry: Entry): void;
  /** The helper the tool call `toolId` started began, or ended its task. */
  helperState?(toolId: string, state: HelperState): void;
}

/** The tool a helper ends its run with, its report to the agent that asked in its input's `message`. */
export const HANDBACK_TOOL = 'SubagentHandback';

/**
 * The ID Claude Code keeps a helper's saved run by, from the result of the
 * tool call that started it; undefined when it names none. Older results
 * end on "agentId: …"; newer ones say the run's report comes "as a message
 * from" it.
 */
export function helperAgentId(result: string): string | undefined {
  return (/^agentId: ([\w-]+)/m.exec(result) ?? /message from "([\w-]+)"/.exec(result))?.[1];
}

/**
 * The tool call `toolId` among the messages: the task it handed a helper,
 * and its result once it has one. Undefined when it isn't among them.
 */
export function helperCallIn(
  messages: readonly ClaudeMessage[],
  toolId: string,
): { prompt?: string; result?: ToolResult } | undefined {
  let call: { prompt?: string; result?: ToolResult } | undefined;
  for (const message of messages) {
    const content = (message.message as ApiMessage | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (message.type === 'assistant' && block.type === 'tool_use' && block.id === toolId) {
        const prompt = (block.input as { prompt?: unknown } | undefined)?.prompt;
        call = { ...call, ...(typeof prompt === 'string' ? { prompt } : {}) };
      } else if (message.type === 'user' && block.type === 'tool_result' && block.tool_use_id === toolId) {
        call = { ...call, result: toolResult(block) };
      }
    }
  }
  return call;
}

/** Whether a saved helper's run began with the task `prompt`: its first message is the task it was given. */
export function runBeganWith(messages: readonly ClaudeMessage[], prompt: string): boolean {
  const first = messages.find((message) => message.type === 'user');
  const content = (first?.message as ApiMessage | undefined)?.content;
  const text =
    typeof content === 'string'
      ? content
      : (content ?? [])
          .filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .join('\n');
  return !!text && text.trim() === prompt.trim();
}

/**
 * Where a saved helper is with its task: done once it handed its report
 * back, else as the result of the tool call that started it says.
 */
export function savedHelperState(entries: readonly Entry[], result: ToolResult | undefined): HelperState {
  const handedBack = entries.some(
    (entry) => entry.kind === 'agent' && entry.blocks.some((b) => b.kind === 'tool' && b.tool === HANDBACK_TOOL),
  );
  if (handedBack) return 'done';
  if (!result) return 'stopped';
  return result.isError ? 'failed' : 'done';
}

/** How a task Claude Code ran ended, as a helper's state. */
const TASK_END: Record<string, HelperState> = { completed: 'done', failed: 'failed', stopped: 'stopped' };

/** Claude Code's word on a task it runs, such as a helper: that it began, or how it ended. */
interface TaskMessage {
  subtype?: string;
  tool_use_id?: string;
  status?: string;
}

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
  /** The saved turn being read: your entry that began it, when you wrote it, and what it spent. */
  private turn: SavedTurn | undefined;
  /** Every saved turn read, in order, for the subagents' tokens. */
  private readonly turns: SavedTurn[] = [];
  /** What the live turn has spent so far. */
  private spent: Spent = new Map();
  /** The runs of the helpers the chat's tool calls started, by tool call. */
  private readonly helpers = new Map<string, ClaudeTranscript>();

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
   *   turn took from your entry until its last message.
   */
  apply(message: ClaudeMessage, at?: number): void {
    if (message.type === 'system') this.applyTask(message as ClaudeMessage & TaskMessage);
    else if (message.type === 'assistant')
      this.count(message.message as ApiMessage, !!message.parent_tool_use_id, this.turn);
    else if (message.type === 'result' && this.live) this.spent = new Map();
    // Messages inside a subagent's run belong to its tool call's helper, not the chat.
    if (message.parent_tool_use_id) return this.helperRun(message.parent_tool_use_id).take(message);
    this.take(message, at);
  }

  /** A message from a saved helper's run, read on its own: its entries are the run's. */
  applyRun(message: ClaudeMessage): void {
    this.take(message);
  }

  /** A helper's task began, or ended; a background helper's tool call has its result long before. */
  private applyTask(message: TaskMessage): void {
    const toolId = message.tool_use_id;
    if (!toolId) return;
    const state =
      message.subtype === 'task_started'
        ? 'working'
        : message.subtype === 'task_notification'
          ? TASK_END[message.status ?? '']
          : undefined;
    if (state) this.listener?.helperState?.(toolId, state);
  }

  /** The transcript of the helper the tool call `toolId` started, its entries passed on as the helper's. */
  private helperRun(toolId: string): ClaudeTranscript {
    let run = this.helpers.get(toolId);
    if (!run) {
      run = new ClaudeTranscript(this.live, {
        entry: (entry) => this.listener?.helperEntry?.(toolId, entry),
        text: () => {},
        status: () => {},
        plan: () => {},
      });
      this.helpers.set(toolId, run);
    }
    return run;
  }

  private take(message: ClaudeMessage, at?: number): void {
    const entries = this.entries.length;
    if (message.type === 'stream_event') this.applyStreamEvent(message.event as StreamEvent);
    else if (message.type === 'assistant') this.applyAssistant(message.message as ApiMessage);
    else if (message.type === 'user') this.applyUser(message.uuid, message.message as ApiMessage);
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
  private count(message: ApiMessage | undefined, subagent: boolean, turn: SavedTurn | undefined): void {
    const use = message?.id ? tokenUse(message, subagent) : undefined;
    if (!use) return;
    if (this.live) {
      const known = this.spent.get(message!.id!);
      this.spent.set(message!.id!, use);
      if (!known || JSON.stringify(known) !== JSON.stringify(use)) this.listener?.tokens?.(byModel(this.spent));
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
    const pictures: PictureEnclosure[] = [];
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

  /** Your entry; the @-references on its last lines are files you attached. */
  private addUserText(uuid: string | undefined, message: string, pictures: PictureEnclosure[]): void {
    if (this.live) return;
    const { text, files } = splitReferences(message);
    const enclosures: Enclosure[] = [...pictures, ...files];
    this.entries.push({
      kind: 'user',
      id: uuid ?? `user-${this.entries.length}`,
      text,
      ...(enclosures.length ? { enclosures } : {}),
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
        this.tasks.set(id, { text: subject, status: 'pending', ...(activeText ? { activeText } : {}) });
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
        const todos = Array.isArray(input['todos']) ? (input['todos'] as Record<string, unknown>[]) : [];
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

/** The tool Claude Code runs a skill with; its input names the skill. */
const SKILL_TOOL = 'Skill';

function toBlock(block: ApiBlock): Block | undefined {
  switch (block.type) {
    case 'text':
      return { kind: 'text', text: block.text ?? '' };
    case 'thinking':
      return { kind: 'thinking', text: block.thinking ?? '' };
    case 'tool_use': {
      const input = block.input ?? {};
      const skill = block.name === SKILL_TOOL ? (input as { skill?: unknown }).skill : undefined;
      return {
        kind: 'tool',
        id: block.id ?? '',
        tool: block.name ?? '',
        input,
        ...(typeof skill === 'string' && skill ? { skill } : {}),
      };
    }
    default:
      return undefined;
  }
}

function toolResult(block: ApiBlock): ToolResult {
  const text =
    typeof block.content === 'string'
      ? block.content
      : (block.content ?? [])
          .filter((part) => part.type === 'text')
          .map((part) => part.text ?? '')
          .join('\n');
  return { text, isError: block.is_error === true };
}
