# Design prompts

Send these in order, in the same project. Send the next one when the previous screen is done.

## Prompt 1: App shell and a chat mid-turn

**What Grimoire is**
Grimoire is a desktop app for working with AI coding agents such as Claude Code, Codex and Gemini CLI. Its one user is a developer who keeps several agent chats running at the same time across projects. They want every feature one click or one shortcut away. The app runs on Mac and Windows and looks the same on both.

**The direction: a book of spells**
The core activity is reading long text, so Grimoire is a book. A chat never ends, only its turns do, so the book is a journal whose next page is always blank. Projects are parts, chats are chapters and turns are entries. Different agents are different authors. The book forms below are starting points; reinterpret them freely. Everything lives in the book: no menus or toolbars sitting on the pages. Anything that is text or a drawing can go on a page when nothing better fits.

A grimoire is a book of spells. The magic belongs in:
- the thinking and writing animations, where the agent at work is a spell being cast
- sealing an approval
- page turns and opening the book
- the ribbon that is waiting for you
- the drawings
- the book's own names, such as Colophon and Ledger, which the user learns after a few tries. Controls such as Stop and Undo keep plain names.

**What to design**
Design the app shell and one chat in full detail, at 1920×1080. Many features come later. For those, draw only the entry point that opens them. Their own pages will be designed later.

**Screens**
1. A chat mid-turn: the agent is streaming a reply, and other chats are open.
2. The same chat waiting for an approval.
3. The same chat waiting for answers to clarifying questions.
4. A new chat, just opened.
5. The command palette open.

Draw only screen 1 now. These and more screens follow in later prompts.

**The shell**
- Windows puts its window controls top-right and Mac puts them top-left. The layout works with both.
- The book's title is the current profile, "Work".
- Each open chat has a ribbon bookmark that shows its live status. All ribbons are visible at once, and one that is waiting for you stands out:
  - "Context meter": Claude Code, writing (the open chapter)
  - "Fix flaky login test": Codex, waiting for you
  - "Refactor storage migrations": Gemini CLI, thinking
  - "Morning repo summary": Claude Code, idle
- While approvals are waiting, one more ribbon appears with their count. It opens all pending approval slips on one page, ready to seal. In screen 1 it shows 1, for the Codex chat.
- A new chat is the most frequent action. One click opens it with the last-used settings.
- A two-page spread fits the screen. The facing page shows one of these at a time, and each is easy to open there. Any one can be open in screen 1:
  - the files: view and edit
  - git: a simple page with the branch tree and uncommitted changes
  - the agent's live todo plan, as the chapter outline
  - a second chat
- Thumb index: every feature page has a cut-out on the book's edge, labelled with its book name. New features add their own. In order of use:
  - Table of contents (history and search)
  - Front matter (workflow setup)
  - Kanban
  - Memory map
  - Scheduled chats
  - Ledger (usage stats)
  - Colophon (settings, presets and the theme editor)
- Running foot: status indicators as short text. Features add their own, such as the git branch and the next scheduled run. In screen 1: "feature/context-meter · Morning repo summary at 8:00".
- The command palette is the book's index. It reaches every action and shows each action's shortcut.

**The chat**
- Running head: the chapter title "Context meter" and the chat's settings as plain text: "Claude Code · Opus 5.5 · Ask first · ~/git/grimoire · No preset". Clicking any of them changes it.
- Transcript, top to bottom:
  - The user's entry: "Add a context meter to the composer. It should show how much of the context window is used." It has a plain-text "Undo", which restores the files to how they were before this entry.
  - The agent's thinking, shown as an animation while it happens. The thinking text is available but out of the way.
  - The agent's reply in markdown: a short paragraph, a list, inline code, and a code block as a numbered listing.
  - Three tool calls, as margin notes. The user scans them and opens the details as a fold-out only when needed:
    - Read `src/app/composer/composer.component.ts`.
    - Ran `npm test -- composer`: 12 passed, 1 failed.
    - Edited `src/app/composer/context-meter.component.ts` (+24 −3). The diff reads as proofreader's corrections.
  - The reply still streaming at the bottom, with a half-finished code block. A plain-text "Stop", with its shortcut Esc, sits right where the text is appearing.
- Composer: writing on the blank next page.
  - While the agent works, the user can still write and send. Those entries wait until the turn ends. One is queued: "Also add a tooltip with the exact token count."
  - A button attaches files and screenshots.
  - Context meter: the chapter's page allowance, 62% used.

**Chat actions to draw (place them where they fit)**
- Rename the chapter.
- Fork it, as a variant chapter.
- Pin and star it, as dog-ears.
- Tag it.
- Its pull request and CI status, as review stamps.
- The transcript detail level, as a plain or an annotated edition: normal, thinking or verbose.
- Focus mode: a single page.
- Pop the chat out as a loose leaf.
- Run one prompt on two models, as parallel texts on facing pages.

**Must hold true**
- **Balanced density:** a first-time user starts a chat without learning anything, and a daily user finds every feature without hunting.
- **Pages hold chats, not content:** huge command output, 2,000-line diffs, very long messages and the streaming reply never mean turning pages, and never push the composer off screen.
- **Agents differ:** each agent supports different features. A chat shows only the controls its agent supports and still looks complete with fewer of them.
- **Drawings stay at the edges:** use drawings only at the edges and in rare moments, such as chapter openings, empty pages and page turns, and never in the text being read. They can be turned off.
- **Layout isn't baked into the components:** later themes may rearrange the whole app. The message, tool call, approval, question form and composer each work on their own, wherever they're placed.
- **Everything becomes a token:** every color, font, spacing, radius, drawing and animation timing will be a design token the user changes in a theme editor. Build the design from a named token set and include the set.

## Prompt 2: Approval

Now draw screen 2: the same chat waiting for an approval, as a slip tucked into the page, waiting for your seal. The approval ribbon now shows 2.

The agent wants to run `git push origin feature/context-meter`. The choices are Allow once, Always allow and Deny. The user sees exactly what will run before choosing.

## Prompt 3: Clarifying questions

Now draw screen 3: the same chat waiting for answers to clarifying questions, as a printed form with tick boxes.

The agent asks two questions before it continues:
- "Where should the meter appear?" Pick one: In the composer (Recommended), In the running head, In the running foot.
- "Which warnings do you want?" Pick any: At 80% used, At 95% used, When the conversation gets compacted.

Both questions also accept a typed answer.

## Prompt 4: New chat

Now draw screen 4: a new chat, opened a moment ago with one click. It's a new chapter with a blank first page.

- The running head shows the last-used settings: "Claude Code · Opus 5.5 · Ask first · ~/git/grimoire · No preset". Clicking any of them changes it. The same settings also open from right-clicking a chat's ribbon.
  - Agents: Claude Code, Codex, Gemini CLI. The models listed depend on the agent.
  - Recent folders: `~/git/grimoire`, `~/git/breeder`, `~/Documents/cape-dashboard`.
  - Permission modes: Ask first, Accept edits, Plan only and Full access.
  - The preset list can also save the current settings as a new preset.
- The user is writing the first message: "The ribbons look blurry on my 4K screen."
  - They pasted a screenshot, which appears as a plate with a caption.
  - They attached `src/app/shell/ribbon.component.ts`, which appears as a captioned reference.
  - Files and screenshots come in through the attach button, or by dropping or pasting them.

## Prompt 5: Command palette

Now draw screen 5: the command palette open over the chat from screen 1, as the book's index.

The user has typed "new". The results:
- New chat, Ctrl+N
- New chat from preset
- New chat on the facing page, Ctrl+\
- The chat "New onboarding flow": Claude Code, `~/git/breeder`
- The setting "Default agent for new chats"

## Prompt 6: Agent commands

Now draw screen 6: in the chat from screen 1, the user has typed `/` at the start of a message. The index opens, filtered to the agent's commands and skills:
- commands: `/compact`, `/review`, `/init`
- skills: code-review, simplify

## Prompt 7: Approval slips

Now draw screen 7: the approval ribbon opened. All pending approval slips are on one page, and each can be sealed right there with Allow once, Always allow or Deny:
- "Fix flaky login test", Codex: run `npm test -- login --runInBand`
- "Context meter", Claude Code: run `git push origin feature/context-meter`

## Prompt 8: Writing to several chapters

Now draw screen 8: with "Context meter" open, the user has Ctrl+clicked the ribbons of "Fix flaky login test" and "Refactor storage migrations". The composer says "Writing to 3 chapters", and the message goes to all of them: "Pull the latest master before you continue."

## Prompt 9: Annotated edition

Now draw screen 9: the chat from screen 1 at the verbose detail level, as the annotated edition. The thinking text is shown in full, and the hooks that ran appear as margin notes, such as "Formatter ran on context-meter.component.ts".

## Prompt 10: The chapter later on

Now draw screen 10: the same chapter much later.
- The user pressed Undo on an earlier entry. That entry's edits stay in the transcript, marked as withdrawn.
- The chapter reached its page allowance and was abridged: its earliest part is replaced by a short summary, and the context meter is back to 18%.

## Prompt 11: Git and review stamps

Now draw screen 11: the chat from screen 1 with git open on the facing page, as a simple page.
- The branch tree: master, feature/context-meter (current) and feature/storage-migrations.
- Uncommitted changes: `context-meter.component.ts` (modified) and `context-meter.component.spec.ts` (new).

The chapter also carries its pull request and CI status as review stamps: "PR #12: in review" and "CI: 1 check failing".

## Prompt 12: Todo plan

Now draw screen 12: the chat from screen 1 with the agent's live todo plan open on the facing page, as the chapter outline:
1. Read the composer (done)
2. Add the meter component (done)
3. Fix the failing test (in progress)
4. Add the tooltip

## Prompt 13: Fork

Now draw screen 13: the user forked "Context meter" after the test run. The variant chapter, "Context meter (a)", continues from that point, and the original chapter stays as it was.

## Prompt 14: Focus mode

Now draw screen 14: the chat from screen 1 in focus mode, a single page with everything else hidden. The way back out is easy to find.

## Prompt 15: Pop-out

Now draw screen 15: "Fix flaky login test" popped out as a loose leaf, in its own window next to the book.

## Prompt 16: Two models side by side

Now draw screen 16: one prompt running on two models at once, as parallel texts on facing pages. The prompt is "Write the tests for the context meter". The left page is Opus 5.5 and the right page is Sonnet 5.5, and both are still streaming.

## Prompt 17: Profiles

Now draw screen 17: the user clicked the book's title, "Work". The profiles are listed as plain text: Work and Personal. Picking one closes this book and opens that one.

## Prompt 18: Table of contents

Now draw screen 18: the Table of contents, opened from its cut-out. It's the history of every chat, grouped into parts by project, with full-text search.
- grimoire: "Context meter", "Refactor storage migrations", "Morning repo summary"
- breeder: "New onboarding flow", "Fix flaky login test"

Tags are plain-text labels after the chapter titles, such as "ui" and "bug". The list can be filtered by them, and tags can be added here.

## Prompt 19: Front matter

Now draw screen 19: the Front matter, opened from its cut-out. It shows everything the agent loads for this chat's folder, and where each one comes from: instructions, memory, skills, subagents, hooks, MCP servers, plugins and permissions. It isn't a setup step, only a place to look and change things.
- MCP servers show their status, with on/off and reconnect. One of them is failing.
- Plugins have on/off and "Browse plugins".

## Prompt 20: Kanban

Now draw screen 20: Kanban, opened from its cut-out. Tasks are index cards in To do, Working and Done:
- To do: "Add dark theme tokens", "Write ribbon tests"
- Working: "Context meter", "Refactor storage migrations"
- Done: "Set up the Angular project"

An empty card at the end of To do creates a new task, and the agent's suggested follow-ups go on the board with one click. Opening a card starts its chapter, and the card then follows that chat's status.

## Prompt 21: Memory map

Now draw screen 21: the Memory map, opened from its cut-out. The agent's memories are drawn as a map of their cross-references. Sample memories: angular-conventions, design-tokens, testing-strategy and commit-style. design-tokens links to angular-conventions, and testing-strategy links to commit-style.

## Prompt 22: Scheduled chats

Now draw screen 22: Scheduled chats, opened from its cut-out. Each one is a dated journal entry:
- "Morning repo summary": weekdays at 8:00, Claude Code, `~/git/grimoire`
- "Dependency check": Mondays at 9:00, Codex, `~/git/breeder`

## Prompt 23: Ledger

Now draw screen 23: the Ledger, opened from its cut-out. It shows tokens per chat and per day, and the most-used tools and skills, as tables and drawn charts.

## Prompt 24: Colophon

Now draw screen 24: the Colophon, opened from its cut-out. It holds the settings, the presets and the theme editor with a live preview.
- Settings include "Default agent for new chats".
- Presets: "Bug fix" (Codex, Accept edits) and "Plan a feature" (Claude Code, Plan only).
