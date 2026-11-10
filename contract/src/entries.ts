import type { TurnTokens } from './tokens';

/**
 * A chat's transcript: your messages, with what you attached, and the
 * agent's replies, as text, thinking and tool calls.
 */

/** One entry in a transcript. */
export type Entry = UserEntry | AgentEntry | CompactionEntry;

export interface UserEntry {
  kind: 'user';
  id: string;
  text: string;
  /** Pictures and files sent with it. */
  attachments?: Attachment[];
  /** When it was written, in ms since the epoch, when known. */
  at?: number;
  /** How long the turn it began took, in ms, once that turn has ended and when known. */
  took?: number;
  /** What the turn it began spent, so far while it runs, when the agent says. */
  tokens?: TurnTokens;
  /** The hooks that ran on the turn it began, in the order they began, while the chat is live. */
  hooks?: HookRun[];
}

/** A hook the agent ran, such as your command after each edit, and how it went. */
export interface HookRun {
  id: string;
  /** As the agent names it, such as "PostToolUse:Edit". */
  name: string;
  /** What it ran on, such as "PostToolUse". */
  event: string;
  /** The tool it ran for, on a tool's events, such as "Edit". */
  tool?: string;
  /** Blocked when it stopped what it ran on; failed when it broke without stopping it. */
  outcome: 'running' | 'passed' | 'failed' | 'blocked' | 'cancelled';
  /** What it printed, when it printed anything. */
  output?: string;
  /** How long it took, in ms, once it ended and when known. */
  took?: number;
  /** When it began, in ms since the epoch, when known. */
  at?: number;
}

/** Something sent with a message: a picture, shown as a plate, or a file, as a reference. */
export type Attachment = PictureAttachment | FileAttachment;

export interface PictureAttachment {
  kind: 'picture';
  /** Such as "image/png". */
  mediaType: string;
  /** The picture, base64-encoded. */
  data: string;
  /** How it came in, such as "Screenshot, pasted at 22:18"; missing when read back from the agent. */
  caption?: string;
}

/** A file the agent reads with the message. */
export interface FileAttachment {
  kind: 'file';
  /** Absolute, or relative to the chat's folder. */
  path: string;
}

export interface AgentEntry {
  kind: 'agent';
  id: string;
  blocks: Block[];
  /** When it was written, in ms since the epoch, when known. */
  at?: number;
  /** The model that wrote it, such as claude-opus-5-5, when the agent says. */
  model?: string;
}

/** The agent summed the chat up, so later turns read less, or tried to and failed. */
export interface CompactionEntry {
  kind: 'compaction';
  id: string;
  /** When it was done, in ms since the epoch, when known. */
  at?: number;
  /** Whether you asked for it, or the agent did it as the context window filled, when the agent says. */
  trigger?: 'manual' | 'auto';
  /** The tokens the chat held before, when the agent says. */
  before?: number;
  /** The tokens it holds after, when the agent says. */
  after?: number;
  /** Why it failed; missing when it worked. */
  error?: string;
}

export type Block = TextBlock | ThinkingBlock | ToolBlock;

export interface TextBlock {
  kind: 'text';
  text: string;
}

export interface ThinkingBlock {
  kind: 'thinking';
  text: string;
}

/** A tool the agent called, such as reading a file or running a command. */
export interface ToolBlock {
  kind: 'tool';
  id: string;
  tool: string;
  input: unknown;
  /** The skill it runs, when the tool is the one that runs skills. */
  skill?: string;
  /** Missing while the tool runs. */
  result?: ToolResult;
}

export interface ToolResult {
  text: string;
  isError: boolean;
}
