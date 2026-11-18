import { DEFAULT_SETTINGS } from '@grimoire/contract';
import { render, write } from '@ui/testing/app-testing';
import { button, field, issue, withBoard } from './kanban-testing';

/** The app on a synced board, a chat begun, and its card open on a new issue written out. */
async function writingIssue(settings: Partial<typeof DEFAULT_SETTINGS> = {}) {
  const fake = withBoard([
    issue('j1', 'GRIM-12', 'Context meter', 'todo'),
    issue('j2', 'GRIM-14', 'Usage page', 'doing'),
    issue('j3', 'OPS-3', 'Deploy', 'todo'),
  ]);
  fake.answers['kanban.jira'] = () => ({ status: 'synced', syncedAt: 0, syncing: false });
  fake.answers['settings.get'] = () => ({ ...DEFAULT_SETTINGS, jira: true, ...settings });
  const app = await render(fake.bridge);
  await write(app.fixture, app.el, 'Fill in the meter');
  app.el.querySelector<HTMLButtonElement>('gr-jira-link .toggle')!.click();
  await app.fixture.whenStable();
  return { ...fake, ...app };
}

const value = (el: HTMLElement, selector: string) =>
  el.querySelector<HTMLInputElement>(`gr-issue-form ${selector}`)!.value;

describe('IssueForm', () => {
  it('begins in the project most of the board’s issues are in, as a Task, and needs a summary', async () => {
    const { fixture, el, calls } = await writingIssue();
    expect(value(el, '.project')).toBe('GRIM');
    expect(value(el, '.type')).toBe('Task');
    const create = button(el.querySelector('gr-issue-form')!, 'Create in Jira');
    expect(create.getAttribute('aria-disabled')).toBe('true');

    field(el, 'gr-issue-form .summary', 'Draw the context meter');
    field(el, 'gr-issue-form .project', 'ops');
    await fixture.whenStable();
    create.click();
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'kanban.createIssue')!.request).toMatchObject({
      draft: {
        summary: 'Draw the context meter',
        description: '',
        project: 'OPS',
        issueType: 'Task',
      },
    });
  });

  it('begins in the project and type the settings name', async () => {
    const { el } = await writingIssue({ jiraProject: 'OPS', jiraIssueType: 'Story' });
    expect(value(el, '.project')).toBe('OPS');
    expect(value(el, '.type')).toBe('Story');
  });

  it('says why Jira didn’t create it, keeping what was written', async () => {
    const { fixture, el, jira } = await writingIssue();
    jira.refuse = 'Jira didn’t create the issue: valid project is required';
    field(el, 'gr-issue-form .summary', 'Draw the context meter');
    await fixture.whenStable();
    button(el.querySelector('gr-issue-form')!, 'Create in Jira').click();
    await fixture.whenStable();
    expect(el.querySelector('gr-issue-form .failed')!.textContent!.trim()).toBe(
      'Jira didn’t create the issue: valid project is required',
    );
    expect(value(el, '.summary')).toBe('Draw the context meter');
  });

  it('closes on Cancel or Esc, creating nothing', async () => {
    const { fixture, el, calls } = await writingIssue();
    el.querySelector('gr-issue-form .summary')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    expect(el.querySelector('gr-jira-link .card')).toBeNull();
    expect(calls.filter((c) => c.command === 'kanban.createIssue')).toEqual([]);
  });
});
