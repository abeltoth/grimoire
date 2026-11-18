import { DEFAULT_SETTINGS } from '@grimoire/contract';
import { render, write } from '@ui/testing/app-testing';
import { button, issue, withBoard } from './kanban-testing';

/** A board with two Jira issues, synced, and Jira on unless `jira` says otherwise. */
function synced(jira = true) {
  const fake = withBoard([
    issue('j1', 'GRIM-12', 'Context meter', 'todo'),
    issue('j2', 'GRIM-14', 'Usage page', 'doing'),
  ]);
  fake.answers['kanban.jira'] = () => ({ status: 'synced', syncedAt: 0, syncing: false });
  fake.answers['settings.get'] = () => ({ ...DEFAULT_SETTINGS, jira });
  return fake;
}

describe('JiraLink', () => {
  it('says a begun chat has no Jira issue, and links it to one of the board’s', async () => {
    const { bridge, calls } = synced();
    const { fixture, el, texts } = await render(bridge);
    expect(el.querySelector('gr-jira-link .toggle')).toBeNull();

    await write(fixture, el, 'Fill in the meter');
    expect(texts('gr-jira-link .toggle')).toEqual(['No Jira issue']);
    el.querySelector<HTMLButtonElement>('gr-jira-link .toggle')!.click();
    await fixture.whenStable();
    expect(texts('gr-jira-link .issue .key')).toEqual(['GRIM-12', 'GRIM-14']);
    expect(texts('gr-jira-link .issue .summary')).toEqual(['Context meter', 'Usage page']);

    button(el.querySelector('gr-jira-link .card')!, 'GRIM-14Usage page').click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'kanban.link').map((c) => c.request)).toEqual([
      { id: 'j2', chatId: 'chat-1', agent: 'claude-code', cwd: 'C:/work/grimoire' },
    ]);
    expect(el.querySelector('gr-jira-link .toggle')).toBeNull();
    expect(texts('gr-header-badges button')).toEqual(['GRIM-14 · In Review']);
  });

  it('offers the issue the agent proposed, written in, and creates it in Jira', async () => {
    const { bridge, calls, propose } = synced();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Fill in the meter');
    const draft = {
      summary: 'Draw the context meter',
      description: 'From the usage events.',
      project: 'GRIM',
      issueType: 'Task',
    };
    propose('chat-1', draft);
    await fixture.whenStable();
    expect(texts('gr-jira-link .toggle')).toEqual(['Jira issue proposed']);

    el.querySelector<HTMLButtonElement>('gr-jira-link .toggle')!.click();
    await fixture.whenStable();
    const value = (selector: string) =>
      el.querySelector<HTMLInputElement>(`gr-issue-form ${selector}`)!.value;
    expect([value('.summary'), value('.description'), value('.project'), value('.type')]).toEqual([
      'Draw the context meter',
      'From the usage events.',
      'GRIM',
      'Task',
    ]);
    button(el.querySelector('gr-issue-form')!, 'Create in Jira').click();
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'kanban.createIssue')!.request).toEqual({
      chat: { chatId: 'chat-1', agent: 'claude-code', cwd: 'C:/work/grimoire' },
      draft,
    });
    expect(el.querySelector('gr-jira-link .toggle')).toBeNull();
    expect(texts('gr-header-badges button')).toEqual(['GRIM-103 · To Do']);
  });

  it('puts the agent’s proposal away when it is dismissed', async () => {
    const { bridge, calls, propose } = synced();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Go');
    propose('chat-1', { summary: 'A', description: '', project: 'GRIM', issueType: 'Task' });
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('gr-jira-link .toggle')!.click();
    await fixture.whenStable();
    button(el.querySelector('gr-issue-form')!, 'Dismiss').click();
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'kanban.dismissProposal')!.request).toEqual({
      chatId: 'chat-1',
    });
    expect(texts('gr-jira-link .toggle')).toEqual(['No Jira issue']);
    expect(el.querySelector('gr-jira-link .card')).toBeNull();
  });

  it('closes its card on Esc, without stopping the chat', async () => {
    const { bridge, calls } = synced();
    const { fixture, el } = await render(bridge);
    await write(fixture, el, 'Go');
    el.querySelector<HTMLButtonElement>('gr-jira-link .toggle')!.click();
    await fixture.whenStable();
    el.querySelector('gr-jira-link .card')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    expect(el.querySelector('gr-jira-link .card')).toBeNull();
    expect(calls.filter((c) => c.command === 'agents.interrupt')).toEqual([]);
  });

  it('shows nothing while Jira is turned off', async () => {
    const { bridge } = synced(false);
    const { fixture, el } = await render(bridge);
    await write(fixture, el, 'Go');
    expect(el.querySelector('gr-jira-link .toggle')).toBeNull();
  });

  it('shows nothing where there’s no Atlassian connector', async () => {
    const { bridge, answers } = synced();
    answers['kanban.jira'] = () => ({ status: 'none', syncing: false });
    const { fixture, el } = await render(bridge);
    await write(fixture, el, 'Go');
    expect(el.querySelector('gr-jira-link .toggle')).toBeNull();
  });
});
