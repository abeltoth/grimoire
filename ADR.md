# Architecture decisions

All records below were accepted on 2026-10-31.

## ADR-001: Personal tool for Mac and Windows

**Decision:** Grimoire is a personal tool for one user. It runs on Mac and Windows with the same features. Mac and Windows support is a requirement, not a quality goal that can be traded off.

**Consequences:** no accounts or multi-user features.

## ADR-002: Quality goals, in priority order

**Decision:** when goals conflict, the higher one wins.

1. **Low friction:** everything is one click or one shortcut away, and a new chat opens instantly.
2. **Extensibility:** a new feature is added as its own module without changing the core.
3. **Customizable look and feel:** every color, spacing and animation can be themed without code changes.
4. **Easy for AI agents to change:** small modules with clear contracts and tests, so an agent can change one feature without reading the whole codebase.

Responsiveness with many chats, safety and resilience are secondary.

## ADR-003: Electron desktop app

**Context:** considered a browser UI with a local Node server, Electron, and Tauri.

**Decision:** Electron.

**Reasons:**
- The Agent SDK needs Node, and Electron includes it.
- Electron ships the same Chromium on Mac and Windows, so styles and animations look identical on both.
- Real OS windows, a tray icon, and any keyboard shortcut.
- Rejected the browser because it reserves shortcuts like Ctrl+T, Ctrl+W and Ctrl+N, and pop-out tabs become browser pop-ups.
- Rejected Tauri because the SDK would need a separate Node process next to it, and it uses different browser engines on Mac and Windows.

**Consequences:** a large install and more RAM than a native app.

## ADR-004: TypeScript and Angular

**Context:** considered React, Angular, Vue and Svelte. Angular was preferred if it has proper support for what Grimoire needs.

**Decision:** TypeScript throughout, with Angular for the UI.

**Reasons:** every part Grimoire needs has a current Angular release or works with any framework: tabs, split panes and pop-outs (dockview), the code editor (Monaco), markdown with Mermaid, drag and drop and virtual scrolling (Angular CDK), animations (Angular's CSS animations and Motion's plain-JS version). Signals and zoneless change detection suit live streaming.

**Consequences:**
- There's no Angular markdown renderer built for streaming, so Grimoire handles half-finished markdown itself.
- The Agent SDK UI examples are React, so we borrow ideas from them, not code.

## ADR-005: Claude Code through the Agent SDK, signed in with the Claude subscription

**Decision:** Grimoire runs Claude Code through the Claude Agent SDK for TypeScript, using the user's existing Claude subscription login rather than an API key.

**Context:**
- The SDK provides Claude Code's agent loop, tools, permissions, sessions, hooks and skills as a library, and it loads the existing `~/.claude` setup.
- Anthropic's docs say third-party products may not offer claude.ai login without approval. Grimoire is a personal tool used with the owner's own subscription.
- A prototype confirmed that the SDK works with a Claude Pro login.

## ADR-006: Other agents through ACP, behind an agent-neutral contract

**Context:** in the long term, Grimoire should also work with other agents. The Agent Client Protocol (ACP) is a standard many agents support, including Gemini CLI, GitHub Copilot, Cursor, OpenCode and Goose, plus Codex and Claude through adapters.

**Decision:**
- The core talks to every agent through one agent-neutral contract covering sessions, messages, tool calls and approvals.
- Claude Code uses the Agent SDK directly (ADR-005). Other agents connect later through one ACP adapter.
- Each agent reports its capabilities, and features that need a capability appear only for agents that have it.

**Consequences:**
- The core doesn't depend on Claude-specific types.
- Claude-only features keep working through the direct SDK: the workflow setup view, skills, plugins, the hooks log, undoing file changes, and usage.

## ADR-007: Building blocks, with the backend as the single source of truth

**Decision:**
- **UI (Angular, one renderer per window):** shell (tabs, split panes, pop-outs, command palette), design system (tokens, themes, animations, base components), feature UIs, and client state.
- **Backend core:** module registry, agent hub (sessions, approvals, capabilities, plus the Claude and ACP adapters), workspace (projects, files, `~/.claude` config, file watching), git (git and gh), storage (SQLite), scheduler, and platform (Mac and Windows differences).
- UI and backend talk through a typed contract of commands and events.
- The backend is the single source of truth. Windows are views of it, and client state only mirrors it.
- All styling goes through design tokens. No feature hard-codes a color, size or animation timing.

**Reasons:** quality goals 1–4. The single source of truth keeps every window and pop-out in sync without extra work.

## ADR-008: Features are built-in modules

**Context:** considered built-in modules compiled into the app, and runtime plugins loaded from a folder without rebuilding.

**Decision:** built-in modules.
- A feature is a vertical slice: one folder holding its backend part, its UI part and its additions to the contract. It registers itself in the module registry.
- On the UI side, a module can register panes, commands with shortcuts, a settings section, status indicators and sidebar entries.
- On the backend side, a module can register services, command handlers and events, storage tables with their migrations, scheduled jobs, and the agent capabilities it needs.
- A module uses the core services, and other modules only through their published commands and events. It never imports another module's internals.
- Removing a module's folder removes the feature without breaking anything else.
- The core stays minimal: shell, module registry and core services. Chat is a module too.

**Consequences:** runtime plugins can be added later if the contract is designed carefully.

## ADR-009: Data ownership, local only

**Decision:**

| Data | Source of truth | What Grimoire does |
|---|---|---|
| Chat transcripts | The agent: Claude Code's session files | Reads them through the agent and never copies them |
| Chat titles | The agent | Writes them through the agent, so terminal Claude Code sees them too |
| Agent config: CLAUDE.md, memory, skills, hooks, settings, plugins | The files in `~/.claude` and project `.claude` folders | Reads and edits them in place, in Claude Code's own format |
| Credentials | Each agent | Never reads or stores them |
| Git state, PRs, CI | git and GitHub | Reads them live and doesn't store them |
| Layout, presets, pins and stars, tags, kanban, schedules, theme, Grimoire settings | Grimoire | Stores them in SQLite and refers to chats by session ID |
| Profiles, and the one in use | Grimoire | Stores them in SQLite. Each profile has its own Claude folder (Personal keeps Claude Code's usual `~/.claude`), layout, presets, schedules, open chapters and the chat editing each project, theme, Grimoire settings and search index; pins and stars, tags, undone entries and usage stats are shared by every profile |
| Search index, usage stats | Grimoire (derived) | Treats them as a cache that can be deleted and rebuilt |
| Running chats, pending approvals | Grimoire (in memory) | Doesn't persist them |

Grimoire's data stays local on each machine and isn't synced, because Claude Code's session files are per machine too.

Tags are Grimoire's, not the agent's: Claude Code holds only one tag per chat and terminal Claude Code doesn't show it, so Grimoire keeps any number of tags per chat, the same for every agent.

## ADR-010: Backend runs as a background service

**Context:** chats should keep working when Grimoire is closed, as they do in herdr. Grimoire will also be restarted often while it's being built.

**Decision:**
- The backend runs as a background service, separate from the Electron app, on Electron's built-in Node. The Electron app is only the UI (windows, tray, notifications) and connects to the service through a protected local connection.
- Chats keep working when windows close and when the app quits or restarts. Reopening reconnects. Closing the last window keeps the app in the tray.
- Each live chat has one Claude Code process, and one spare process is kept started so a new chat opens instantly.
- Windows can't reach Node or the file system. They only get the typed contract, through a preload script with context isolation.
- Windows subscribe only to the chats they show, and streamed text is batched.
- Heavy work like search indexing and stats runs in a separate worker process, so the service never stalls.
- After a reboot or a service crash, Grimoire restores the layout, shows each open chat's transcript, and continues the sessions in the background. Turns that were running and pending approvals are lost.

**Consequences:** a second process, keeping the app and service versions compatible, and the local connection has to be protected.

## ADR-011: System context

**Decision:** Grimoire talks to these external systems:

```
                          ┌───────────┐
                          │   User    │
                          └─────┬─────┘
                                │
┌───────────────────────────────┴──────────────────────────────┐
│                           Grimoire                           │
└──┬─────────────┬─────────────┬─────────────┬─────────────┬───┘
   │             │             │             │             │
Claude Code   Other agents  Files         git + GitHub  Operating system
(Agent SDK,   (ACP, long    · project     (git, gh CLI) (windows,
one process   term)           folders                   notifications,
per chat) →                 · ~/.claude                 clipboard, tray)
Claude with                   config
the user's                  · Claude Code
subscription                  session files
```

- Claude Code itself handles MCP servers, plugins, skills and hooks. Grimoire never talks to them directly.
- One exception: Grimoire gives Claude Code a small tool server of its own, run in the service's process through the Agent SDK. Its one tool lets the agent offer separate tasks as cards that open new chats. It isn't listed among the MCP servers and can't be turned off with them; the Colophon turns it off.
- A second exception: the Kanban board's Jira cards come from the user's claude.ai Atlassian connector. The service starts a hidden Claude Code process that loads no settings and saves nothing, and calls the connector's tools through the SDK's control channel (`mcp_call`, with no model turn and no tokens). That channel skips permission checks, so only an explicit list of Jira tools can be called. The sync's process may call only tools that read. Moving a card in Jira uses a process of its own, which may also call `transitionJiraIssue`: the one tool that writes, changing an issue's status.
- One chat edits each project, the git repository a chat's folder is in (else the folder), so chats side by side don't change each other's files; this replaced a git worktree per chat and its setup scripts. The first chat opened on a project edits it, until you make another the editing chat or it closes; the others can't edit files, refused by a hook before Claude Code's own permission checks, but otherwise work as any chat does, at the permission picked for them. Worktrees Grimoire made stay on disk; their chats work in the repository's folder.
- The later release notes scraper will add the web as another external system.
