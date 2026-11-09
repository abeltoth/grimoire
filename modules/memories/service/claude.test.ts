import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  indexEntries,
  linksIn,
  memorySettings,
  projectFolderName,
  readHeader,
  readMemories,
  toMemories,
} from './claude';

const memory = (name: string, type: string, body: string, description = `About ${name}`) =>
  `---\nname: ${name}\ndescription: "${description}"\nmetadata:\n  node_type: memory\n  type: ${type}\n  modified: 2026-10-31T22:01:13.499Z\n---\n\n${body}\n`;

describe('projectFolderName', () => {
  it('writes every character but letters and digits as "-"', () => {
    expect(projectFolderName('C:\\Users\\Abel\\Git\\grimoire')).toBe('C--Users-Abel-Git-grimoire');
    expect(projectFolderName('/home/me/git/my_app.v2')).toBe('-home-me-git-my-app-v2');
  });

  it('finds a long folder’s shortened name, hash and all, by its start', () => {
    const cwd = `/home/me/${'deep/'.repeat(60)}project`;
    const start = cwd.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 200);
    expect(projectFolderName(cwd, ['other', `${start}-1x2y3z`])).toBe(`${start}-1x2y3z`);
    expect(projectFolderName(cwd, [])).toBe(start);
  });
});

describe('readHeader', () => {
  it('reads the name, description and kind, nested or not, and the text after', () => {
    expect(readHeader(memory('scope-discipline', 'feedback', 'Do what is asked.'))).toEqual({
      name: 'scope-discipline',
      description: 'About scope-discipline',
      type: 'feedback',
      body: '\nDo what is asked.\n',
    });
    expect(readHeader("---\r\nname: 'it''s'\r\ntype: user\r\n---\r\nHi")).toEqual({
      name: "it's",
      type: 'user',
      body: 'Hi',
    });
  });

  it('takes a file without a header as all text, and leaves folded values out', () => {
    expect(readHeader('Just text')).toEqual({ body: 'Just text' });
    expect(readHeader('---\nname: a\ndescription: >\n  folded\n---\nx')).toEqual({
      name: 'a',
      body: 'x',
    });
  });
});

describe('linksIn', () => {
  it('finds each [[link]] once, in order, without what follows a | or #', () => {
    expect(linksIn('See [[b]], [[a|the a]] and [[b#part]]; not [single] or [[]].')).toEqual([
      'b',
      'a',
    ]);
  });
});

describe('indexEntries', () => {
  it('reads the index’s "- [title](file.md)" lines', () => {
    const index =
      '# Memory Index\n\n## Feedback\n\n- [scope](feedback_scope.md) — Do what is asked\n* [other](sub%20dir.md)\n- not a link\n';
    expect(indexEntries(index)).toEqual([
      { title: 'scope', file: 'feedback_scope.md' },
      { title: 'other', file: 'sub dir.md' },
    ]);
  });
});

describe('toMemories', () => {
  const folder = path.join(path.sep, 'mem');
  const files = [
    {
      file: 'feedback_scope.md',
      text: memory('scope-discipline', 'feedback', 'See [[concise-answers]].'),
      changedAt: 1,
    },
    {
      file: 'project_app.md',
      text: memory(
        'app-decisions',
        'project',
        'Follows [[scope-discipline]] and [[feedback_scope]].',
      ),
      changedAt: 2,
    },
    { file: 'loose.md', text: 'No header, links [[app-decisions]].', changedAt: 3 },
  ];

  it('lists each memory with its kind, links and whether the index lists it', () => {
    const { memories } = toMemories(
      folder,
      files,
      '- [scope](feedback_scope.md)\n- [app](project_app.md)\n',
    );
    expect(memories).toEqual([
      {
        name: 'scope-discipline',
        path: path.join(folder, 'feedback_scope.md'),
        description: 'About scope-discipline',
        type: 'feedback',
        changedAt: 1,
        links: ['concise-answers'],
        indexed: true,
      },
      {
        name: 'app-decisions',
        path: path.join(folder, 'project_app.md'),
        description: 'About app-decisions',
        type: 'project',
        changedAt: 2,
        links: ['scope-discipline', 'feedback_scope'],
        indexed: true,
      },
      {
        name: 'loose',
        path: path.join(folder, 'loose.md'),
        type: '',
        changedAt: 3,
        links: ['app-decisions'],
        indexed: false,
      },
    ]);
  });

  it('says which index lines and links point at nothing, and what the index leaves out', () => {
    const { problems } = toMemories(
      folder,
      files,
      '- [scope](feedback_scope.md)\n- [gone](feedback_gone.md)\n- [app](project_app.md)\n',
    );
    expect(problems).toEqual([
      'The index lists feedback_gone.md, which doesn’t exist.',
      'scope-discipline links to [[concise-answers]], which doesn’t exist.',
      'The index leaves out loose.',
    ]);
  });

  it('doesn’t miss an index that isn’t there for every memory', () => {
    expect(toMemories(folder, files.slice(0, 1), undefined).problems).toEqual([
      'scope-discipline links to [[concise-answers]], which doesn’t exist.',
    ]);
  });
});

describe('memorySettings', () => {
  const home = path.join(path.sep, 'home', 'me');

  it('keeps memory on in the usual folder unless the settings say otherwise', () => {
    expect(memorySettings([], home)).toEqual({ enabled: true });
    expect(
      memorySettings(
        [
          {
            source: 'user',
            settings: { autoMemoryEnabled: false, autoMemoryDirectory: '~/notes' },
          },
          { source: 'local', settings: { autoMemoryEnabled: true } },
        ],
        home,
      ),
    ).toEqual({ enabled: true, directory: path.join(home, 'notes') });
  });

  it('won’t let the project’s settings move the memory folder', () => {
    expect(
      memorySettings(
        [
          {
            source: 'project',
            settings: { autoMemoryDirectory: '/elsewhere', autoMemoryEnabled: false },
          },
        ],
        home,
      ),
    ).toEqual({ enabled: false });
  });
});

describe('readMemories', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('reads the folder’s memories and index, and the other folders that keep some', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'grimoire-memories-'));
    const home = path.join(dir, 'home');
    const cwd = path.join(dir, 'work', 'app');
    const projects = path.join(home, '.claude', 'projects');
    const own = path.join(projects, projectFolderName(cwd), 'memory');
    const other = path.join(projects, 'C--elsewhere');
    mkdirSync(own, { recursive: true });
    mkdirSync(path.join(other, 'memory'), { recursive: true });
    mkdirSync(path.join(projects, 'C--empty', 'memory'), { recursive: true });
    writeFileSync(path.join(own, 'MEMORY.md'), '- [a](a.md)\n');
    writeFileSync(path.join(own, 'a.md'), memory('a', 'user', 'Hi'));
    writeFileSync(path.join(own, 'notes.txt'), 'not a memory');
    writeFileSync(path.join(other, 'memory', 'b.md'), memory('b', 'project', ''));
    writeFileSync(path.join(other, 'memory', 'c.md'), memory('c', 'project', ''));
    writeFileSync(
      path.join(other, 'chat.jsonl'),
      `{"type":"user","cwd":"C:\\\\elsewhere","message":{}}\n`,
    );

    const read = readMemories({
      cwd,
      claudeFolder: path.join(home, '.claude'),
      settings: { enabled: true },
      at: 7,
    });
    expect(read).toMatchObject({
      cwd,
      folder: own,
      index: { path: path.join(own, 'MEMORY.md'), exists: true },
      enabled: true,
      problems: [],
      elsewhere: [{ cwd: 'C:\\elsewhere', count: 2 }],
      at: 7,
    });
    expect(read.memories.map((m) => m.name)).toEqual(['a']);
  });

  it('reads the folder the settings move memory to', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'grimoire-memories-'));
    const moved = path.join(dir, 'notes');
    mkdirSync(moved);
    writeFileSync(path.join(moved, 'x.md'), memory('x', 'user', ''));
    const read = readMemories({
      cwd: dir,
      claudeFolder: dir,
      settings: { enabled: true, directory: moved },
      at: 1,
    });
    expect(read.folder).toBe(moved);
    expect(read.index.exists).toBe(false);
    expect(read.memories.map((m) => m.name)).toEqual(['x']);
  });
});
