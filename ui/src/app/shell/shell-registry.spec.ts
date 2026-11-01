import { Slot } from './shell-registry';

describe('Slot', () => {
  const slot = () => new Slot<{ id: string; order?: number }>();

  it('keeps entries in order, then in the order they were added', () => {
    const s = slot();
    s.add({ id: 'c', order: 20 });
    s.add({ id: 'a' });
    s.add({ id: 'b', order: 10 });
    s.add({ id: 'd' });
    expect(s.all().map((e) => e.id)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('removes an entry again', () => {
    const s = slot();
    const remove = s.add({ id: 'a' });
    s.add({ id: 'b' });
    remove();
    expect(s.all().map((e) => e.id)).toEqual(['b']);
    expect(s.get('a')).toBeUndefined();
  });

  it('refuses a second entry with the same id', () => {
    const s = slot();
    s.add({ id: 'a' });
    expect(() => s.add({ id: 'a' })).toThrow('"a" is already registered');
  });
});
