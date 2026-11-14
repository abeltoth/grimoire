import { InjectionToken } from '@angular/core';

/**
 * Token sheets that modules kept outside this repo add, each read as text, so the theme editor
 * lists their tokens beside the theme's; the core theme can't hold tokens for code it doesn't have.
 */
export const THEME_SHEETS = new InjectionToken<readonly (() => Promise<string>)[]>('ThemeSheets', {
  factory: () => [],
});
