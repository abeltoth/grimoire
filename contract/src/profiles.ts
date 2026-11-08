/**
 * A setup of your own, such as work or personal: its own Claude folder,
 * and its own settings, layout, presets, schedules and open chapters
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
