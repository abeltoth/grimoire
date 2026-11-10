import { describe, expect, it } from 'vitest';
import type { Entry } from '@grimoire/contract';
import type { ClaudeMessage } from './messages';
import { ClaudeTranscript } from './transcript';

const listened = (messages: object[]): { entries: Entry[]; told: Entry[] } => {
  const told: Entry[] = [];
  const transcript = new ClaudeTranscript(true, {
    entry: (entry) => told.push(entry),
    text: () => {},
    status: () => {},
    plan: () => {},
  });
  for (const message of messages) transcript.apply(message as ClaudeMessage);
  return { entries: transcript.entries, told };
};

// Worded as Claude Code wraps a compaction's summary for the agent.
const wrapped = [
  'This session is being continued from a previous conversation that ran out of context.',
  '',
  '<system-reminder>',
  '<tools-used-before-summary>Read</tools-used-before-summary>',
  '</system-reminder>',
  'Summary:',
  '1. Primary Request and Intent:',
  '   - Say hi.',
  '',
  'If you need specific details from before compaction, read the full transcript at: x.jsonl',
  'Continue the conversation from where it left off without asking the user any further questions.',
].join('\n');
const written = '1. Primary Request and Intent:\n   - Say hi.';

// Shaped after what Claude Code saved of a /compact sent through the SDK.
const summary = {
  type: 'user',
  uuid: 'u-summary',
  isCompactSummary: true,
  message: {
    role: 'user',
    content: wrapped,
  },
};
const command = {
  type: 'user',
  uuid: 'u-command',
  isCompletedLocalCommand: true,
  message: {
    role: 'user',
    content:
      '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>',
  },
};
const printed = {
  type: 'user',
  uuid: 'u-printed',
  isCompletedLocalCommand: true,
  message: { role: 'user', content: '<local-command-stdout>Compacted </local-command-stdout>' },
};

describe('compactions', () => {
  it('shows a live compaction, with what the chat held before and after', () => {
    const { entries, told } = listened([
      {
        type: 'system',
        subtype: 'compact_boundary',
        uuid: 'b1',
        compact_metadata: { trigger: 'manual', pre_tokens: 92_476, post_tokens: 12_000 },
      },
      { type: 'system', subtype: 'status', status: null, compact_result: 'success' },
    ]);
    const shown = {
      kind: 'compaction',
      id: 'b1',
      trigger: 'manual',
      before: 92_476,
      after: 12_000,
    };
    expect(entries).toEqual([shown]);
    expect(told).toEqual([shown]);
  });

  it('gives a live compaction the summary Claude Code sends after it, and keeps what it printed out', () => {
    const { entries, told } = listened([
      {
        type: 'system',
        subtype: 'compact_boundary',
        uuid: 'b1',
        compact_metadata: { trigger: 'manual', pre_tokens: 17_963 },
      },
      { type: 'user', uuid: 'u1', isSynthetic: true, message: { role: 'user', content: wrapped } },
      { ...printed, isReplay: true },
    ]);
    const shown = {
      kind: 'compaction',
      id: 'b1',
      trigger: 'manual',
      before: 17_963,
      summary: written,
    };
    expect(entries).toEqual([shown]);
    expect(told).toEqual([shown, shown]);
  });

  it('shows the whole message when the summary isn’t worded as expected', () => {
    const transcript = new ClaudeTranscript(false);
    transcript.apply({
      ...summary,
      message: { role: 'user', content: 'Just this.' },
    } as ClaudeMessage);
    expect(transcript.entries).toEqual([
      { kind: 'compaction', id: 'u-summary', summary: 'Just this.' },
    ]);
  });

  it('shows why a live compaction failed', () => {
    const { entries } = listened([
      { type: 'system', subtype: 'status', status: 'compacting' },
      {
        type: 'system',
        subtype: 'status',
        uuid: 's1',
        status: null,
        compact_result: 'failed',
        compact_error: 'Not enough messages to compact.',
      },
    ]);
    expect(entries).toEqual([
      { kind: 'compaction', id: 's1', error: 'Not enough messages to compact.' },
    ]);
  });

  it('shows a saved compaction as one, its summary, command and output left out', () => {
    const transcript = new ClaudeTranscript(false);
    const reply = {
      type: 'assistant',
      message: { id: 'msg_1', content: [{ type: 'text', text: 'Kept from before.' }] },
    };
    const next = { type: 'user', uuid: 'u-next', message: { role: 'user', content: 'Go on' } };
    for (const message of [summary, reply, command, printed, next])
      transcript.apply(message as ClaudeMessage, 1_000);
    expect(transcript.entries).toEqual([
      { kind: 'compaction', id: 'u-summary', at: 1_000, summary: written, trigger: 'manual' },
      { kind: 'agent', id: 'msg_1', blocks: [{ kind: 'text', text: 'Kept from before.' }] },
      { kind: 'user', id: 'u-next', text: 'Go on' },
    ]);
  });

  it('keeps what another local command printed', () => {
    const transcript = new ClaudeTranscript(false);
    transcript.apply(printed as ClaudeMessage);
    expect(transcript.entries).toEqual([
      {
        kind: 'user',
        id: 'u-printed',
        text: '<local-command-stdout>Compacted </local-command-stdout>',
      },
    ]);
  });
});
