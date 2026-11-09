// Copies the VS Code editor's prebuilt files (monaco-editor/min/vs) into
// ui/vendor/vs, which the build serves as /vs. The Files page loads the
// editor from there when it first opens a file, so it isn't in the app's
// own bundle. Copied again only when the editor's version changes.
//
// The page's content security policy lets scripts, workers and fonts come
// only from the app itself, so beside them go the names of the editor's
// workers, to start each from its own file rather than a blob, and its icon
// font as a file, which its styles carry inline.
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ui = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Where npm put it: in the UI's own node_modules, or hoisted to a folder above.
const pkg = [ui, path.dirname(ui)]
  .map((folder) => path.join(folder, 'node_modules', 'monaco-editor', 'package.json'))
  .find((file) => existsSync(file));
if (!pkg) throw new Error('monaco-editor isn’t installed; run npm install');
// The editor's version, and this copy's own, for when what's written beside it changes.
const version = `${JSON.parse(readFileSync(pkg, 'utf8')).version}+1`;
const target = path.join(ui, 'vendor', 'vs');
const badge = path.join(target, '.version');

if (!existsSync(badge) || readFileSync(badge, 'utf8') !== version) {
  rmSync(target, { recursive: true, force: true });
  cpSync(path.join(path.dirname(pkg), 'min', 'vs'), target, { recursive: true });
  const assets = readdirSync(path.join(target, 'assets'));
  const worker = (name) => assets.find((file) => file.startsWith(`${name}.worker-`));
  const workers = {
    editor: worker('editor'),
    json: worker('json'),
    css: worker('css'),
    html: worker('html'),
    ts: worker('ts'),
  };
  writeFileSync(path.join(target, 'workers.json'), JSON.stringify(workers));
  const css = readFileSync(path.join(target, 'editor', 'editor.main.css'), 'utf8');
  const font = /font-family:codicon;[^}]*?url\(data:font\/ttf;base64,([A-Za-z0-9+/=]+)\)/.exec(css);
  if (!font) throw new Error('The editor’s icon font wasn’t found in its styles');
  writeFileSync(path.join(target, 'codicon.ttf'), Buffer.from(font[1], 'base64'));
  writeFileSync(badge, version);
  console.log(`Copied the VS Code editor ${version} to ui/vendor/vs`);
}
