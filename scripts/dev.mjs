// npm run dev: serves the UI with live reload, rebuilds the service and the
// Electron scripts on change, and restarts Electron after each rebuild. A
// restarted app replaces the service if its build changed.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import electronPath from 'electron';
import * as esbuild from 'esbuild';
import { builds } from './build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4200;
const DEV_URL = `http://localhost:${PORT}`;

// The VS Code editor's files, which the UI serves as /vs.
await import(pathToFileURL(path.join(root, 'ui/tools/copy-monaco.mjs')).href);

// Resolved, not joined to root, since the private repo installs packages a folder above.
const ngPath = createRequire(import.meta.url).resolve('@angular/cli/bin/ng.js');
const ng = spawn(process.execPath, [ngPath, 'serve', '--port', String(PORT)], {
  cwd: path.join(root, 'ui'),
  stdio: 'inherit',
});

let electron;
let restarting = false;
let restartTimer;

function startElectron() {
  const env = { ...process.env, GRIMOIRE_DEV_URL: DEV_URL };
  delete env.ELECTRON_RUN_AS_NODE;
  electron = spawn(electronPath, [path.join(root, 'app')], { stdio: 'inherit', env });
  electron.on('exit', () => {
    if (restarting) {
      restarting = false;
      startElectron();
    } else {
      void shutdown();
    }
  });
}

function scheduleRestart() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (!electron) return;
    console.log('[dev] Rebuilt, restarting Electron');
    restarting = true;
    electron.kill();
  }, 300);
}

const restartOnRebuild = {
  name: 'restart-electron',
  setup(build) {
    let first = true;
    build.onEnd((result) => {
      if (first) {
        first = false;
        return;
      }
      if (result.errors.length === 0) scheduleRestart();
    });
  },
};

const contexts = await Promise.all(
  builds.map((options) => esbuild.context({ ...options, plugins: [restartOnRebuild] })),
);
await Promise.all(contexts.map((context) => context.rebuild()));
await Promise.all(contexts.map((context) => context.watch()));

async function waitForDevServer() {
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(DEV_URL)).ok) return;
    } catch {
      // Not up yet.
    }
    await delay(200);
  }
  throw new Error(`The UI dev server didn't start on ${DEV_URL}`);
}

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearTimeout(restartTimer);
  electron?.kill();
  ng.kill();
  await Promise.all(contexts.map((context) => context.dispose()));
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
ng.on('exit', () => void shutdown());

await waitForDevServer();
startElectron();
