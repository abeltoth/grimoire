import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { extraProviders } from '@grimoire/extra-modules/ui';
import { provideAutoLabels } from '../../../modules/auto-labels/ui/auto-labels.providers';
import { provideChat } from '../../../modules/chat/ui/chat.providers';
import { provideSettings } from '../../../modules/settings/ui/settings.providers';
import { provideFiles } from '../../../modules/files/ui/files.providers';
import { provideWorkflowSetup } from '../../../modules/workflow-setup/ui/workflow-setup.providers';
import { provideGit } from '../../../modules/git/ui/git.providers';
import { provideHistory } from '../../../modules/history/ui/history.providers';
import { provideKanban } from '../../../modules/kanban/ui/kanban.providers';
import { provideNotes } from '../../../modules/notes/ui/notes.providers';
import { provideUsage } from '../../../modules/usage/ui/usage.providers';
import { provideMemories } from '../../../modules/memories/ui/memories.providers';
import { provideScheduledChats } from '../../../modules/schedules/ui/schedules.providers';
import { provideTerminal } from '../../../modules/terminal/ui/terminal.providers';
import { provideShell } from './shell/shell-registry';

// Zoneless change detection is Angular's default.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideShell(),
    provideChat(),
    provideFiles(),
    provideGit(),
    provideHistory(),
    provideWorkflowSetup(),
    provideKanban(),
    provideNotes(),
    provideMemories(),
    provideUsage(),
    provideScheduledChats(),
    provideTerminal(),
    provideSettings(),
    provideAutoLabels(),
    // Modules kept outside this repo, such as the pro ones.
    ...extraProviders,
  ],
};
