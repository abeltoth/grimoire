import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';

// Zoneless change detection is Angular's default.
export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners()],
};
