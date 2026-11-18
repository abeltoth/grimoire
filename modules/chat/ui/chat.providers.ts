import { type EnvironmentProviders, effect, inject, untracked } from '@angular/core';
import { ChatList } from '@ui/app/core/chat-list';
import { RightPageState } from '@ui/app/shell/right-page/right-page-state';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { ChatPage, SECOND_CHAT } from './chat-page';
import { SUBAGENT_PAGE, Subagents } from './subagents/subagents';
import { planFoot } from './transcript/plan-foot';
import { Drafts } from './composer/drafts';
import { MarkdownView } from './markdown/markdown-view';

/**
 * The chat module: it fills the left page with the open chat,
 * the right page's Plan with its plan, its Second chat with
 * another chat beside it, its Subagent with what a subagent one of a
 * chat's tool calls started did, and the right page with the waiting
 * approvals when it's turned there. Text from elsewhere, such as a part
 * of a file in Files, is written into the open chat's message, and its
 * markdown view sets others' markdown, such as a file's in Files.
 */
export function provideChat(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.chatPage.set(ChatPage);
    shell.approvalsPage.set(() =>
      import('./approvals/approvals-page').then((m) => m.ApprovalsPage),
    );
    shell.markdownView.set(MarkdownView);
    const list = inject(ChatList);
    const drafts = inject(Drafts);
    shell.addToChat.set((text) => {
      const chatId = list.currentId();
      if (chatId) drafts.add(chatId, text);
    });
    shell.rightPages.add({
      id: 'plan',
      label: 'Outline',
      plainLabel: 'Plan',
      order: 10,
      load: () => import('./transcript/plan').then((m) => m.Plan),
      foot: () => planFoot(list.current()?.plan ?? []),
    });
    shell.rightPages.add({
      id: SECOND_CHAT,
      label: 'Second chapter',
      plainLabel: 'Second chat',
      order: 40,
      load: () => import('./second-chat').then((m) => m.SecondChat),
      heading: () => list.beside()?.title || undefined,
      whole: true,
    });
    const subagents = inject(Subagents);
    shell.rightPages.add({
      id: SUBAGENT_PAGE,
      label: 'Helper',
      plainLabel: 'Subagent',
      order: 45,
      load: () => import('./subagents/subagent-page').then((m) => m.SubagentPage),
      heading: () => {
        const input = subagents.block()?.input as { description?: unknown } | undefined;
        return typeof input?.description === 'string' && input.description
          ? input.description
          : undefined;
      },
      whole: true,
    });

    // A chat put beside the one you're on, or found there as the main window opens, shows on the right page.
    const rightPage = inject(RightPageState);
    effect(() => {
      if (list.besideId()) untracked(() => rightPage.showPage(SECOND_CHAT));
    });
  });
}
