import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideChat } from '../../../modules/chat/ui/chat.providers';
import { provideLedger } from '../../../modules/ledger/ui/ledger.providers';
import { providePlaceholders } from './placeholders/placeholders';
import { provideShell } from './shell/shell-registry';

// Zoneless change detection is Angular's default.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideShell(),
    provideChat(),
    provideLedger(),
    providePlaceholders(),
  ],
};
