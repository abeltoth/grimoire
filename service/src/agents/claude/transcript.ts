import type {
  AgentEntry,
  Block,
  ChatStatus,
  Enclosure,
  Entry,
  PictureEnclosure,
  PlanStep,
  ToolBlock,
  ToolResult,
} from '@grimoire/contract';
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
}

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

  apply(message: ClaudeMessage): void {
    // Messages inside a subagent's run belong to its tool call, not the chat.
    if (message.parent_tool_use_id) return;
    if (message.type === 'stream_event') this.applyStreamEvent(message.event as StreamEvent);
    else if (message.type === 'assistant') this.applyAssistant(message.message as ApiMessage);
    else if (message.type === 'user') this.applyUser(message.uuid, message.message as ApiMessage);
  }

  private applyStreamEvent(event: StreamEvent): void {
    switch (event.type) {
      case 'message_start':
        if (event.message?.id) this.agentEntry(event.message.id);
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
    const entry = this.agentEntry(message.id);
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

  private agentEntry(id: string): AgentEntry {
    const existing = this.entries.find((entry) => entry.id === id);
    if (existing?.kind === 'agent') return existing;
    const entry: AgentEntry = { kind: 'agent', id, blocks: [] };
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

function toBlock(block: ApiBlock): Block | undefined {
  switch (block.type) {
    case 'text':
      return { kind: 'text', text: block.text ?? '' };
    case 'thinking':
      return { kind: 'thinking', text: block.thinking ?? '' };
    case 'tool_use':
      return { kind: 'tool', id: block.id ?? '', tool: block.name ?? '', input: block.input ?? {} };
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
