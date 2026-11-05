import { computed, effect, inject } from '@angular/core';
import { type Chapter, Chats } from '../core/chats';
import { Wording } from '../core/wording';
import { Facing } from './facing';
import { Focus } from './focus';
import type { ShellRegistry } from './shell-registry';

interface Note {
  label: string;
  detail: string;
  /** The chapter it opens, when it opens one. */
  opens?: string;
}

const sameNote = (a: Note | null, b: Note | null) =>
  a === b || (!!a && !!b && a.label === b.label && a.detail === b.detail && a.opens === b.opens);

/** "A", "A and B", "A, B and C". */
function list(names: readonly string[]): string {
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
    : (names[0] ?? '');
}

/**
 * In focus mode the ribbons are put away, so the running foot notes the
 * other chapters waiting for you: the slips awaiting your seal, which it
 * turns the facing page to, and the agents' questions, which it opens
 * the asking chapter at. The chapter on the desk shows its own on its page.
 */
export function noteWaitingChapters(shell: ShellRegistry): void {
  const focus = inject(Focus);
  const chats = inject(Chats);
  const facing = inject(Facing);
  const wording = inject(Wording);

  const others = computed(() =>
    focus.on() ? chats.all().filter((chapter) => chapter.id !== chats.currentId()) : [],
  );
  const title = (chapter: Chapter) => chapter.title || wording.untitled();

  const seals = computed<Note | null>(
    () => {
      const sealing = others().filter((c) => c.approvals.some((a) => !a.questions));
      if (!sealing.length) return null;
      const count = sealing.reduce(
        (sum, c) => sum + c.approvals.filter((a) => !a.questions).length,
        0,
      );
      const approvals = `${count} ${count === 1 ? 'approval' : 'approvals'}`;
      return {
        label: wording.say(`${approvals} awaiting your seal`, `${approvals} waiting`),
        detail: `From ${list(sealing.map(title))}`,
      };
    },
    { equal: sameNote },
  );

  const questions = computed<Note | null>(
    () => {
      const asking = others().filter((c) => c.approvals.some((a) => a.questions));
      if (!asking.length) return null;
      const [first] = asking;
      return {
        label:
          asking.length === 1
            ? `Questions from ${title(first!)}`
            : wording.say(
                `Questions from ${asking.length} chapters`,
                `Questions from ${asking.length} chats`,
              ),
        detail: `From ${list(asking.map(title))}`,
        opens: first!.id,
      };
    },
    { equal: sameNote },
  );

  effect((onCleanup) => {
    const note = seals();
    if (!note) return;
    onCleanup(
      shell.indicators.add({
        id: 'focus.seals',
        label: note.label,
        icon: 'seal',
        tone: 'alert',
        order: 0,
        detail: note.detail,
        open: () => facing.openSeals(),
      }),
    );
  });

  effect((onCleanup) => {
    const note = questions();
    if (!note) return;
    onCleanup(
      shell.indicators.add({
        id: 'focus.questions',
        label: note.label,
        icon: 'bell',
        tone: 'alert',
        order: 1,
        detail: note.detail,
        open: () => chats.open(note.opens!),
      }),
    );
  });
}
