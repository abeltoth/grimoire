# Grimoire

## Rules

- A feature is one folder. Core never imports a module except from the single registration list.
- Core keeps only chat lifecycle. Anything a user can turn off is a module.
- Keep source files under ~400 lines, with tests next to the code. No new tests in a shared mega-spec.
- The composition root (`service/src/main.ts`, `ui/src/app/app.config.ts`) has no logic.
- Code uses plain names; book names appear only in UI text, through `Wording`.
- Comments explain why, in one sentence, with no history (git log keeps that).
- ADRs are never edited in place; a new ADR supersedes an old one.
- Tests never read the real clock.
- `npm run check` must pass before a commit.
