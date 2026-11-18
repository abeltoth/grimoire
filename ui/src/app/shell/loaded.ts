import {
  ApplicationRef,
  type EnvironmentProviders,
  PendingTasks,
  Pipe,
  type PipeTransform,
  type Signal,
  type Type,
  inject,
  provideAppInitializer,
  signal,
} from '@angular/core';
import { type LoadComponent, ShellRegistry } from './shell-registry';

const nothing = signal(undefined).asReadonly();
const loads = new WeakMap<LoadComponent, Signal<Type<unknown> | undefined>>();

/**
 * The component a loader imports, once it has: each loader imports once,
 * and the app counts as busy until it has, so a test's `whenStable` waits for it.
 */
export function loaded(
  load: LoadComponent | undefined,
  tasks: PendingTasks,
): Signal<Type<unknown> | undefined> {
  if (!load) return nothing;
  let component = loads.get(load);
  if (!component) {
    const imported = signal<Type<unknown> | undefined>(undefined);
    component = imported.asReadonly();
    loads.set(load, component);
    void tasks.run(async () => {
      try {
        imported.set(await load());
      } catch (error) {
        // Showing it again tries again.
        loads.delete(load);
        throw error;
      }
    });
  }
  return component;
}

/** `(entry.load | loaded)()` is the component it imports, undefined until it has. */
@Pipe({ name: 'loaded' })
export class LoadedPipe implements PipeTransform {
  private readonly tasks = inject(PendingTasks);

  transform(load: LoadComponent | undefined): Signal<Type<unknown> | undefined> {
    return loaded(load, this.tasks);
  }
}

/**
 * Imports every page once the app has settled and the window is idle, so
 * a page opens at once. Electron's Chromium has `requestIdleCallback`; a
 * spec's DOM doesn't, so specs import a page only when it's shown.
 */
export function providePreloadedPages(): EnvironmentProviders {
  return provideAppInitializer(() => {
    if (typeof requestIdleCallback !== 'function') return;
    const shell = inject(ShellRegistry);
    const tasks = inject(PendingTasks);
    void inject(ApplicationRef)
      .whenStable()
      .then(() =>
        requestIdleCallback(() => {
          const pages = [
            ...shell.pageTabs.all(),
            ...shell.rightPages.all(),
            ...shell.settingsSections.all(),
          ];
          for (const page of pages) loaded(page.load, tasks);
          loaded(shell.approvalsPage(), tasks);
        }),
      );
  });
}
