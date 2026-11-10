# Grimoire

## Rules

- A feature is one folder. Core never imports a module except from the single registration list.
- Core keeps only chat lifecycle. Anything a user can turn off is a module.
- Keep source files under ~400 lines, with tests next to the code. No new tests in a shared mega-spec.
- The composition roots (`service/src/main.ts`, `app/src/main.ts`, `ui/src/app/app.config.ts`)
  have no logic.
- Code uses plain names; book names appear only in UI text, through `Wording`.
- Comments explain why, in one sentence, with no history (git log keeps that).
- ADRs are never edited in place; a new ADR supersedes an old one.
- Tests never read the real clock.
- `npm run check` must pass before a commit.

## Map

- `contract/`: the wire types between windows and the service. Modules augment `CommandMap` and
  `EventMap` from `modules/*/contract.ts`.
- `service/`: the background service (ADR-010). The chat's backend is the core
  `service/src/agents`; the settings, profiles, presets and layout backends, and the helpers
  modules share, are `service/src/core`.
- `app/`: the Electron shell only: windows, tray, preload.
- `ui/`: the Angular shell (`ui/src/app`) and the design system (`ui/src/design-system`).
- `modules/<name>/{contract.ts,service,ui}`: one feature each, registered in
  `contract/src/index.ts`, `service/src/modules.ts` and `ui/src/app/app.config.ts`.
- `scripts/`: dev, build and service scripts.

## Commands

- `npm run check` before every commit: typecheck, format check, lint, and both test runners.
- `npm run dev`: the app with live reload.
- `npm test`: both test runners.
- `npm run smoke`: builds, starts the app headless and waits for the service to answer.
- `npm run format`: Prettier over the sources; a hook also formats each file Claude edits.

## Conventions

- Two test runners. `*.test.ts` run on Node through the root `vitest.config.ts`: contract,
  service, the modules' `service/`, app and `ui/tools`. `*.spec.ts` run through `ng test`, since
  Angular needs its builder: `ui/src` and the modules' `ui/`. A UI spec never goes in the Node run.
- Commit titles: `Area: what changed, in one sentence`, as in `git log`.
- Shell entries carry `label` and `plainLabel`; running text goes through
  `wording.say(book, plain)`.

## Decisions

Read `ADR.md` before any architectural change; a new decision is a new ADR.
