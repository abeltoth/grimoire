import { effect, inject } from '@angular/core';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Profiles } from '@ui/app/core/profiles';

/** Deletes a deleted profile's logins and everything else its web pages kept; call it in an injection context. */
export function forgetRemovedProfiles(): void {
  const bridge = inject(GRIMOIRE_BRIDGE);
  const profiles = inject(Profiles);
  let known = new Set<string>();
  effect(() => {
    const ids = new Set(profiles.list().profiles.map(({ id }) => id));
    if (!ids.size) return;
    for (const id of known) if (!ids.has(id)) bridge.browser.forget(id);
    known = ids;
  });
}
