import { InjectionToken } from '@angular/core';
import type * as Monaco from 'monaco-editor';

/** The VS Code editor's API (Monaco). */
export type MonacoApi = typeof Monaco;

/**
 * Loads the VS Code editor once, the first time a file opens, from the
 * prebuilt files the build serves as /vs (ui/tools/copy-monaco.mjs), so
 * it isn't in the app's own bundle. Tests give a fake.
 */
export const MONACO = new InjectionToken<() => Promise<MonacoApi>>('Monaco', {
  providedIn: 'root',
  factory: () => loadMonaco,
});

/** The editor's AMD loader, which its prebuilt files come with. */
interface AmdRequire {
  (modules: string[], loaded: (monaco: MonacoApi) => void, failed: (error: unknown) => void): void;
  config(options: { paths: Record<string, string> }): void;
}

let loading: Promise<MonacoApi> | undefined;

function loadMonaco(): Promise<MonacoApi> {
  loading ??= load();
  loading.catch(() => (loading = undefined));
  return loading;
}

async function load(): Promise<MonacoApi> {
  const at = (file: string) => new URL(`vs/${file}`, document.baseURI).href;
  const workers = (await (await fetch(at('workers.json'))).json()) as Record<string, string>;
  await script(at('loader.js'));
  const amd = (window as unknown as { require: AmdRequire }).require;
  amd.config({ paths: { vs: at('').replace(/\/$/, '') } });
  const monaco = await new Promise<MonacoApi>((resolve, reject) =>
    amd(['vs/editor/editor.main'], resolve, reject),
  );

  // The page lets workers start only from the app's own files, not from blobs as the editor would.
  const worker = (label: string) => workers[workerFor(label)] ?? workers['editor']!;
  (self as unknown as { MonacoEnvironment: Monaco.Environment }).MonacoEnvironment = {
    getWorker: (_id, label) => new Worker(at(`assets/${worker(label)}`)),
  };
  // Nor fonts from the inline data the editor's styles carry: its icons come from a file, after them.
  const icons = document.createElement('style');
  icons.textContent = `@font-face { font-family: codicon; font-display: block; src: url("${at('codicon.ttf')}") format("truetype"); }`;
  document.head.append(icons);
  // Without the whole project, TypeScript would find every import missing; mistakes in a file still show.
  for (const defaults of [
    monaco.typescript.typescriptDefaults,
    monaco.typescript.javascriptDefaults,
  ]) {
    defaults.setDiagnosticsOptions({ noSemanticValidation: true });
  }
  return monaco;
}

/** Which of the editor's workers serves a language. */
function workerFor(label: string): string {
  if (label === 'json') return 'json';
  if (['css', 'scss', 'less'].includes(label)) return 'css';
  if (['html', 'handlebars', 'razor'].includes(label)) return 'html';
  if (['typescript', 'javascript'].includes(label)) return 'ts';
  return 'editor';
}

function script(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const element = document.createElement('script');
    element.src = src;
    element.onload = () => resolve();
    element.onerror = () => reject(new Error('The VS Code editor couldn’t be loaded'));
    document.head.append(element);
  });
}

/** The language a file is written in, by its name, as the editor knows them; plain text otherwise. */
export function languageOf(monaco: MonacoApi, file: string): string {
  const name = file.slice(file.lastIndexOf('/') + 1).toLowerCase();
  let best: { id: string; length: number } | undefined;
  for (const language of monaco.languages.getLanguages()) {
    if (language.filenames?.some((known) => known.toLowerCase() === name)) return language.id;
    for (const extension of language.extensions ?? []) {
      const lower = extension.toLowerCase();
      if (name.endsWith(lower) && lower.length > (best?.length ?? 0))
        best = { id: language.id, length: lower.length };
    }
  }
  return best?.id ?? 'plaintext';
}
