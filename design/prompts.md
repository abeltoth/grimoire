# Design prompts

Send these in order, in the same project. Send the next one when the previous screen is done.

## Prompt 1: App shell and a chat mid-turn

**What Grimoire is**
Grimoire is a desktop app for working with AI coding agents such as Claude Code, Codex and Gemini CLI. Its one user is a developer who keeps several agent chats running at the same time across projects. They want every feature one click or one shortcut away. The app runs on Mac and Windows and looks the same on both.

**The direction: a book of spells**
The core activity is reading long text, so Grimoire is a book. A chat never ends, only its turns do, so the book is a journal whose next page is always blank. Projects are parts, chats are chapters and turns are entries. The book forms below are starting points; reinterpret them freely. Everything lives in the book: no menus or toolbars sitting on the pages. Anything that is text or a drawing can go on a page when nothing better fits.

A grimoire is a book of spells. The magic lives in moments, motion and drawings, never in words, so every label stays plain. It belongs in:
- the thinking and writing animations, where the agent at work is a spell being cast
- sealing an approval
- the drawings at the edges and on empty pages
- page turns and opening the book
- the ribbon that is waiting for you

**What to design**
Design the app shell and one chat in full detail, at 1920×1080. Many features come later. For those, draw only the entry point that opens them. Their own pages will be designed later.

**Screens**
1. A chat mid-turn: the agent is streaming a reply, and other chats are open.
2. The same chat waiting for an approval.
3. The same chat waiting for answers to clarifying questions.
4. A new chat, just opened.
5. The command palette open.

Draw only screen 1 now. The others follow in later prompts.

**The shell**
- Windows puts its window controls top-right and Mac puts them top-left. The layout works with both.
- The book's title is the current profile, "Work". Clicking it lists the profiles as plain text. Picking another closes this book and opens that one.
- Ribbons:
  - Each open chat has a ribbon bookmark that shows its live status. All ribbons are visible at once, and one that is waiting for you stands out:
    - "Context meter": Claude Code, writing (the open chapter)
    - "Fix flaky login test": Codex, waiting for you
    - "Refactor storage migrations": Gemini CLI, thinking
    - "Morning repo summary": Claude Code, idle
  - While approvals are waiting, one more ribbon appears with their count. It opens all pending approval slips on one page, ready to seal.
  - Ctrl+click selects several ribbons, so one message goes to all of them.
  - Right-clicking a ribbon opens that chat's settings and tags.
- A new chat is the most frequent action. One click opens it with the last-used settings.
- A two-page spread fits the screen. The facing page shows one of these at a time, and each is easy to open there. Any one can be open in screen 1:
  - the files: view and edit
  - git: a simple page with the branch tree and uncommitted changes
  - the agent's live todo plan, as the chapter outline
  - a second chat
- Thumb index: every feature page has a labelled cut-out on the book's edge, and new features add their own. Cut-outs, in order of use:
  - the table of contents (history and search)
  - the front matter (workflow setup)
  - kanban
  - the memory map
  - scheduled chats
  - the ledger (usage stats)
  - the colophon (settings)
- Running foot: status indicators as short text. Features add their own, such as the git branch and the next scheduled run.
- The command palette is the book's index. It reaches every action and shows each action's shortcut.

**The chat**
- Running head: the chapter title "Context meter" and the chat's settings as plain text: "Claude Code · Opus 5.5 · Ask first · ~/git/grimoire · No preset".
  - Clicking any of them changes it.
  - The models listed depend on the agent.
  - The preset list can also save the current settings as a new preset.
  - The permission modes are Ask first, Accept edits, Plan only and Full access.
  - Different agents are different authors.
- Transcript, top to bottom:
  - The user's entry: "Add a context meter to the composer. It should show how much of the context window is used."
    - It has a plain-text "Undo", which restores the files to how they were before this entry.
    - Undone edits stay in the transcript, marked as withdrawn.
  - The agent's thinking, shown as an animation while it happens. The thinking text is available but out of the way.
  - The agent's reply in markdown: a short paragraph, a list, inline code, and a code block as a numbered listing.
  - Three tool calls, as margin notes. The user scans them and opens the details as a fold-out only when needed:
    - Read `src/app/composer/composer.component.ts`.
    - Ran `npm test -- composer`: 12 passed, 1 failed.
    - Edited `src/app/composer/context-meter.component.ts` (+24 −3). The diff reads as proofreader's corrections.
  - The reply still streaming at the bottom, with a half-finished code block.
    - A plain-text "Stop" sits right where the text is appearing.
    - Esc also stops it.
- Composer: writing on the blank next page.
  - While the agent works, the user can still write and send. Those entries wait until the turn ends. One is queued: "Also add a tooltip with the exact token count."
  - Attaching:
    - A button attaches files and screenshots, and they can also be dropped or pasted in.
    - Pictures appear as plates with a caption. Files appear as captioned references.
  - When several ribbons are selected, the composer says so, for example "Writing to 3 chapters".
  - Context meter: the chapter's page allowance, 62% used. Compaction abridges the chapter.
  - Typing `/` at the start of a message opens the index, filtered to the agent's commands and skills.

**Chat actions to draw (place them where they fit)**
- Rename the chapter.
- Fork it, as a variant chapter.
- Pin and star it, as dog-ears.
- Tag it, from the right-click on a ribbon or from the table of contents.
- Its pull request and CI status, as review stamps.
- The transcript detail level, as a plain or an annotated edition: normal, thinking or verbose. Only verbose shows the hooks that ran, as margin notes.
- Focus mode: a single page.
- Pop the chat out as a loose leaf.
- Run one prompt on two models, as parallel texts on facing pages.

**Feature pages (draw only their cut-outs now)**
- **Table of contents:**
  - history with full-text search
  - tags as plain-text labels after the chapter titles, which you can filter by
- **Front matter:** everything the agent loads for this chat's folder (instructions, memory, skills, subagents, hooks, MCP servers, plugins, permissions) and where each one comes from. It isn't a setup step, only a place to look and change things.
  - MCP servers show their status, with on/off and reconnect.
  - Plugins have on/off and "Browse plugins".
- **Kanban:**
  - Tasks are index cards in To do, Working and Done.
  - An empty card at the end of To do creates a new task, and the agent's suggested follow-ups go on the board with one click.
  - Opening a card starts its chapter, and the card then follows that chat's status.
- **Memory map:** memories drawn as a map of their cross-references.
- **Scheduled chats:** dated journal entries.
- **Ledger:** tokens per chat and per day, and the most-used tools and skills, as tables and drawn charts.
- **Colophon:** settings, presets and the theme editor.

**Must hold true**
- **Balanced density:** a first-time user starts a chat without learning anything, and a daily user finds every feature without hunting.
- **Pages hold chats, not content:** huge command output, 2,000-line diffs, very long messages and the streaming reply never mean turning pages, and never push the composer off screen.
- **Agents differ:** each agent supports different features. A chat shows only the controls its agent supports and still looks complete with fewer of them.
- **Drawings stay at the edges:** use drawings only at the edges and in rare moments, such as chapter openings, empty pages and page turns, and never in the text being read. They can be turned off.
- **Layout isn't baked into the components:** later themes may rearrange the whole app. The message, tool call, approval, question form and composer each work on their own, wherever they're placed.
- **Everything becomes a token:** every color, font, spacing, radius, drawing and animation timing will be a design token the user changes in a theme editor. Build the design from a named token set and include the set.

## Prompt 2: Approval

Now draw screen 2: the same chat waiting for an approval, as a slip tucked into the page, waiting for your seal.

The agent wants to run `git push origin feature/context-meter`. The choices are Allow once, Always allow and Deny. The user sees exactly what will run before choosing.

## Prompt 3: Clarifying questions

Now draw screen 3: the same chat waiting for answers to clarifying questions, as a printed form with tick boxes.

The agent asks two questions before it continues:
- "Where should the meter appear?" Pick one: In the composer (Recommended), In the chat header, In the status bar.
- "Which warnings do you want?" Pick any: At 80% used, At 95% used, When the conversation gets compacted.

Both questions also accept a typed answer.

## Prompt 4: New chat

Now draw screen 4: a new chat, opened a moment ago with one click. It's a new chapter with a blank first page.

- The user can type the first message straight away and send it.
- The running head shows the last-used settings: "Claude Code · Opus 5.5 · Ask first · ~/git/grimoire · No preset". Before sending, the user can click any of them to change it, including picking a preset.
- Agents: Claude Code, Codex, Gemini CLI.
- Recent folders: `~/git/grimoire`, `~/git/breeder`, `~/Documents/cape-dashboard`.

## Prompt 5: Command palette

Now draw screen 5: the command palette open over the chat from screen 1, as the book's index.

The user has typed "new". The results:
- New chat, Ctrl+N
- New chat from preset
- New chat on the facing page, Ctrl+\
- The chat "New onboarding flow": Claude Code, `~/git/breeder`
- The setting "Default agent for new chats"
