/**
 * A setup of your own, such as work or personal: its own Claude folder,
 * and its own settings, layout, presets, schedules and open chats
 * (ADR-009: Grimoire's own data).
 */
export interface Profile {
  id: string;
  name: string;
  /** The Claude folder Claude Code uses in it; null for Claude Code's usual place. */
  claudeFolder: string | null;
}

/** Your profiles, in the order they were made, and the one in use. */
export interface Profiles {
  active: string;
  profiles: Profile[];
}

/**
 * The profile there always is, made from what Grimoire kept before
 * profiles; it uses Claude Code's usual place.
 */
export const PERSONAL_PROFILE = 'personal';

declare module './commands' {
  interface CommandMap {
    /** Your profiles, and the one in use. */
    'profiles.list': { request: Record<string, never>; response: Profiles };
    /** Makes a profile, with a Claude folder of its own, after the others. Returns them all. */
    'profiles.create': { request: { name: string }; response: Profiles };
    /** Gives a profile another name, which no other profile has. Returns them all. */
    'profiles.rename': { request: { id: string; name: string }; response: Profiles };
    /**
     * Deletes a profile and what Grimoire kept for it; its Claude folder
     * stays on disk. Personal and the profile in use can't be deleted.
     * Returns the profiles left.
     */
    'profiles.remove': { request: { id: string }; response: Profiles };
    /**
     * Puts the open chats away and makes the profile the one in use:
     * Claude Code moves to its Claude folder, and the main window opens with its
     * settings, layout, presets, schedules and chats. Refused while a
     * chat is busy, an approval waits, or a sign-in is under way.
     */
    'profiles.switch': { request: { id: string }; response: Profiles };
  }
}

declare module './events' {
  interface EventMap {
    /** A profile was made, renamed or deleted, or another one is in use. */
    'profiles.changed': { profiles: Profiles };
  }
}
