import { InjectionToken } from '@angular/core';
import type { GrimoireBridge } from '@grimoire/contract';

declare global {
  interface Window {
    grimoire?: GrimoireBridge;
  }
}

/**
 * The bridge the preload script exposes. Inject this instead of touching
 * `window.grimoire`, so tests can pass a fake.
 */
export const GRIMOIRE_BRIDGE = new InjectionToken<GrimoireBridge>('GrimoireBridge', {
  providedIn: 'root',
  factory: () => window.grimoire ?? outsideTheApp(),
});

/** In a plain browser there's no backend: every command fails. */
function outsideTheApp(): GrimoireBridge {
  return {
    platform: /Mac/.test(navigator.userAgent) ? 'mac' : 'windows',
    invoke: () => Promise.reject(new Error('Not running inside the Grimoire app')),
    on: () => () => {},
    chooseFolder: () => Promise.resolve(null),
    window: { minimize() {}, toggleMaximize() {}, close() {} },
  };
}
