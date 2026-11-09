/** Every feature module's backend part: the one place the core imports a module from. */
import type { ServiceModule } from './module';
import { files } from '../../modules/files/service';
import { git } from '../../modules/git/service';
import { kanban } from '../../modules/kanban/service';
import { schedules } from '../../modules/schedules/service';
import { search } from '../../modules/search/service';
import { terminal } from '../../modules/terminal/service';

export const MODULES: readonly ServiceModule[] = [files, git, kanban, schedules, search, terminal];
