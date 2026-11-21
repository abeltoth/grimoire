import { type Session, app, session } from 'electron';

/** What web pages may do beyond the usual: copy to the clipboard, and play a video full screen. */
const ALLOWED = new Set(['clipboard-sanitized-write', 'fullscreen']);

const prepared = new Set<string>();

/** Where a profile's web pages keep their logins, apart from Grimoire's own pages. */
export function partitionOf(profile: string): string {
  return `persist:browser-${profile}`;
}

/** Chrome's own user agent: the app's, without the "Grimoire/…" and "Electron/…" it adds. */
export function plainUserAgent(agent: string): string {
  return agent.replace(/ (Grimoire|Electron)\/\S+/g, '');
}

/** The profile's session for web pages, set up the first time it's asked for. */
export function browserSession(profile: string): Session {
  const partition = partitionOf(profile);
  const pages = session.fromPartition(partition);
  if (!prepared.has(partition)) {
    prepared.add(partition);
    pages.setUserAgent(plainUserAgent(app.userAgentFallback));
    pages.setPermissionRequestHandler((_, permission, grant) => grant(ALLOWED.has(permission)));
    pages.setPermissionCheckHandler((_, permission) => ALLOWED.has(permission));
  }
  return pages;
}

/** Deletes everything a profile's web pages kept: logins, cookies, storage and cache. */
export async function forgetProfile(profile: string): Promise<void> {
  const pages = session.fromPartition(partitionOf(profile));
  await Promise.all([pages.clearStorageData(), pages.clearCache()]);
}
