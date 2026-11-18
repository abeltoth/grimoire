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
    expect(
      fields.map((field) => [field.name, field.kind, 'value' in field && field.value]),
    ).toEqual([
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

  it('indents a long list of lists as JSON', () => {
    const items = Array.from({ length: 30 }, (_, i) => [i, i * 2]);
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

  it('reads a long list of objects item by item, their HTML by the format around them', () => {
    const edits = [
      { name: 'replaceNode', localId: 'be4b', value: long('<td><p>Send it</p></td>') },
      { name: 'insertNodeAfter', localId: '8c47', value: long('Plain words') },
    ];
    const [field] = inputFields({ edits });
    expect(field?.kind).toBe('list');
    if (field?.kind !== 'list') return;
    expect(field.items.map((item) => item.map((f) => [f.name, f.kind]))).toEqual([
      [
        ['name', 'short'],
        ['localId', 'short'],
        ['value', 'html'],
      ],
      [
        ['name', 'short'],
        ['localId', 'short'],
        ['value', 'text'],
      ],
    ]);
    const [, withFormat] = inputFields({ contentFormat: 'markdown', edits });
    expect(withFormat?.kind === 'list' && withFormat.items[0]![2]!.kind).toBe('markdown');
  });

  it('reads a long object field by field, and one nested too deep as JSON', () => {
    const deep = { a: { b: { c: { d: long('x') } } } };
    const [field] = inputFields({ deep });
    expect(field?.kind).toBe('group');
    const c = (field as { fields: { fields: { fields: { kind: string }[] }[] }[] }).fields[0]!
      .fields[0]!.fields[0]!;
    expect(c.kind).toBe('json');
  });

  it('keeps a list that is not all objects as JSON', () => {
    expect(inputFields({ ids: Array.from({ length: 30 }, (_, i) => i) })[0]?.kind).toBe('json');
    expect(inputFields({ mixed: [{ a: long('x') }, 'b'] })[0]?.kind).toBe('json');
  });

  it('has no fields for an input that is not an object', () => {
    expect(inputFields(undefined)).toEqual([]);
    expect(inputFields('ls')).toEqual([]);
    expect(inputFields(['a'])).toEqual([]);
  });
});
