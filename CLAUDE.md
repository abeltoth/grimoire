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
- Typecheck, tests and the boundary lint must all pass before a commit.

## Glossary

| Book name | Plain name |
|---|---|
| Book | Main window |
| Chapter | Chat |
| Blank page, blank chapter | New chat, before its first message |
| Entry, Next page | Message |
| Loose leaf | Chat popped out into its own window |
| Facing page | Right page |
| Second chapter | Another chat on the right page |
| Parallel texts | The same message sent to a second model |
| Ribbon | An open chat's tab |
| Thumb index, thumb tab | Pages, a page's tab |
| Running head | A page's header |
| Running foot | A page's footer, with status indicators |
| Stamp | A badge in a chat's header, such as its PR review |
| Index | Command palette |
| Single page, Two pages | Focus mode, normal layout |
| Slip, seal | Approval card, approve |
| Dog-ear | Pin or star |
| Margin note | Tool call |
| Corrections | File diff |
| Fold-out | Expandable detail |
| Helper | Subagent |
| Outline | Plan |
| Colophon | Settings (`modules/colophon`) |
| Ledger | Usage (`modules/ledger`) |
| Front matter | Workflow setup (`modules/front-matter`) |
| Table of contents | History (`modules/history`) |
| Memory map | Memories (`modules/memory-map`) |
| Scriptorium | Terminal (`modules/terminal`) |
