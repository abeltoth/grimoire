import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideChat } from '../../../modules/chat/ui/chat.providers';
import { provideGit } from '../../../modules/git/ui/git.providers';
import { provideTableOfContents } from '../../../modules/history/ui/history.providers';
import { provideLedger } from '../../../modules/ledger/ui/ledger.providers';
import { provideScheduledChats } from '../../../modules/schedules/ui/schedules.providers';
import { provideScriptorium } from '../../../modules/terminal/ui/terminal.providers';
import { providePlaceholders } from './placeholders/placeholders';
import { provideShell } from './shell/shell-registry';

// Zoneless change detection is Angular's default.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideShell(),
    provideChat(),
    provideGit(),
    provideTableOfContents(),
    provideLedger(),
    provideScheduledChats(),
    provideScriptorium(),
    providePlaceholders(),
  ],
};
