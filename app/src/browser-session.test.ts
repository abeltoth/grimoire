import { describe, expect, it, vi } from 'vitest';
import { browserSession, partitionOf, plainUserAgent } from './browser-session';

const electron = vi.hoisted(() => {
  const made = new Map<
    string,
    { agent?: string; allow?: (permission: string) => boolean; setups: number }
  >();
  return { made };
});
vi.mock('electron', () => ({
  app: {
    userAgentFallback:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Grimoire/0.1.0 Chrome/156.0.8078.75 Electron/45.2.1 Safari/537.36',
  },
  session: {
    fromPartition: (partition: string) => {
      const pages = electron.made.get(partition) ?? { setups: 0 };
      electron.made.set(partition, pages);
      return {
        setUserAgent: (agent: string) => {
          pages.agent = agent;
          pages.setups++;
        },
        setPermissionRequestHandler: () => {},
        setPermissionCheckHandler: (check: (_: unknown, permission: string) => boolean) => {
          pages.allow = (permission) => check(null, permission);
        },
      };
    },
  },
}));

describe('the browser’s session', () => {
  it('keeps each profile’s pages apart', () => {
    expect(partitionOf('work')).toBe('persist:browser-work');
  });

  it('tells sites Chrome’s own user agent, without Grimoire or Electron', () => {
    expect(
      plainUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Grimoire/0.1.0 Chrome/156.0.8078.75 Electron/45.2.1 Safari/537.36',
      ),
    ).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.75 Safari/537.36',
    );
  });

  it('is set up once, allowing only the clipboard and full screen', () => {
    browserSession('personal');
    browserSession('personal');
    const pages = electron.made.get('persist:browser-personal')!;
    expect(pages.setups).toBe(1);
    expect(pages.agent).not.toMatch(/Grimoire|Electron/);
    expect(
      ['clipboard-sanitized-write', 'fullscreen', 'media', 'geolocation'].map(pages.allow!),
    ).toEqual([true, true, false, false]);
  });
});
