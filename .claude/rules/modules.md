---
paths:
  - "modules/**"
---

# Modules

A feature is one folder, `modules/<name>/`, with up to three parts:

- `contract.ts`: the module's types, and its commands and events added to the core's maps with
  `declare module '@grimoire/contract' { interface CommandMap { ... } }` (and `EventMap`).
- `service/index.ts`: one exported `ServiceModule` (`service/src/module.ts`): `id` is the folder
  name, `migrations` its tables' SQL, and `start(context)` registers its commands and may return
  `ModuleHooks` (`ready`, `profileSwitched`, `profileRemoved`, `stop`).
- `ui/<name>.providers.ts`: `provideX()` calling `provideShellEntries((shell) => ...)`, which adds
  pages, commands and indicators to the `ShellRegistry` slots (`ui/src/app/shell/shell-registry.ts`).

Each part is registered in exactly one list: `contract/src/index.ts`, `service/src/modules.ts`,
`ui/src/app/app.config.ts`. Removing the folder and those lines removes the feature.

- Names are owner-prefixed: commands `<module>.<verb>` (`schedules.list`), events
  `<module>.<what happened>` (`schedules.changed`).
- Migrations are append-only: add a new SQL string at the end; never edit, reorder or remove one.
  Each module's version is kept under its `id`.
- A module imports no other module. It reaches one through `registry.call(...)` and
  `events.on(...)`, and its UI reaches the service through the bridge.
- From the service it imports only the surface `eslint.config.js` lists; the lint warns on the rest.
- Log through `context.log`, not `console`; only a CLI script such as `jira-check.ts` prints.
