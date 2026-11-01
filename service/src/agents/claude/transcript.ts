import type { AgentEntry, Block, ChatStatus, Entry, ToolResult } from '@grimoire/contract';

/** The parts of Claude Code's messages the transcript reads; live and saved messages share them. */
export interface ClaudeMessage {
  type: string;
  uuid?: string;
  parent_tool_use_id?: string | null;
  message?: unknown;
  event?: unknown;
}

interface ApiMessage {
  id?: string;
  content?: string | ApiBlock[];
}

interface ApiBlock {
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
}

/**
 * Builds the agent-neutral transcript from Claude Code's messages: those
 * saved in a session file, or those streaming from a live query.
 *
 * Claude Code sends each content block of a reply as its own assistant
 * message, sharing the API message ID, after the block's streamed deltas.
 * Tool results come back as user messages.
 */
export class ClaudeTranscript {
  readonly entries: Entry[] = [];
  /** Per API message ID: where each streamed block index landed in the entry's blocks. */
  private readonly positions = new Map<string, Map<number, number>>();
  private streamingIndex: number | undefined;

  /**
   * @param live Your own messages aren't echoed back live; the hub adds them as you send.
   */
  constructor(
    private readonly live: boolean,
    private readonly listener?: TranscriptListener,
  ) {}

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
    if (typeof content === 'string') return this.addUserText(uuid, content);
    if (!Array.isArray(content)) return;

    const texts: string[] = [];
    for (const block of content) {
      if (block.type === 'tool_result' && block.tool_use_id)
        this.attachResult(block.tool_use_id, block);
      else if (block.type === 'text' && block.text) texts.push(block.text);
    }
    if (texts.length) this.addUserText(uuid, texts.join('\n'));
  }

  private addUserText(uuid: string | undefined, text: string): void {
    if (this.live) return;
    this.entries.push({ kind: 'user', id: uuid ?? `user-${this.entries.length}`, text });
  }

  private attachResult(toolUseId: string, block: ApiBlock): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i]!;
      if (entry.kind !== 'agent') continue;
      const tool = entry.blocks.find((b) => b.kind === 'tool' && b.id === toolUseId);
      if (tool?.kind !== 'tool') continue;
      tool.result = toolResult(block);
      this.listener?.entry(entry);
      return;
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
