import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Approval } from '@grimoire/contract';
import { RightPageState } from '@ui/app/shell/right-page/right-page-state';
import { useFakeBridge } from '@ui/testing/app-testing';
import { ApprovalStub } from './approval-stub';

@Component({
  imports: [ApprovalStub],
  template: `<gr-approval-stub [approval]="approval()" cwd="C:/repo" />`,
})
class Host {
  readonly approval = signal<Approval>({
    id: 'a1',
    chatId: 'c1',
    tool: 'Bash',
    input: { command: 'git push' },
  });
}

function stub() {
  useFakeBridge();
  const fixture = TestBed.createComponent(Host);
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('ApprovalStub', () => {
  it('says in one line what the approval asks, and opens it on the right page', async () => {
    const { fixture, el } = stub();
    await fixture.whenStable();
    expect(el.querySelector('b')!.textContent).toBe('¶ Awaiting your seal');
    expect(el.querySelector('code')!.textContent).toBe('git push');

    const rightPage = TestBed.inject(RightPageState);
    const open = vi.spyOn(rightPage, 'openApprovals');
    el.querySelector<HTMLButtonElement>('button')!.click();
    expect(open).toHaveBeenCalledWith('a1');
  });

  it('names the file a change is to, from the chat’s folder, or else the tool', async () => {
    const { fixture, el } = stub();
    fixture.componentInstance.approval.set({
      id: 'a2',
      chatId: 'c1',
      tool: 'Write',
      input: { file_path: 'C:/repo/src/a.ts', content: 'x' },
    });
    await fixture.whenStable();
    expect(el.querySelector('code')!.textContent).toBe('src/a.ts');

    fixture.componentInstance.approval.set({ id: 'a3', chatId: 'c1', tool: 'WebFetch', input: {} });
    await fixture.whenStable();
    expect(el.querySelector('code')!.textContent).toBe('WebFetch');
  });
});
