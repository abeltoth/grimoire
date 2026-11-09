/** Every feature module's backend part: the one place the core imports a module from. */
import type { ServiceModule } from './module';
import { files } from '../../modules/files/service';
import { git } from '../../modules/git/service';
import { kanban } from '../../modules/kanban/service';
import { memories } from '../../modules/memories/service';
import { schedules } from '../../modules/schedules/service';
import { search } from '../../modules/search/service';
import { terminal } from '../../modules/terminal/service';
import { usage } from '../../modules/usage/service';
import { workflowSetup } from '../../modules/workflow-setup/service';

export const MODULES: readonly ServiceModule[] = [
  files,
  git,
  kanban,
  memories,
  schedules,
  search,
  terminal,
  usage,
  workflowSetup,
];
