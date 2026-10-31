import { app, type BrowserWindow } from 'electron';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * `electron app --smoke`: waits until the UI shows the service's ping
 * result, prints it, stops the smoke service and exits 0 on success.
 * This covers the whole path: Angular, preload, IPC, app, socket, service.
 */
export async function runSmokeTest(win: BrowserWindow, stopService: () => Promise<void>): Promise<void> {
  const read = (expression: string): Promise<string> =>
    win.webContents.executeJavaScript(expression).then(String, () => '');

  const deadline = Date.now() + 30_000;
  let state = '';
  while (Date.now() < deadline) {
    state = await read(`document.querySelector('[data-service-state]')?.getAttribute('data-service-state') ?? ''`);
    if (state === 'connected' || state === 'failed') break;
    await delay(200);
  }
  const text = await read(`document.querySelector('[data-service-state]')?.textContent?.trim() ?? ''`);
  const passed = state === 'connected';
  console.log(`Smoke test ${passed ? 'passed' : 'failed'}: ${state || 'timed out'}. ${text}`);

  await Promise.race([stopService().catch(() => {}), delay(5000)]);
  app.exit(passed ? 0 : 1);
}
