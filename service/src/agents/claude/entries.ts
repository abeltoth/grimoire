import type { Entry } from '@grimoire/contract';
import type { ApiMessage, ClaudeMessage } from './messages';
import { ClaudeTranscript } from './transcript';

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
    if (entry.kind === 'user' && sent.has(entry.id))
      entry.text = entry.text.replace(SENT_WHILE_WORKING, '');
  return run.entries;
}
