import type {
  CommandRequest,
  FolderEntry,
  GitStatus,
  GrimoireBridge,
  OpenFile,
} from '@grimoire/contract';
import { MONACO, type MonacoApi } from './monaco';
import { fakeBridge, render } from '@ui/testing/app-harness';

/** What the Files specs share, first the VS Code editor, faked as a text box for each side it shows. */
export function fakeMonaco() {
  const made: { editors: number; diffs: number; themes: string[]; revealed: number } = {
    editors: 0,
    diffs: 0,
    themes: [],
    revealed: 0,
  };
  const modelOf = (text: string, language: string) => {
    const listeners = new Set<() => void>();
    let value = text;
    return {
      language,
      getValue: () => value,
      setValue: (next: string) => {
        value = next;
        listeners.forEach((listener) => listener());
      },
      onDidChangeContent: (listener: () => void) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
      dispose: () => listeners.clear(),
    };
  };
  type Model = ReturnType<typeof modelOf>;
  const box = (
    host: HTMLElement,
    model: Model,
    side: string,
    commands: Map<number, () => void>,
  ) => {
    const area = document.createElement('textarea');
    area.className = `fake-editor ${side}`;
    area.dataset['language'] = model.language;
    area.value = model.getValue();
    area.addEventListener('input', () => model.setValue(area.value));
    area.addEventListener('keydown', (event) => {
      if (event.ctrlKey && event.key === 's') commands.get(2048 | 49)?.();
    });
    const shown = model.onDidChangeContent(() => (area.value = model.getValue()));
    host.append(area);
    return {
      saveViewState: () => ({}),
      restoreViewState: () => undefined,
      addCommand: (keys: number, run: () => void) => void commands.set(keys, run),
      dispose: () => {
        shown.dispose();
        area.remove();
      },
    };
  };
  const monaco = {
    Uri: { from: (parts: unknown) => parts },
    KeyMod: { CtrlCmd: 2048 },
    KeyCode: { KeyS: 49 },
    languages: {
      getLanguages: () => [
        { id: 'typescript', extensions: ['.ts'] },
        { id: 'markdown', extensions: ['.md'] },
      ],
    },
    editor: {
      defineTheme: (name: string) => void made.themes.push(name),
      createModel: (text: string, language: string) => modelOf(text, language),
      create: (host: HTMLElement, options: { model: Model }) => {
        made.editors++;
        return box(host, options.model, 'file', new Map());
      },
      createDiffEditor: (host: HTMLElement) => {
        made.diffs++;
        const commands = new Map<number, () => void>();
        let sides: ReturnType<typeof box>[] = [];
        let modified: ReturnType<typeof box> | undefined;
        return {
          setModel: (models: { original: Model; modified: Model }) => {
            const original = box(host, models.original, 'committed', new Map());
            modified = box(host, models.modified, 'file', commands);
            sides = [original, modified];
          },
          getModifiedEditor: () => modified!,
          revealFirstDiff: () => void made.revealed++,
          dispose: () => sides.forEach((side) => side.dispose()),
        };
      },
    },
  };
  return { load: async () => monaco as unknown as MonacoApi, made };
}

export const entries = (folder: string, names: string[], ignored: string[] = []): FolderEntry[] =>
  names.map((name) => {
    const path = folder ? `${folder}/${name.replace(/\/$/, '')}` : name.replace(/\/$/, '');
    return {
      name: name.replace(/\/$/, ''),
      path,
      kind: name.endsWith('/') ? 'folder' : 'file',
      ...(ignored.includes(name) ? { ignored: true } : {}),
    };
  });

/** A repository with a few files, one of them changed and one new. */
export function repository() {
  const fake = fakeBridge();
  const { answers } = fake;
  const disk: Record<string, OpenFile> = {
    'README.md': { path: 'README.md', text: '# Grimoire\n', changedAt: 1 },
    'ui/src/ribbon.ts': {
      path: 'ui/src/ribbon.ts',
      text: 'export const ribbon = 2;\n',
      changedAt: 1,
      committed: 'export const ribbon = 1;\n',
    },
    'ui/src/seal.ts': {
      path: 'ui/src/seal.ts',
      text: 'export const seal = 1;\n',
      changedAt: 1,
      committed: null,
    },
    'logo.png': { path: 'logo.png', text: '', changedAt: 1, unshown: 'binary' },
  };
  answers['files.list'] = (request: CommandRequest<'files.list'>) => ({
    root: 'C:/Users/me/git/grimoire',
    entries:
      request.path === ''
        ? entries('', ['dist/', 'ui/', 'logo.png', 'README.md'], ['dist/'])
        : request.path === 'ui'
          ? entries('ui', ['src/'])
          : request.path === 'ui/src'
            ? entries('ui/src', ['ribbon.ts', 'seal.ts'])
            : [],
  });
  disk['C:/Users/me/.claude/CLAUDE.md'] = {
    path: 'C:/Users/me/.claude/CLAUDE.md',
    text: '# Mine\n',
    changedAt: 1,
  };
  // Written in full inside the folder, a file is named from it, as the service does.
  answers['files.open'] = (request: CommandRequest<'files.open'>) =>
    disk[request.path.replace(/^C:\/(Users\/me\/git|work)\/grimoire\//, '')];
  answers['git.diff'] = () => [
    { kind: 'removed', text: 'export const ribbon = 1;' },
    { kind: 'inserted', text: 'export const ribbon = 2;' },
  ];
  answers['files.save'] = (request: CommandRequest<'files.save'>) =>
    (disk[request.path] = { ...disk[request.path]!, text: request.text, changedAt: 2 });
  answers['files.find'] = (request: CommandRequest<'files.find'>) =>
    Object.keys(disk).filter((path) => path.includes(request.query));
  answers['git.status'] = (): GitStatus => ({
    root: 'C:/Users/me/git/grimoire',
    branch: 'master',
    head: 'abc1234',
    changes: [
      { path: 'ui/src/ribbon.ts', kind: 'modified', staged: false },
      { path: 'ui/src/seal.ts', kind: 'new', staged: false },
      { path: 'old.txt', kind: 'deleted', staged: false },
    ],
  });
  return { ...fake, disk };
}

export async function openFiles(bridge: GrimoireBridge) {
  const monaco = fakeMonaco();
  const rendered = await render(bridge, [{ provide: MONACO, useValue: monaco.load }]);
  [...rendered.el.querySelectorAll<HTMLButtonElement>('.tabs button')]
    .find((tab) => tab.textContent!.trim() === 'Files')!
    .click();
  await rendered.fixture.whenStable();
  const page = () => rendered.el.querySelector('gr-files-page')!;
  const button = (selector: string, text: string) =>
    [...page().querySelectorAll<HTMLButtonElement>(selector)].find(
      (b) => b.textContent!.replace(/\s+/g, ' ').trim() === text,
    )!;
  const editor = (side = 'file') =>
    page().querySelector<HTMLTextAreaElement>(`.fake-editor.${side}`);
  const type = async (text: string) => {
    const area = editor()!;
    area.value = text;
    area.dispatchEvent(new Event('input'));
    await rendered.fixture.whenStable();
  };
  return { ...rendered, made: monaco.made, page, button, editor, type };
}
