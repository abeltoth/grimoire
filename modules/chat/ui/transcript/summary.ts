import type { Deed, Margin, Note, Summary } from './row';

/** The notes beside a row, edits in a row to one file merged; more than one are summed up. */
export function margin(pending: Note[]): Margin {
  const notes = mergeEdits(pending);
  return notes.length > 1 ? { notes, summary: summarize(notes) } : { notes };
}

/** Changes in a row to the same file, none failed, read as one note: its counts added up, its edits stacked. */
function mergeEdits(notes: readonly Note[]): Note[] {
  const merged: Note[] = [];
  for (const note of notes) {
    const last = merged.at(-1);
    if (!last || !mergeable(last, note)) {
      merged.push(note);
      continue;
    }
    const before = last.details?.kind === 'diff' ? last.details : undefined;
    const after = note.details?.kind === 'diff' ? note.details : undefined;
    const added = (last.added ?? 0) + (note.added ?? 0);
    const removed = (last.removed ?? 0) + (note.removed ?? 0);
    merged[merged.length - 1] = {
      ...last,
      times: (last.times ?? 1) + 1,
      running: last.running || note.running,
      counts: `+${added} −${removed}`,
      added,
      removed,
      ...(before && after
        ? {
            details: {
              ...before,
              lines: [...before.lines, ...after.lines],
              breaks: [...(before.breaks ?? []), before.lines.length],
            },
          }
        : {}),
    };
  }
  return merged;
}

function mergeable(a: Note, b: Note): boolean {
  return (
    a.did === 'changed' &&
    b.did === 'changed' &&
    a.target === b.target &&
    !a.failed &&
    !b.failed &&
    !!a.withdrawn === !!b.withdrawn
  );
}

const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const DEEDS: Record<Deed, (n: number) => string> = {
  changed: (n) => `changed ${count(n, 'file', 'files')}`,
  read: (n) => `read ${count(n, 'file', 'files')}`,
  ran: (n) => `ran ${count(n, 'command', 'commands')}`,
  tested: (n) => `ran the tests ${times(n)}`,
  committed: (n) => `committed ${times(n)}`,
  searched: (n) => `searched ${times(n)}`,
  fetched: (n) => `fetched ${count(n, 'page', 'pages')}`,
  'searched-web': (n) => `searched the web ${times(n)}`,
  helped: (n) => `asked ${count(n, 'helper', 'helpers')}`,
  asked: (n) => `asked you ${times(n)}`,
  added: (n) => `added ${count(n, 'task', 'tasks')} to the board`,
  other: (n) => `used ${count(n, 'other tool', 'other tools')}`,
};

/** Sums up a run of notes, in the order the agent first did each thing; a file counts once. */
export function summarize(notes: readonly Note[]): Summary {
  const done = new Map<Deed, Set<string>>();
  notes.forEach((note, i) => {
    const each = done.get(note.did) ?? new Set<string>();
    const file = note.did === 'changed' || note.did === 'read';
    done.set(note.did, each.add(file ? note.target : String(i)));
  });
  const text = [...done].map(([deed, each]) => DEEDS[deed](each.size)).join(', ');
  const changes = notes.filter((note) => note.added !== undefined);
  const standing = changes.filter((note) => !note.withdrawn);
  const total = (lines: 'added' | 'removed') =>
    standing.reduce((sum, note) => sum + (note[lines] ?? 0), 0);
  return {
    key: `${notes[0]!.key}/all`,
    text: text.charAt(0).toUpperCase() + text.slice(1),
    ...(standing.length ? { counts: `+${total('added')} −${total('removed')}` } : {}),
    running: notes.some((note) => note.running),
    failed: notes.filter((note) => note.failed).length,
    withdrawn: changes.length > 0 && !standing.length,
  };
}
