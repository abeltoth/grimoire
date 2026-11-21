import { describe, expect, it } from 'vitest';
import type { ModuleContext } from '@grimoire/service/core/module';
import { CommandRegistry } from '@grimoire/service/core/registry';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { browser } from '.';
import { MIGRATIONS } from './migrations';

describe('the browser module', () => {
  it('saves and lists the profile in use’s tabs, and forgets a removed profile’s', async () => {
    const db = openDatabase(':memory:');
    migrate(db, 'browser', MIGRATIONS);
    const registry = new CommandRegistry();
    const hooks = browser.start({ registry, db } as unknown as ModuleContext)!;
    const tabs = { tabs: [{ url: 'https://gemini.google.com/', title: 'Gemini' }], shown: 0 };
    await registry.dispatch('browser.save', tabs);
    expect(await registry.dispatch('browser.tabs', {})).toEqual(tabs);
    hooks.profileRemoved!('personal');
    expect(await registry.dispatch('browser.tabs', {})).toEqual({ tabs: [], shown: 0 });
  });
});
