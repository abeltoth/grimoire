---
name: add-command
description: Add a command between the UI and the service, from the contract through the handler and the UI call to the tests. Use when a window needs to ask the service for something new.
argument-hint: "[owner.verb]"
---

# Add a command

Add `$ARGUMENTS`: owner-prefixed, a verb (`schedules.save`). The owner is a module's folder name,
or a core area (`agents`, `chat`, `settings`, `profiles`, `presets`, `layout`).

1. Contract: add it to `CommandMap` with its JSON-safe `request` and `response` types. In a
   module, inside the `declare module '@grimoire/contract'` block of `modules/<name>/contract.ts`;
   in the core, in `contract/src`. If windows must hear of a change, add an event to `EventMap`
   too (`<owner>.<what happened>`).
2. Handler: `registry.register('<owner>.<verb>', (request) => ...)` in the module's `start()`
   (`modules/<name>/service/index.ts`) or the core's registration. The handler calls into a
   class or function with the logic; it doesn't hold it. Emit events with `events.emit(...)`.
3. Test the logic in a `*.test.ts` next to it, and the handler through a `CommandRegistry`:
   `await registry.dispatch('<owner>.<verb>', request)`. Use a fixed clock and
   `openDatabase(':memory:')`.
4. UI: call it with `inject(GRIMOIRE_BRIDGE).invoke('<owner>.<verb>', request)`, and listen with
   `bridge.on(event, ...)`, unsubscribing on destroy.
5. Spec: in the component's `*.spec.ts`, answer it with `answers['<owner>.<verb>'] = () => ...`
   from `fakeBridge()`, and assert on `calls` for what the UI sent.
6. Run `npm run check`.
