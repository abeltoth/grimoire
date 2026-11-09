import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentSetup } from '@grimoire/contract';
import { afterEach, describe, expect, it } from 'vitest';
import { Setup, type SetupReader, setupFolders } from './setup';

let setup: Setup | undefined;
afterEach(() => setup?.dispose());

describe('Setup', () => {
  it('asks the agent what it loads in a folder, your home folder when none is given', async () => {
    const asked: string[] = [];
    const reader: SetupReader = {
      read: async (cwd) => {
        asked.push(cwd);
        return { cwd, sections: {} as AgentSetup['sections'], settingsFiles: [], at: 1 };
      },
    };
    setup = new Setup(new Map([['fake', reader]]), () => {});
    expect(await setup.get('fake', 'C:/work')).toMatchObject({ cwd: 'C:/work' });
    await setup.get('fake');
    expect(asked).toEqual(['C:/work', homedir()]);
  });

  it("has no setup to show for an agent that can't say", async () => {
    setup = new Setup(new Map(), () => {});
    expect(await setup.get('plain', 'C:/work')).toBeNull();
  });
});

describe('setupFolders', () => {
  it('lists the folders a setup can be read in: those still there, outside the temp folder', () => {
    const temp = mkdtempSync(path.join(tmpdir(), 'grimoire-temp-'));
    const work = mkdtempSync(path.join(tmpdir(), 'grimoire-work-'));
    const run = path.join(temp, 'test-run');
    try {
      mkdirSync(run);
      expect(setupFolders([run, homedir(), temp, path.join(work, 'gone'), work], temp)).toEqual([
        homedir(),
        work,
      ]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
      rmSync(work, { recursive: true, force: true });
    }
  });
});
