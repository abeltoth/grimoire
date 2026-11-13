import { TestBed } from '@angular/core/testing';
import { ChatList } from '@ui/app/core/chat-list';
import { fakeBridge, render, write } from '@ui/testing/app-testing';
import { PinsAndTags } from './pins-and-tags';

async function withPinsAndTags(setUp: (fake: ReturnType<typeof fakeBridge>) => void = () => {}) {
  const fake = fakeBridge();
  fake.answers['history.pinsAndTags'] = () => ({
    pins: { a: ['pin', 'star'] },
    tags: { a: ['ui'] },
  });
  setUp(fake);
  const rendered = await render(fake.bridge);
  return { ...fake, ...rendered, kept: TestBed.inject(PinsAndTags) };
}

describe('PinsAndTags', () => {
  it('reads the chats’ marks and tags from the service, and keeps them current', async () => {
    const { kept, emit } = await withPinsAndTags();
    expect(kept.pins('a')).toEqual(['pin', 'star']);
    expect(kept.tags('a')).toEqual(['ui']);
    expect(kept.pins('b')).toEqual([]);

    emit('history.pins', { chatId: 'a', pins: [] });
    emit('history.tags', { chatId: 'b', tags: ['later'] });
    expect(kept.pins('a')).toEqual([]);
    expect(kept.tags('b')).toEqual(['later']);
  });

  it('leaves every chat without pins or tags when the service can’t say', async () => {
    const { kept } = await withPinsAndTags((fake) => {
      fake.answers['history.pinsAndTags'] = () => Promise.reject(new Error('gone'));
    });
    expect(kept.pins('a')).toEqual([]);
    expect(kept.tags('a')).toEqual([]);
  });

  it('tags a chat as kept, at once, and puts the tags back when the service can’t keep them', async () => {
    const { kept, calls, answers } = await withPinsAndTags();
    await kept.tag('a', [' ui ', 'bug', 'UI', '']);
    expect(kept.tags('a')).toEqual(['ui', 'bug']);
    expect(calls.filter((c) => c.command === 'history.tag').map((c) => c.request)).toEqual([
      { chatId: 'a', tags: ['ui', 'bug'] },
    ]);

    // The same tags again ask nothing.
    await kept.tag('a', ['ui', 'bug']);
    expect(calls.filter((c) => c.command === 'history.tag')).toHaveLength(1);

    answers['history.tag'] = () => Promise.reject(new Error('The service is gone'));
    await expect(kept.tag('a', ['later'])).rejects.toThrow('The service is gone');
    expect(kept.tags('a')).toEqual(['ui', 'bug']);
  });

  it('keeps a blank chat’s tags here until it begins, then gives them to its chat', async () => {
    const { kept, calls, fixture, el } = await withPinsAndTags();
    const blank = TestBed.inject(ChatList).currentId()!;
    await kept.tag(blank, ['ui']);
    expect(calls.some((c) => c.command === 'history.tag')).toBe(false);
    await write(fixture, el, 'Go');
    expect(kept.tags(blank)).toEqual([]);
    expect(calls.filter((c) => c.command === 'history.tag').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', tags: ['ui'] },
    ]);
  });

  it('reads your tag list, and knows every tag there is: the list first, then the others', async () => {
    const { kept, emit, calls } = await withPinsAndTags((fake) => {
      fake.answers['history.tagList'] = () => ['bug', 'UI'];
      fake.answers['history.pinsAndTags'] = () => ({
        pins: {},
        tags: { a: ['ui', 'docs'], b: ['api'] },
      });
    });
    expect(kept.tagList()).toEqual(['bug', 'UI']);
    expect(kept.known()).toEqual(['bug', 'UI', 'api', 'docs']);

    emit('history.tagListChanged', { tags: ['docs'] });
    expect(kept.known()).toEqual(['docs', 'api', 'ui']);

    await kept.setList(['x']);
    await kept.rename('docs', 'notes');
    expect(calls.slice(-2).map((c) => [c.command, c.request])).toEqual([
      ['history.setTagList', { tags: ['x'] }],
      ['history.renameTag', { from: 'docs', to: 'notes' }],
    ]);
  });
});
