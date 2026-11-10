import type { CompactionEntry, Entry } from '@grimoire/contract';
import type { ApiMessage, ClaudeMessage } from './messages';

/** Where the summary begins and ends in Claude Code's wording around it. */
const SUMMARY_START = 'Summary:\n';
const SUMMARY_END = '\nIf you need specific details from before compaction';

/** Claude Code's word on a compaction, live: where it cut the chat, or that it failed. */
export interface CompactMessage {
  subtype?: string;
  uuid?: string;
  compact_metadata?: { trigger?: 'manual' | 'auto'; pre_tokens?: number; post_tokens?: number };
  compact_result?: 'success' | 'failed';
  compact_error?: string;
}

/** The compaction a live system message reports, done or failed; undefined for any other message. */
export function compactionOf(message: CompactMessage, id: string): CompactionEntry | undefined {
  if (message.subtype === 'compact_boundary') {
    const { trigger, pre_tokens, post_tokens } = message.compact_metadata ?? {};
    return {
      kind: 'compaction',
      id: message.uuid ?? id,
      ...(trigger ? { trigger } : {}),
      ...(pre_tokens ? { before: pre_tokens } : {}),
      ...(post_tokens ? { after: post_tokens } : {}),
    };
  }
  if (message.subtype === 'status' && message.compact_result === 'failed')
    return {
      kind: 'compaction',
      id: message.uuid ?? id,
      error: message.compact_error?.trim() || 'Claude Code gave no reason',
    };
  return undefined;
}

/** Reads the messages a saved chat's compactions left, in order. */
export class SavedCompactions {
  /** A /compact was just read: what it printed goes too. */
  private ran = false;

  /**
   * What a saved user message is to a compaction: the summary that stands
   * for the chat before it, which shows as the compaction itself; your
   * /compact, which marks the last one yours, or what it printed, both
   * true as the compaction shows them; false for any other message.
   */
  take(
    message: ClaudeMessage,
    entries: Entry[],
    id: string,
    at?: number,
  ): CompactionEntry | boolean {
    if (message.isCompactSummary) {
      const known = at !== undefined && Number.isFinite(at) ? { at } : {};
      const summary = summaryOf(message.message as ApiMessage);
      return {
        kind: 'compaction',
        id: message.uuid ?? id,
        ...known,
        ...(summary ? { summary } : {}),
      };
    }
    const command = message.isCompletedLocalCommand
      ? localCommandOf(message.message as ApiMessage)
      : undefined;
    const ran = this.ran;
    this.ran = command === 'compact';
    if (command === 'compact') {
      const last = entries.findLast((entry) => entry.kind === 'compaction');
      if (last?.kind === 'compaction') last.trigger = 'manual';
      return true;
    }
    return command === 'output' && ran;
  }
}

/**
 * The compaction a live message gives its summary to, filled in: Claude
 * Code sends the summary right after the boundary, as a message of its own.
 */
export function withLiveSummary(
  message: ClaudeMessage,
  entries: Entry[],
): CompactionEntry | undefined {
  const last = entries.at(-1);
  if (!message.isSynthetic || last?.kind !== 'compaction' || last.error || last.summary)
    return undefined;
  const summary = summaryOf(message.message as ApiMessage);
  if (!summary) return undefined;
  last.summary = summary;
  return last;
}

/**
 * The summary in the message that stands for the chat before a compaction,
 * without what Claude Code wraps it in for the agent, when it's worded as expected.
 */
function summaryOf(message: ApiMessage | undefined): string | undefined {
  const content = message?.content;
  const text = (
    typeof content === 'string'
      ? content
      : (content ?? []).map((block) => (block.type === 'text' ? (block.text ?? '') : '')).join('')
  ).trim();
  const begins = text.indexOf(SUMMARY_START);
  const body = begins < 0 ? text : text.slice(begins + SUMMARY_START.length);
  const ends = body.indexOf(SUMMARY_END);
  return (ends < 0 ? body : body.slice(0, ends)).trim() || undefined;
}

/** What a saved local command's message says: the command you ran, or what it printed. */
function localCommandOf(message: ApiMessage): 'compact' | 'output' | undefined {
  const text = typeof message.content === 'string' ? message.content.trimStart() : '';
  if (text.startsWith('<command-name>/compact</command-name>')) return 'compact';
  if (text.startsWith('<local-command-stdout>')) return 'output';
  return undefined;
}
