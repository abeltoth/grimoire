import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCapture, runSmokeTest } from './smoke';

const exit = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ app: { exit } }));
// The UI answers at once here, so nothing needs to wait.
vi.mock('node:timers/promises', () => ({ setTimeout: async () => {} }));

/** A window whose page shows the service as `state`, with `text` beside it. */
function windowShowing(state: string, text = ''): BrowserWindow {
  const answer = (expression: string) => {
    if (expression.includes("getAttribute('data-service-state')")) return state;
    if (expression.includes('textContent')) return text;
    if (expression.includes('document.fonts].filter')) return 'Garamond 400 normal';
    return '';
  };
  return {
    webContents: {
      executeJavaScript: async (expression: string) => answer(expression),
      capturePage: async () => ({
        toPNG: () => Buffer.from('png'),
        getSize: () => ({ width: 1920, height: 1080 }),
      }),
    },
  } as unknown as BrowserWindow;
}

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  exit.mockClear();
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  log.mockRestore();
});

describe('runSmokeTest', () => {
  it('passes once the UI has the service’s answer, and stops the service', async () => {
    const stop = vi.fn(async () => {});
    await runSmokeTest(windowShowing('connected', 'Service 1.0'), stop);
    expect(log).toHaveBeenCalledWith('Smoke test passed: connected. Service 1.0');
    expect(stop).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('fails when the service failed, even if stopping it fails too', async () => {
    await runSmokeTest(windowShowing('failed'), async () => {
      throw new Error('gone');
    });
    expect(log).toHaveBeenCalledWith('Smoke test failed: failed. ');
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('runCapture', () => {
  it('asks for a file to save to when given none', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runCapture(windowShowing('connected'), undefined, async () => {});
    expect(error).toHaveBeenCalledWith('Usage: electron app --capture <file.png>');
    expect(exit).toHaveBeenCalledWith(2);
    error.mockRestore();
  });

  it('saves the page as it shows, with the fonts it used', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'grimoire-capture-'));
    try {
      const file = path.join(dir, 'shot.png');
      await runCapture(windowShowing('connected'), file, async () => {});
      expect(readFileSync(file, 'utf8')).toBe('png');
      expect(log).toHaveBeenCalledWith(
        `Captured 1920×1080 to ${file} (service connected). Fonts loaded: Garamond 400 normal`,
      );
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
