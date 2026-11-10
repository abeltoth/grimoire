import { render } from '@ui/testing/app-harness';
import { card, withBoard, openBoard, cardEl, button, board, field } from './kanban-testing';

describe('card-form', () => {
  it('writes a new card at the foot of To do, in the folder of the chat you’re on, and changes it in place', async () => {
    const { bridge, calls, answers } = withBoard([card('a', 'Write ribbon tests', 'todo')]);
    answers['layout.get'] = () => ({
      current: null,
      lastUsed: { agent: 'claude-code', settings: { cwd: 'C:/Users/me/git/breeder' } },
    });
    const { fixture, el, texts } = await render(bridge);
    await openBoard(fixture, el);
    expect(texts('gr-tab-page .title')).toEqual(['Kanban']);
    expect(texts('gr-kanban-page h3')).toEqual(['To do 1', 'In progress 0', 'Done 0']);

    el.querySelector<HTMLButtonElement>('gr-kanban-page .add')!.click();
    await fixture.whenStable();
    expect(texts('gr-card-form [aria-checked="true"]')).toEqual(['~/git/breeder']);
    field(el, 'gr-card-form .name', 'Add dark theme tokens');
    field(el, 'gr-card-form .notes', 'The night theme first.');
    el.querySelector<HTMLButtonElement>('gr-card-form .send')!.click();
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'kanban.save')!.request).toEqual({
      title: 'Add dark theme tokens',
      notes: 'The night theme first.',
      cwd: 'C:/Users/me/git/breeder',
    });
    expect(el.querySelector('gr-card-form')).toBeNull();
    expect(board(texts).todo).toEqual(['Write ribbon tests', 'Add dark theme tokens']);
    expect(texts('[data-card="card-2"] .notes')).toEqual(['The night theme first.']);
    expect(texts('[data-card="card-2"] .where')).toEqual(['~/git/breeder']);

    button(cardEl(el, 'Add dark theme tokens'), 'Change').click();
    await fixture.whenStable();
    expect(el.querySelector<HTMLInputElement>('gr-card-form .name')!.value).toBe(
      'Add dark theme tokens',
    );
    field(el, 'gr-card-form .name', 'Add night theme tokens');
    button(el.querySelector('gr-card-form')!, '~/git/grimoire').click();
    el.querySelector<HTMLButtonElement>('gr-card-form .send')!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'kanban.save').at(-1)!.request).toEqual({
      id: 'card-2',
      title: 'Add night theme tokens',
      notes: 'The night theme first.',
      cwd: 'C:/Users/me/git/grimoire',
    });
    expect(board(texts).todo).toEqual(['Write ribbon tests', 'Add night theme tokens']);
  });
});
