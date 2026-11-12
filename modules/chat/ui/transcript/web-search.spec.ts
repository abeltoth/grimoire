import { parseWebSearch } from './web-search';

const result = (...lines: string[]) =>
  ['Web search results for query: "angular signals"', '', ...lines].join('\n');

describe('parseWebSearch', () => {
  it('reads the query, the pages found and the summary, without the word to cite them', () => {
    const text = result(
      'Links: [{"title":"Signals","url":"https://angular.dev/guide/signals"},{"title":"","url":"https://example.com/a"}]',
      '',
      'Signals hold **state**.',
      '',
      '- one',
      '',
      '',
      'REMINDER: You MUST include the sources above in your response to the user using markdown hyperlinks.',
    );
    expect(parseWebSearch(text)).toEqual({
      query: 'angular signals',
      sources: [
        { title: 'Signals', url: 'https://angular.dev/guide/signals' },
        { title: 'https://example.com/a', url: 'https://example.com/a' },
      ],
      summary: 'Signals hold **state**.\n\n- one',
    });
  });

  it('gathers the pages of every search it ran, each once', () => {
    const text = result(
      'Links: [{"title":"A","url":"https://a.dev"}]',
      'First.',
      'Links: [{"title":"A again","url":"https://a.dev"},{"title":"B","url":"https://b.dev"}]',
      'Second.',
    );
    expect(parseWebSearch(text)?.sources).toEqual([
      { title: 'A', url: 'https://a.dev' },
      { title: 'B', url: 'https://b.dev' },
    ]);
    expect(parseWebSearch(text)?.summary).toBe('First.\nSecond.');
  });

  it('leaves text of any other shape alone', () => {
    expect(parseWebSearch('Error: search failed')).toBeUndefined();
    expect(parseWebSearch(result('Links: [{"title":"A",]'))).toBeUndefined();
  });
});
