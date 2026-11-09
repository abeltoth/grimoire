import type {
  AgentEntry,
  Block,
  ChatStatus,
  Attachment,
  Entry,
  SubagentState,
  HookRun,
  PictureAttachment,
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
  /** A note Claude Code added to a run, rather than what someone wrote. */
  is_meta?: boolean;
  /** Who sent a message into a run: the agent that asked a subagent is its "coordinator". */
  origin?: { kind?: string };
}

/**
 * The ID of the last message in the turn your message `entryId` began: the one
 * just before your next message. Undefined when that turn is the chat's last.
 */
export function turnEnd(messages: readonly ClaudeMessage[], entryId: string): string | undefined {
  const at = messages.findIndex((message) => message.uuid === entryId);
  if (at === -1) throw new Error('This message is not in the chat');
  const next = messages.findIndex((message, i) => i > at && isYourEntry(message));
  return next === -1 ? undefined : messages[next - 1]!.uuid;
}

/** Whether a message is one you wrote, rather than a tool's result. */
export function isYourEntry(message: ClaudeMessage): boolean {
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
  /** A new or changed entry in the run of the subagent the tool call `toolId` started. */
  subagentEntry?(toolId: string, entry: Entry): void;
  /** The subagent the tool call `toolId` started began, or ended its task. */
  subagentState?(toolId: string, state: SubagentState): void;
  /** The hooks that ran on the live turn so far, and any begun before it that still run. */
  hooks?(runs: HookRun[]): void;
}

/** The tool a subagent ends its run with, its report to the agent that asked in its input's `message`. */
export const HANDBACK_TOOL = 'SubagentHandback';

/** The tool an agent sends a subagent another message with, which resumes its run. */
export const SEND_TOOL = 'SendMessage';

/**
 * The tool Grimoire gives the agent to offer separate tasks with
 * (follow-ups.ts): they show as cards under the reply, so its call has no row.
 */
export const FOLLOW_UPS_TOOL = 'mcp__grimoire__suggest_follow_ups';

/**
 * The ID Claude Code keeps a subagent's saved run by, from the result of the
 * tool call that started it; undefined when it names none. Older results
 * end on "agentId: …"; newer ones say the run's report comes "as a message
 * from" it; a message sent to a subagent resumes it, and its result names it
 * as "resumedAgentId".
 */
export function subagentAgentId(result: string): string | undefined {
  return (
    /^agentId: ([\w-]+)/m.exec(result) ??
    /message from "([\w-]+)"/.exec(result) ??
    /"resumedAgentId":\s*"([\w-]+)"/.exec(result)
  )?.[1];
}

/** A tool call that handed a subagent a task, or sent one a message: what it gave, and its result. */
export interface SubagentCall {
  prompt?: string;
  /** Whom a message was sent to, when the call sent one. */
  sentTo?: string;
  result?: ToolResult;
}

/**
 * The tool call `toolId` among the messages: the task it handed a subagent,
 * or whom it sent a message, and its result once it has one. Undefined when
 * it isn't among them.
 */
export function subagentCallIn(messages: readonly ClaudeMessage[], toolId: string): SubagentCall | undefined {
  let call: SubagentCall | undefined;
  for (const message of messages) {
    const content = (message.message as ApiMessage | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (message.type === 'assistant' && block.type === 'tool_use' && block.id === toolId) {
        const { prompt, to } = (block.input ?? {}) as { prompt?: unknown; to?: unknown };
        call = {
          ...call,
          ...(typeof prompt === 'string' ? { prompt } : {}),
          ...(block.name === SEND_TOOL && typeof to === 'string' ? { sentTo: to } : {}),
        };
      } else if (message.type === 'user' && block.type === 'tool_result' && block.tool_use_id === toolId) {
        call = { ...call, result: toolResult(block) };
      }
    }
  }
  return call;
}

/** Whether a saved subagent's run began with the task `prompt`: its first message is the task it was given. */
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
 * Where a saved subagent is with its task: done once it handed its report
 * back, else as the result of the tool call that started it says.
 */
export function savedSubagentState(entries: readonly Entry[], result: ToolResult | undefined): SubagentState {
  const handedBack = entries.some(
    (entry) => entry.kind === 'agent' && entry.blocks.some((b) => b.kind === 'tool' && b.tool === HANDBACK_TOOL),
  );
  if (handedBack) return 'done';
  if (!result) return 'stopped';
  return result.isError ? 'failed' : 'done';
}

/** How Claude Code opens a message the agent that asked sent a subagent while it ran. */
const SENT_WHILE_WORKING = /^The coordinator sent a message[^\n]*:\n/;

/**
 * A subagent's whole saved run: its task, what it did, and the messages the
 * agent that asked sent it later, which resumed it. Claude Code's own notes
 * to it are left out.
 */
export function wholeRun(messages: readonly ClaudeMessage[]): Entry[] {
  const run = new ClaudeTranscript(false);
  const sent = new Set<string>();
  for (const message of messages) {
    const fromAsker = message.origin?.kind === 'coordinator';
    if (message.type === 'user' && message.is_meta && !fromAsker) continue;
    if (fromAsker && message.uuid) sent.add(message.uuid);
    run.applyRun(message);
  }
  for (const entry of run.entries)
    if (entry.kind === 'user' && sent.has(entry.id)) entry.text = entry.text.replace(SENT_WHILE_WORKING, '');
  return run.entries;
}

/** How a task Claude Code ran ended, as a subagent's state. */
const TASK_END: Record<string, SubagentState> = { completed: 'done', failed: 'failed', stopped: 'stopped' };

/** Claude Code's word on a task it runs, such as a subagent: that it began, or how it ended. */
interface TaskMessage {
  subtype?: string;
  tool_use_id?: string;
  status?: string;
}

/**
 * Claude Code's word on a hook it runs: that it began, what it printed so
 * far, or how it ended. It says so only for the hooks it runs itself, such
 * as commands, never for an SDK callback, so Grimoire's own don't show.
 */
interface HookMessage {
  subtype?: string;
  hook_id?: string;
  /** Such as "PostToolUse:Edit": the event, and on a tool's events the tool. */
  hook_name?: string;
  hook_event?: string;
  output?: string;
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  outcome?: string;
}

/** The events a hook runs on for a tool, which its name follows with the tool's. */
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied']);

/** The exit code by which a hook's command stops what it ran on. */
const BLOCKING_EXIT = 2;

/** A hook running or run, and when it began, in ms since the epoch, when known. */
interface HookTimed {
  run: HookRun;
  began?: number;
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
  /** The saved turn being read: your message that began it, when you wrote it, and what it spent. */
  private turn: SavedTurn | undefined;
  /** Every saved turn read, in order, for the subagents' tokens. */
  private readonly turns: SavedTurn[] = [];
  /** What the live turn has spent so far. */
  private spent: Spent = new Map();
  /** The hooks run on the live turn, and those still running from before it, by Claude Code's ID. */
  private readonly hookRuns = new Map<string, HookTimed>();
  /** The runs of the subagents the chat's tool calls started, by tool call. */
  private readonly subagents = new Map<string, ClaudeTranscript>();

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
      this.applyHook(message as ClaudeMessage & HookMessage);
    } else if (message.type === 'assistant')
      this.count(message.message as ApiMessage, !!message.parent_tool_use_id, this.turn);
    else if (message.type === 'result' && this.live) this.endTurn();
    // Messages inside a subagent's run belong to its tool call's subagent, not the chat.
    if (message.parent_tool_use_id) return this.subagentRun(message.parent_tool_use_id).take(message);
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
  }

  /** The live turn ended: the next starts afresh, but for the hooks still running. */
  private endTurn(): void {
    this.spent = new Map();
    for (const [id, { run }] of this.hookRuns) if (run.outcome !== 'running') this.hookRuns.delete(id);
  }

  /** A hook began, printed something, or ended; the turn's hooks are passed on as they stand. */
  private applyHook(message: HookMessage): void {
    const id = message.hook_id;
    const kind = message.subtype;
    if (!id || (kind !== 'hook_started' && kind !== 'hook_progress' && kind !== 'hook_response')) return;
    const now = Date.now();
    let timed = this.hookRuns.get(id);
    if (!timed) {
      timed = { run: hookRun(id, message), ...(kind === 'hook_started' ? { began: now } : {}) };
      this.hookRuns.set(id, timed);
    }
    const output = message.output || [message.stdout, message.stderr].filter(Boolean).join('\n');
    if (output.trim()) timed.run.output = output;
    if (kind === 'hook_response') {
      timed.run.outcome = hookOutcome(message);
      if (timed.began !== undefined) timed.run.took = now - timed.began;
    }
    this.listener?.hooks?.([...this.hookRuns.values()].map(({ run }) => ({ ...run })));
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

  /** Your message; the @-references on its last lines are files you attached. */
  private addUserText(uuid: string | undefined, message: string, pictures: PictureAttachment[]): void {
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

/** A hook Claude Code began, before it says how it went. */
function hookRun(id: string, message: HookMessage): HookRun {
  const event = message.hook_event ?? '';
  const name = message.hook_name ?? event;
  const tool = TOOL_EVENTS.has(event) && name.startsWith(`${event}:`) ? name.slice(event.length + 1) : '';
  return { id, name, event, ...(tool ? { tool } : {}), outcome: 'running' };
}

/**
 * How a hook ended: blocked when it stopped what it ran on, by exiting with
 * code 2 or by saying so in the JSON it printed.
 */
function hookOutcome(message: HookMessage): HookRun['outcome'] {
  if (message.outcome === 'cancelled') return 'cancelled';
  if (message.exit_code === BLOCKING_EXIT || saysBlock(message.stdout)) return 'blocked';
  return message.outcome === 'error' ? 'failed' : 'passed';
}

/** Whether a hook printed JSON that blocks: a decision to block, or not to continue. */
function saysBlock(stdout: string | undefined): boolean {
  const text = stdout?.trim();
  if (!text?.startsWith('{')) return false;
  try {
    const said = JSON.parse(text) as { decision?: unknown; continue?: unknown } | null;
    return said?.decision === 'block' || said?.continue === false;
  } catch {
    return false;
  }
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
      if (block.name === FOLLOW_UPS_TOOL) return undefined;
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
