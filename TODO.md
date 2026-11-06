# Grimoire

A custom UI for Claude Code, built on the Claude Agent SDK.

## Decisions

- Personal tool, runs on Mac and Windows
- Desktop app: Electron
- TypeScript, Angular UI
- Sign in with my Claude subscription
- Long run: many features, custom style, animations

## To-do

- [x] Project setup: TypeScript, local Node backend, web UI, signed in with subscription
- [x] Chat view with live streaming, markdown and code
- [x] Tool cards: commands, output, file diffs
- [x] Approval dialogs (allow once / always allow / deny)
- [x] Forms for Claude's clarifying questions
- [x] Stop button, and sending messages while Claude is working
- [x] Model and permission-mode switcher
- [x] Session history: resume, rename, fork
- [x] Slash command and skill palette
- [x] Context meter
- [x] Undo file changes
- [x] Open new chat windows quickly: tabs plus split panes
- [ ] Status of all open chats, one approval inbox, notifications
- [x] AI workflow setup view: shows everything Claude loads (CLAUDE.md, memory, skills, subagents, hooks, MCP servers, plugins, permissions) and where each comes from, all one click away, editable
- [x] Custom styling
- [x] Animations
- [x] Chat presets: start a chat with a saved model, mode, folder and first prompt
- [ ] Send one prompt to several chats at once
- [ ] Run the same prompt on two models side by side
- [ ] Pop a tab out into its own window
- [x] Full-text search across all past chats
- [x] Pin, star and tag chats by project
- [x] Memory graph: memories drawn as a graph of their `[[links]]`
- [ ] MCP dashboard: connected or failing, toggle on and off, reconnect
- [ ] A log of which hooks fired on each turn
- [ ] Profiles to switch between work and personal setups
- [x] Live todo and progress panel for Claude's plan
- [ ] Usage stats: tokens per chat and per day, most-used tools and skills
- [x] Paste screenshots straight into a chat
- [x] Git panel: branch and uncommitted changes, plus a separate worktree per chat so parallel chats don't collide
- [x] Scheduled chats, such as a morning summary of repo changes
- [x] Theme editor with live preview
- [x] Setting to toggle between the book names (Colophon, Ledger...) and plain labels (Settings, Usage...)
- [ ] Animated status per chat: thinking, writing, waiting for you
- [x] Focus mode that hides everything except the active chat
- [ ] Next-prompt suggestion you accept with Tab
- [ ] Suggested follow-up tasks as cards that open new chats
- [ ] @mention files or drag them into a chat
- [ ] Mermaid diagrams drawn in the chat
- [ ] File pane to view and edit files, using the VS Code editor
- [ ] Kanban board: tasks as cards, each one launching a chat
- [ ] Setup and cleanup scripts for each worktree
- [ ] Pull request and CI status for each chat, with auto-fix
- [ ] Auto-archive chats when their pull request is merged
- [ ] Plugin browser to install and turn plugins on or off from marketplaces
- [ ] Release notes scraper for new Claude Code features (later, not planned yet)

## Feature ideas

- Show remaining AI tokens (Claude first) in the thumb index menu.
- Token statistics and optimizer: show where most of the resources are spent and help optimize it.

## Design ideas

- Thinking animation: the thinking text as words coming out of a symbol.
- Focus mode as a papyrus roll, like an ancient text, instead of a book, so it fits the screen better.
- Two design directions: a magic one, and one for company work that is more solid, with fewer effects and animations.
