---
name: new-module
description: Scaffold a new feature module under modules/<name> with its contract, service part, UI providers, a test and the three registrations. Use when adding a feature that a user could turn off.
argument-hint: "[name]"
---

# New module

Make `modules/$ARGUMENTS/` (kebab-case; the folder name is the module's `id`). Copy the shape of a
small module such as `modules/memories` or `modules/git`. Leave out a part the feature doesn't
need; a module with no UI has no `ui/`.

1. `contract.ts`: the module's JSON-safe types, then its commands and events:

   ```ts
   declare module '@grimoire/contract' {
     interface CommandMap {
       '<name>.list': { request: { cwd: string }; response: Thing[] };
     }
   }
   declare module '@grimoire/contract' {
     interface EventMap {
       '<name>.changed': { cwd: string };
     }
   }
   ```

2. `service/index.ts`: one `ServiceModule`, imported from `@grimoire/service/module`:
   `id`, `migrations` if it keeps tables (see the `add-migration` skill), and `start(context)`
   that calls `context.registry.register(...)` for each command and returns `{ stop }` if it runs
   anything. Put the logic in its own file beside it, with a `*.test.ts` next to that.
3. `ui/<name>.providers.ts`: `export function provide<Name>(): EnvironmentProviders`, returning
   `provideShellEntries((shell) => { shell.pageTabs.add({ id, label, plainLabel, order, component }) })`
   or whichever `ShellRegistry` slot fits. Components call the service with
   `inject(GRIMOIRE_BRIDGE).invoke('<name>.list', ...)`. Add one `*.spec.ts` per component,
   rendered with `fakeBridge()` and `render()` from `@ui/testing/app-harness`.
4. Register each part (the first two lists are alphabetical):
   - `contract/src/index.ts`: `export * from '../../modules/<name>/contract';`
   - `service/src/modules.ts`: import the `ServiceModule` and add it to `MODULES`.
   - `ui/src/app/app.config.ts`: import `provide<Name>` and add it to the providers.
5. The tsconfigs, `vitest.config.ts` and `angular.json` already pick up `modules/*`; nothing else
   to change. Run `npm run check`.
