# Refactor plan

Written 2026-11-10 after a review of the whole repository, for the agent that carries it out.
Direction confirmed with the owner: ADR-006 stays (other agents through ACP behind an agent-neutral
core), and the dual wording (book words and plain words through `Wording`) stays.

## Where the code stands

- Typecheck, 363 Node tests and 239 UI tests pass. The UI already passes `tsc --strict` with zero
  errors, though `strict` isn't turned on for it.
- The architecture is sound and recently reworked: a feature is one folder under `modules/`,
  registered in exactly three lists (`service/src/modules.ts`, `ui/src/app/app.config.ts`,
  `contract/src/index.ts`); modules never import each other; the shell is filled through
  `ShellRegistry` slots. Keep all of it.
- What's missing is enforcement. CLAUDE.md promises a "boundary lint" that doesn't exist; there is
  no ESLint, no CI and no `.claude/` folder; Prettier is configured but 306 files don't match it;
  `npm run typecheck` skips the UI.
- Rules are stated but drift: 10 TypeScript sources and 2 templates are over 400 lines, about 10
  spec files read the real clock, module UI specs are one mega-spec per module,
  `service/src/main.ts` holds logic, and the core's Claude adapter knows about the Kanban module.

Items are in order of value. Each numbered item is one commit with `npm run check` green.

## 1. Make the rules mechanical

1.1 **One check command.** Add `npm run check` = `typecheck` + `format:check` + `lint` + `test`
    (the style guard already runs in `test`). Extend `typecheck` with
    `tsc -p ui/tsconfig.app.json && tsc -p ui/tsconfig.spec.json`; today the UI and the modules'
    UI parts are type-checked only by `ng build` and `ng test`.

1.2 **UI strict.** `ui/tsconfig.json` extends `../tsconfig.base.json` (`strict: true`) and keeps
    only the Angular-specific options. Passes today with zero errors; free, and stops regressions.

1.3 **Prettier once, then always.** Move `prettier` to the root `devDependencies`, add `format` and
    `format:check`, run `format` once over `contract service app ui/src modules scripts` in a
    commit of its own. Nobody keeps formatting by hand; without this `.prettierrc` is noise.

1.4 **ESLint as the boundary lint.** Flat config at the root: `typescript-eslint` (type-checked,
    `projectService: true`), `angular-eslint` for `ui/**` and `modules/*/ui/**`, and
    `eslint-plugin-boundaries` with four element types: `contract` (`contract/src`),
    `service-core` (`service/src`), `ui-core` (`ui/src`), `module` (`modules/*`, one element per
    folder). Rules:
    - a `module` imports no other `module`;
    - `service-core` and `ui-core` import a `module` only from `service/src/modules.ts` and
      `ui/src/app/app.config.ts`; `contract` only from `contract/src/index.ts`;
    - a `module` imports `service-core` only through the surface in 2.2;
    - `max-lines: 400` (blank lines and comments skipped) for sources, not tests; exempt the
      token sheet `ui/src/design-system/themes/grimoire.css` by name;
    - `@typescript-eslint/no-floating-promises` (the code already uses `void` deliberately);
    - in `*.spec.ts` and `*.test.ts`, `no-restricted-syntax` on `Date.now()` and `new Date()`
      without arguments: the "tests never read the real clock" rule, enforced.
    Replace "the boundary lint" in CLAUDE.md with `npm run check`.

1.5 **Hooks that gate commits.** Commit `.claude/settings.json` with a `PreToolUse` hook on `Bash`
    matched to `git commit` that runs `npm run check` and exits 2 on failure (Claude Code refuses
    the commit and reads stderr), and a `PostToolUse` hook on `Edit|Write` running
    `prettier --write` on the file. Hooks are Node scripts under `.claude/hooks/`, not shell: the
    app is for Mac and Windows (ADR-001).

1.6 **CI.** The repo is on GitHub: one workflow running `npm ci && npm run check` on push, matrix
    `macos-latest` and `windows-latest`. Catches what a skipped hook misses; keeps ADR-001 honest.

1.7 **Style budget trap.** `angular.json` fails the build at 8 kB per component stylesheet and
    `modules/kanban/ui/kanban-page.css` is at 7.1 kB. Raise the budget to what the design needs or
    split the sheet, and write the limit into the UI rule (5.2).

## 2. Boundaries between core, Claude and modules (ADR-006 kept)

2.1 **Kanban inside the core.** `service/src/agents/claude/todos.ts` and
    `ClaudeAdapter.addTodosWith()` make the core's Claude adapter know the Kanban board's
    `add_todo` tool. Make the Grimoire tool server (`grimoire-tools.ts`) generic: the core offers
    `registerTool(tool)` on the `ModuleContext`, and the kanban module registers `add_todo` in its
    `start()`. `follow-ups.ts` is chat lifecycle and stays in core. Kanban is the only module
    using `ModuleContext.claude`; after this it can go.

2.2 **A declared public surface for modules.** Modules import eleven deep paths of the service
    (`agents/claude/{connectors,probe,config-dir,settings-files,claude-adapter}`, `agents/adapter`,
    `agents/files`, `agents/folder-watcher`, `storage/app-state`, `registry`, `module`), and
    `service/package.json` exports `"./*"`, so nothing stops a twelfth. Replace it with an
    explicit exports map in two groups:
    - `@grimoire/service/core/*`, agent-neutral: `module`, `registry`, `events`, `adapter`,
      `files`, `folder-watcher`, `app-state`;
    - `@grimoire/service/claude/*`, the Claude agent's helpers a Claude-only feature may use
      (ADR-006 allows those): `connectors`, `probe`, `config-dir`, `settings-files`, and the
      adapter itself for the search worker, which builds its own in its process.
    Move the files to match (`agents/files.ts` and `agents/folder-watcher.ts` aren't about agents;
    `storage/app-state.ts` is core). TypeScript then refuses any other import; the lint in 1.4
    says the same with a better message. Record the surface in a new ADR (ADRs aren't edited).

2.3 **Composition roots with no logic.** `service/src/main.ts` restarts the spare Claude process
    when settings change and wires profile switching inline. Move that into a tested class, e.g.
    `service/src/agents/claude/restarts.ts`, so `main.ts` only constructs and connects.
    `app/src/main.ts` (318 lines) mixes IPC handlers, windows, popouts and the service client:
    split into `ipc.ts`, `windows.ts`, `popouts.ts`, and add it to the rule's list of roots.

## 3. Files over 400 lines

`chats.ts` and `claude-adapter.ts` are touched by nearly every feature; they go first.

| File | Lines | Split |
|---|---|---|
| `ui/src/app/core/chats.ts` | 824 | `ChatList` (all/current/beside, open/close/restore, popouts), `ChatActions` (send, parallel, interrupt, undo, fork, rename, decide, answer), `NewChats` (settings card, `startOf`, last used, blank chats), `AgentCatalog` (agents, models, folders, names). 34 module files and 8 shell files inject `Chats`: keep it as a thin facade for one step, migrate the call sites, then delete it. |
| `service/src/agents/claude/claude-adapter.ts` | 794 | `spare.ts` (warm/takeSpare/claim/dispose), `drive.ts` (`drive()`, the bulk of the file: SDK message → `ChatEvents`), `saved-chats.ts` (listChats, history, subagent, fork, rename, title). |
| `service/src/agents/claude/transcript.ts` | 673 | `ClaudeTranscript` stays; subagent helpers to `subagent-runs.ts`; `wholeRun`, `isYourEntry`, `turnEnd` to `entries.ts`. |
| `modules/usage/ui/usage-page.ts` + `.html` | 605 + 464 | `limitsChart()` and the formatters to `limits-chart.ts` and `usage-format.ts`; the template splits into a limits view and a tokens view. |
| `contract/src/agents.ts` | 557 | `chat-settings.ts`, `entries.ts`, `approvals.ts`, `agent-commands.ts` (the `CommandMap`/`EventMap` augmentation). |
| `modules/settings/ui/settings-page.html` | 540 | One component per section; the page composes them. |
| `modules/chat/ui/rows.ts` | 507 | `toRows` stays; `summarize` (165 lines) to `summary.ts`; the types to `row.ts`. |
| `modules/kanban/service/jira.ts` | 473 | Field mapping to `jira-fields.ts`. |
| `modules/chat/ui/composer.ts` | 450 | Recall of sent messages to `recall.ts`; pasted and dropped files to the existing `attachments.ts`. |
| `service/src/agents/hub.ts` | 419 | Already in parts; `busy`/`putAway`/`closeAll` to `hub-lifecycle.ts`, or accept at ~400. |
| `modules/memories/ui/memories-page.ts` | 414 | Per-source list and editor as child components. |

## 4. Tests

4.1 **Spec per component.** `modules/settings/ui/settings.spec.ts` (864), `kanban.spec.ts` (675),
    `files.spec.ts` (520), `usage.spec.ts` (424), `memories.spec.ts` (383) and
    `ui/src/app/app.spec.ts` (663) are the mega-specs the rule forbids, one per module. Split
    them next to the component they cover, as the chat module already did; `app.spec.ts` becomes
    `shell/popouts.spec.ts`, `command-palette.spec.ts`, `focus.spec.ts`, `chat-tabs.spec.ts`.

4.2 **Clock.** Fix the files 1.4 flags with `vi.useFakeTimers()` / `vi.setSystemTime()` or an
    injected `now`.

4.3 **Two runners, written down.** `*.test.ts` run on Node through the root `vitest.config.ts`;
    `*.spec.ts` run through `ng test` (Angular needs its builder). Don't unify; document it (5.1)
    so an agent doesn't put a UI spec in the Node run.

## 5. Claude Code setup, committed in the repo

5.1 **CLAUDE.md** (under ~80 lines): keep the Rules; add
    - *Map*: `contract/` (wire types; modules augment `CommandMap`/`EventMap` from
      `modules/*/contract.ts`), `service/` (background service; the chat's backend is the core
      `service/src/agents`, the settings/profiles/presets/layout backends are `service/src/core`),
      `app/` (Electron shell only), `ui/` (Angular shell and design system),
      `modules/<name>/{contract.ts,service,ui}`, `scripts/`.
    - *Commands*: `npm run check` before every commit, `dev`, `test`, `smoke`.
    - *Conventions*: the two test runners; commit titles `Area: what changed, in one sentence`
      (the repo's pattern); shell entries carry `label` and `plainLabel`, running text goes
      through `wording.say(book, plain)`.
    - *Decisions*: "Read `ADR.md` before any architectural change; a new decision is a new ADR."
      Don't `@import` ADR.md (12 kB on every turn); name it.

5.2 **`.claude/rules/`**, path-scoped so each loads only when matching files are touched:
    - `modules.md` (`paths: modules/**`): anatomy of a module, the three registration lists,
      `module.command` naming, migrations append-only, what it may import (2.2), `log` from the
      context rather than `console` (25 `console.*` calls in modules today).
    - `ui.md` (`paths: ui/**, modules/*/ui/**`): signals and zoneless, `inject()`, tokens only
      (the style guard), `Wording`, the `app-harness` for specs, spec per component, the style
      budget.
    - `service.md` (`paths: service/**, modules/*/service/**`): registry and events,
      `node:sqlite` and `migrate()`, the process model (ADR-010), tests on a fixed clock.
    - `contract.md` (`paths: contract/**, modules/*/contract.ts`): JSON-safe types only,
      `hello`/`welcome`/`shutdown` never change shape, owner-prefixed names.

5.3 **`.claude/skills/`** for the procedures that don't belong in CLAUDE.md: `new-module`
    (scaffold `contract.ts`, `service/index.ts`, `ui/<name>.providers.ts`, a spec, and the three
    registrations), `add-command` (contract augmentation → handler → UI call → test),
    `add-migration`.

5.4 **`.claude/settings.json`**: the hooks from 1.5 and a permissions allowlist for
    `npm run check`, `npm test`, `git status|diff|log`.

5.5 **Docs hygiene.** `TODO.md`'s "Decisions" section repeats the ADRs; delete it. A short
    `README.md` (what it is, how to run it) is for humans only; optional.

## 6. Wording stays

No refactor. New UI text goes through `wording.say()` or `plainLabel`, never a book word in code
(the existing rule). The chat module has 57 `say()` calls and settings 34; if they get in the way,
a module may keep one wording table (`wording.ts`, as `modules/schedules/ui` already does) instead
of inline calls. Optional.

## 7. Order of work

1. 1.1–1.3: check command, strict UI, one formatting commit.
2. 1.4 lint with the 2.2 import rules at *warn*; 1.5 hooks; 1.6 CI.
3. 5.1–5.4, so every later step runs under the new rules.
4. 2.1 → 2.2 → 2.3; then the import rules to *error*.
5. 3, by churn.
6. 4.1, whenever a module is touched.

## Not to change

The module registry, contract augmentation, the slot-based shell, SQLite migrations per owner, the
doc comments (dense and good for agents), the two test runners, the wording system.
