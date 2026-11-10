import { computed, effect, inject } from '@angular/core';
import { type Chat } from '../core/chat';
import { ChatList } from '../core/chat-list';
import { Wording } from '../core/wording';
import { RightPageState } from './right-page-state';
import { Focus } from './focus';
import type { ShellRegistry } from './shell-registry';

interface Note {
  label: string;
  detail: string;
  /** The chat it opens, when it opens one. */
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
 * In focus mode the chat tabs are put away, so the page footer notes the
 * other chats waiting for you: the waiting approvals, which it
 * turns the right page to, and the agents' questions, which it opens
 * the asking chat at. The chat on the desk shows its own on its page.
 */
export function noteWaitingChats(shell: ShellRegistry): void {
  const focus = inject(Focus);
  const chatList = inject(ChatList);
  const rightPage = inject(RightPageState);
  const wording = inject(Wording);

  const others = computed(() =>
    focus.on() ? chatList.all().filter((chat) => chat.id !== chatList.currentId()) : [],
  );
  const title = (chat: Chat) => chat.title || wording.untitled();

  const approvals = computed<Note | null>(
    () => {
      const awaitingApproval = others().filter((c) => c.approvals.some((a) => !a.questions));
      if (!awaitingApproval.length) return null;
      const count = awaitingApproval.reduce(
        (sum, c) => sum + c.approvals.filter((a) => !a.questions).length,
        0,
      );
      const counted = `${count} ${count === 1 ? 'approval' : 'approvals'}`;
      return {
        label: wording.say(`${counted} awaiting your seal`, `${counted} waiting`),
        detail: `From ${list(awaitingApproval.map(title))}`,
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
    const note = approvals();
    if (!note) return;
    onCleanup(
      shell.indicators.add({
        id: 'focus.approvals',
        label: note.label,
        icon: 'approval',
        tone: 'alert',
        order: 0,
        detail: note.detail,
        open: () => rightPage.openApprovals(),
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
        open: () => chatList.open(note.opens!),
      }),
    );
  });
}
