# agent-deck

A custom UI for Claude Code, built on the Claude Agent SDK.

## Decisions

- Personal tool, runs on Mac and Windows
- Desktop app: Electron
- TypeScript, Angular UI
- Sign in with my Claude subscription
- Long run: many features, custom style, animations

## To-do

- [ ] Project setup: TypeScript, local Node backend, web UI, signed in with subscription
- [ ] Chat view with live streaming, markdown and code
- [ ] Tool cards: commands, output, file diffs
- [ ] Approval dialogs (allow once / always allow / deny)
- [ ] Forms for Claude's clarifying questions
- [ ] Stop button, and sending messages while Claude is working
- [ ] Model and permission-mode switcher
- [ ] Session history: resume, rename, fork
- [ ] Slash command and skill palette
- [ ] Context meter
- [ ] Undo file changes
- [ ] Open new chat windows quickly: tabs plus split panes
- [ ] Status of all open chats, one approval inbox, notifications
- [ ] AI workflow setup view: shows everything Claude loads (CLAUDE.md, memory, skills, subagents, hooks, MCP servers, plugins, permissions) and where each comes from, all one click away, editable
- [ ] Custom styling
- [ ] Animations
- [ ] Chat presets: start a chat with a saved model, mode, folder and first prompt
- [ ] Send one prompt to several chats at once
- [ ] Run the same prompt on two models side by side
- [ ] Pop a tab out into its own window
- [ ] Full-text search across all past chats
- [ ] Pin, star and tag chats by project
- [ ] Memory graph: memories drawn as a graph of their `[[links]]`
- [ ] MCP dashboard: connected or failing, toggle on and off, reconnect
- [ ] A log of which hooks fired on each turn
- [ ] Profiles to switch between work and personal setups
- [ ] Live todo and progress panel for Claude's plan
- [ ] Usage stats: tokens per chat and per day, most-used tools and skills
- [ ] Paste screenshots straight into a chat
- [ ] Git panel: branch and uncommitted changes, plus a separate worktree per chat so parallel chats don't collide
- [ ] Scheduled chats, such as a morning summary of repo changes
- [ ] Theme editor with live preview
- [ ] Animated status per chat: thinking, writing, waiting for you
- [ ] Focus mode that hides everything except the active chat
- [ ] Transcript detail levels: normal, thinking, verbose
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
