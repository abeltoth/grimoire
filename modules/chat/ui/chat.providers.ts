import { type EnvironmentProviders, effect, inject, untracked } from '@angular/core';
import { Chats } from '@ui/app/core/chats';
import { RightPageState } from '@ui/app/shell/right-page-state';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { ChatPage, SECOND_CHAT } from './chat-page';
import { SubagentPage } from './subagent-page';
import { SUBAGENT_PAGE, Subagents } from './subagents';
import { Plan, planFoot } from './plan';
import { ApprovalsPage } from './approvals-page';
import { SecondChat } from './second-chat';

/**
 * The chat module (ADR-008): it fills the left page with the open chat,
 * the right page's Plan with its plan, its Second chat with
 * another chat beside it, its Subagent with what a subagent one of a
 * chat's tool calls started did, and the right page with the waiting
 * approvals when it's turned there.
 */
export function provideChat(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    shell.chatPage.set(ChatPage);
    shell.approvalsPage.set(ApprovalsPage);
    const chats = inject(Chats);
    shell.rightPages.add({
      id: 'plan',
      label: 'Outline',
      plainLabel: 'Plan',
      order: 10,
      component: Plan,
      foot: () => planFoot(chats),
    });
    shell.rightPages.add({
      id: SECOND_CHAT,
      label: 'Second chapter',
      plainLabel: 'Second chat',
      order: 40,
      component: SecondChat,
      heading: () => chats.beside()?.title || undefined,
      whole: true,
    });
    const subagents = inject(Subagents);
    shell.rightPages.add({
      id: SUBAGENT_PAGE,
      label: 'Helper',
      plainLabel: 'Subagent',
      order: 45,
      component: SubagentPage,
      heading: () => {
        const input = subagents.block()?.input as { description?: unknown } | undefined;
        return typeof input?.description === 'string' && input.description ? input.description : undefined;
      },
      whole: true,
    });

    // A chat put beside the one you're on, or found there as the main window opens, shows on the right page.
    const rightPage = inject(RightPageState);
    effect(() => {
      if (chats.besideId()) untracked(() => rightPage.showPage(SECOND_CHAT));
    });
  });
}
