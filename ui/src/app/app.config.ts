import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { providePlaceholders } from './placeholders/placeholders';
import { provideShell } from './shell/shell-registry';

// Zoneless change detection is Angular's default.
export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners(), provideShell(), providePlaceholders()],
};
