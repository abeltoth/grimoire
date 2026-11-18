import { inputFields } from './tool-input';

describe('inputFields', () => {
  const long = (text: string) => text + ' and so on'.repeat(10);

  it('puts short values in the grid first, anything not text as JSON', () => {
    const fields = inputFields({
      body: long('Plain words'),
      url: 'https://x.dev',
      retries: 2,
      tags: ['a'],
      none: null,
    });
    expect(fields.map((field) => [field.name, field.kind, field.value])).toEqual([
      ['url', 'short', 'https://x.dev'],
      ['retries', 'short', '2'],
      ['tags', 'short', '["a"]'],
      ['none', 'short', 'null'],
      ['body', 'text', long('Plain words')],
    ]);
  });

  it('sets a line break or a long value apart', () => {
    expect(inputFields({ prompt: 'Say hi\nthen go' })[0]).toEqual({
      name: 'prompt',
      kind: 'text',
      value: 'Say hi\nthen go',
    });
  });

  it('indents a long object as JSON', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    expect(inputFields({ items })[0]).toEqual({
      name: 'items',
      kind: 'json',
      value: JSON.stringify(items, null, 2),
    });
  });

  it('reads HTML by the format the input gives, with a markdown preview', () => {
    const body = long('<p>Hi</p>');
    expect(inputFields({ contentFormat: 'storage', body })[1]).toEqual({
      name: 'body',
      kind: 'html',
      value: body,
      preview: expect.stringContaining('Hi'),
    });
  });

  it('reads HTML by its tags when no format is given', () => {
    expect(inputFields({ body: long('<table><tr><td>x</td></tr></table>') })[0]?.kind).toBe('html');
  });

  it('reads markdown by the format given or by its headings, lists and fences', () => {
    expect(inputFields({ format: 'markdown', body: long('<b>x</b>') })[1]?.kind).toBe('markdown');
    expect(inputFields({ body: long('# Title\n\nWords') })[0]?.kind).toBe('markdown');
    expect(inputFields({ body: long('Intro\n- one\n- two') })[0]?.kind).toBe('markdown');
  });

  it('has no fields for an input that is not an object', () => {
    expect(inputFields(undefined)).toEqual([]);
    expect(inputFields('ls')).toEqual([]);
    expect(inputFields(['a'])).toEqual([]);
  });
});
