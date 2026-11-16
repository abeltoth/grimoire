import type { Entry } from '@grimoire/contract';
import { fromFolder, touchedFiles } from './touched';

const tool = (id: string, changed?: string) => ({
  kind: 'tool' as const,
  id,
  tool: 'Edit',
  input: {},
  result: { text: '', isError: false, ...(changed ? { changed } : {}) },
});

describe('touched', () => {
  it('lists the files the agent changed, the latest first, each once', () => {
    const entries: Entry[] = [
      {
        kind: 'agent',
        id: 'a1',
        blocks: [tool('t1', 'C:\\work\\a.ts'), tool('t2', 'C:/work/b.ts')],
      },
      { kind: 'user', id: 'u1', text: 'And again' },
      { kind: 'agent', id: 'a2', blocks: [tool('t3', 'C:/work/a.ts'), tool('t4')] },
    ];
    expect(touchedFiles(entries)).toEqual(['C:/work/a.ts', 'C:/work/b.ts']);
    expect(touchedFiles([])).toEqual([]);
  });

  it('names a file from the folder the page shows, when it is in it', () => {
    expect(fromFolder('C:\\Work\\app\\src\\a.ts', 'C:/work/app')).toBe('src/a.ts');
    expect(fromFolder('C:/elsewhere/b.ts', 'C:/work/app')).toBe('C:/elsewhere/b.ts');
    expect(fromFolder('C:/work/app/c.ts', null)).toBe('C:/work/app/c.ts');
  });
});
