import { DEFAULT_SETTINGS, type GrimoireSettings } from '@grimoire/contract';
import { describe, expect, it } from 'vitest';
import { ClaudeRestarts } from './restarts';

/** Restarts over a store holding `settings`, noting each step they take. */
function restarting(settings: GrimoireSettings = DEFAULT_SETTINGS) {
  const steps: string[] = [];
  const store = { settings };
  const restarts = new ClaudeRestarts(
    { dispose: () => steps.push('dispose'), warm: () => steps.push('warm') },
    { mcpChanged: () => steps.push('mcpChanged') },
    () => store.settings,
  );
  return { restarts, steps, store };
}

describe('ClaudeRestarts', () => {
  it('starts the spare again when suggestions or separate tasks are turned on or off', () => {
    const { restarts, steps } = restarting();
    restarts.settingsChanged({ ...DEFAULT_SETTINGS, suggestions: !DEFAULT_SETTINGS.suggestions });
    expect(steps).toEqual(['dispose', 'warm']);
    restarts.settingsChanged({
      ...DEFAULT_SETTINGS,
      suggestions: !DEFAULT_SETTINGS.suggestions,
      followUps: !DEFAULT_SETTINGS.followUps,
    });
    expect(steps).toEqual(['dispose', 'warm', 'dispose', 'warm']);
  });

  it('has open chats and the spare start again when other MCP servers are off everywhere', () => {
    const { restarts, steps } = restarting({ ...DEFAULT_SETTINGS, mcpOff: ['a', 'b'] });
    restarts.settingsChanged({ ...DEFAULT_SETTINGS, mcpOff: ['b', 'a'] });
    expect(steps).toEqual([]);
    restarts.settingsChanged({ ...DEFAULT_SETTINGS, mcpOff: ['a'] });
    expect(steps).toEqual(['mcpChanged', 'dispose', 'warm']);
  });

  it('restarts twice when both change at once, and not at all for other settings', () => {
    const { restarts, steps } = restarting();
    restarts.settingsChanged({ ...DEFAULT_SETTINGS, wording: 'plain' });
    expect(steps).toEqual([]);
    restarts.settingsChanged({
      ...DEFAULT_SETTINGS,
      followUps: !DEFAULT_SETTINGS.followUps,
      mcpOff: ['a'],
    });
    expect(steps).toEqual(['dispose', 'warm', 'mcpChanged', 'dispose', 'warm']);
  });

  it("starts the spare in a new profile, whose settings then don't restart it", () => {
    const { restarts, steps, store } = restarting();
    store.settings = {
      ...DEFAULT_SETTINGS,
      suggestions: !DEFAULT_SETTINGS.suggestions,
      mcpOff: ['a'],
    };
    restarts.profileSwitched();
    expect(steps).toEqual(['warm']);
    restarts.settingsChanged(store.settings);
    expect(steps).toEqual(['warm']);
  });
});
