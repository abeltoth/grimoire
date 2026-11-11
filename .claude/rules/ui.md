---
paths:
  - "ui/**"
  - "modules/*/ui/**"
---

# UI

- Standalone components with signals (`signal`, `computed`, `effect`); change detection is
  zoneless, Angular's default, so state that drives a view is a signal.
- Inject with `inject()`, never constructor parameters.
- Style only through `--gr-*` tokens from `ui/src/design-system/themes/grimoire.css`. The style
  guard (`ui/tools/style-guard.test.ts`) fails on a literal colour, timing, length or font outside
  `ui/src/design-system`, and on a token the theme doesn't define.
- The theme sheets keep one token per line: the theme editor reads them that way, so Prettier
  skips them.
- Code uses plain names. UI text in the book's words goes through `wording.say(book, plain)`;
  shell entries carry `label` and `plainLabel`.
- One `*.spec.ts` per component, next to it. Render through `ui/src/testing/app-testing.ts`:
  `fakeBridge()` stands in for the service (`answers[command]`, `emit`, `calls`) and `render()`
  starts the app on it.
- Specs never read the real clock: `vi.useFakeTimers({ toFake: ['Date'] })` and
  `vi.setSystemTime(...)`, then `vi.useRealTimers()` after each.
- Size: a stylesheet stays within 400 lines (the style guard), and a component's compiled styles
  warn at 8 kB and fail the build at 12 kB (`ui/angular.json`). Split a sheet that nears 8 kB
  into child components.
