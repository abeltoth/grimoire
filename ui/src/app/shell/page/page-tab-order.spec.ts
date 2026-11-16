import type { PageTab } from '../shell-registry';
import { arrange } from './page-tab-order';

const tabs = (...ids: string[]): PageTab[] => ids.map((id) => ({ id, label: id }));
const ids = (list: PageTab[]) => list.map((tab) => tab.id);

describe('page-tab-order', () => {
  it('puts the tabs you ordered in your order, and the rest where their feature put them', () => {
    expect(ids(arrange(tabs('a', 'b', 'c', 'd'), []))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(arrange(tabs('a', 'b', 'c', 'd'), ['d', 'c', 'b', 'a']))).toEqual([
      'd',
      'c',
      'b',
      'a',
    ]);
    // A tab added since keeps its place; one no longer there is passed over.
    expect(ids(arrange(tabs('a', 'new', 'b', 'c'), ['c', 'gone', 'b', 'a']))).toEqual([
      'c',
      'new',
      'b',
      'a',
    ]);
  });
});
