import { app, type BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

function reader(win: BrowserWindow) {
  return (expression: string): Promise<string> => win.webContents.executeJavaScript(expression).then(String, () => '');
}

/** Waits until the UI has the service's answer; returns 'connected', 'failed' or ''. */
async function waitForService(win: BrowserWindow): Promise<string> {
  const read = reader(win);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const state = await read(`document.querySelector('[data-service-state]')?.getAttribute('data-service-state') ?? ''`);
    if (state === 'connected' || state === 'failed') return state;
    await delay(200);
  }
  return '';
}

/**
 * `electron app --smoke`: waits until the UI shows the service's ping
 * result, prints it, stops the smoke service and exits 0 on success.
 * This covers the whole path: Angular, preload, IPC, app, socket, service.
 */
export async function runSmokeTest(win: BrowserWindow, stopService: () => Promise<void>): Promise<void> {
  const state = await waitForService(win);
  const text = await reader(win)(`document.querySelector('[data-service-state]')?.textContent?.trim() ?? ''`);
  const passed = state === 'connected';
  console.log(`Smoke test ${passed ? 'passed' : 'failed'}: ${state || 'timed out'}. ${text}`);

  await Promise.race([stopService().catch(() => {}), delay(5000)]);
  app.exit(passed ? 0 : 1);
}

/**
 * `electron app --capture <file.png>`: renders the UI at 1920×1080 once
 * the service has answered and the fonts have loaded, saves a screenshot,
 * prints the font faces in use, and exits.
 */
export async function runCapture(
  win: BrowserWindow,
  file: string | undefined,
  stopService: () => Promise<void>,
): Promise<void> {
  if (!file) {
    console.error('Usage: electron app --capture <file.png>');
    app.exit(2);
    return;
  }
  const state = await waitForService(win);
  const read = reader(win);
  await read('document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))');
  const fonts = await read(
    `[...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family + ' ' + f.weight + ' ' + f.style).join(', ')`,
  );
  const image = await win.webContents.capturePage();
  const out = path.resolve(file);
  writeFileSync(out, image.toPNG());
  const { width, height } = image.getSize();
  console.log(`Captured ${width}×${height} to ${out} (service ${state || 'timed out'}). Fonts loaded: ${fonts || 'none'}`);

  await Promise.race([stopService().catch(() => {}), delay(5000)]);
  app.exit(0);
}
