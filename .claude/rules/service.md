---
paths:
  - "service/**"
  - "modules/*/service/**"
---

# Service

- Commands: `registry.register(name, handler)`, typed by `CommandMap`; one module asks another
  with `registry.call(name, request)`. Events: `events.emit(name, payload)` reaches every window
  and every `events.on(name, ...)` in the service.
- Storage is `node:sqlite` (`DatabaseSync`). Tables change only through migrations run by
  `migrate(db, owner, migrations)` (`service/src/storage/database.ts`), one version per owner.
- Process model (ADR-010): the service is a detached Node process that the app starts and talks
  to over a local socket; it outlives windows. Heavy work (search, token totals) runs in the
  search module's forked worker, so a handler never blocks the event loop for long.
- The core is agent-neutral (ADR-006): `service/src/agents` speaks `AgentAdapter`, and anything
  about Claude stays in `service/src/agents/claude`.
- Tests are `*.test.ts` next to the code, on the Node runner. A database is
  `openDatabase(':memory:')` plus `migrate(...)`; an agent is `FakeAdapter`.
- Tests never read the real clock: a class takes `now: () => number` as its last argument, or the
  test uses `vi.useFakeTimers()` and `vi.setSystemTime(...)`.
