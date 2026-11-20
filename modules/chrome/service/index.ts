import { saveChromeOn } from '@grimoire/service/claude/chrome';
import type { ServiceModule } from '@grimoire/service/core/module';
import { readChrome } from './chrome-state';

/**
 * Claude in Chrome for Claude Code's chats: its state, and the switch
 * that turns it on, kept where Claude Code's /chrome keeps it.
 */
export const chrome: ServiceModule = {
  id: 'chrome',
  start({ registry, events, log }) {
    const read = () =>
      readChrome().catch((error: unknown) => {
        log(`Claude in Chrome's state couldn't be read: ${String(error)}`);
        return null;
      });
    registry.register('chrome.get', read);
    registry.register('chrome.set', async ({ on }) => {
      await saveChromeOn(on);
      events.emit('chrome.changed', { on });
      return read();
    });
  },
};
