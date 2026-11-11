# Grimoire
A custom UI for Claude Code, built on the Claude Agent SDK.

## Decisions
- Runs on Mac and Windows
- Desktop app: Electron
- TypeScript, Angular UI
- Sign in with Claude subscription
- Long run: many features, custom style, animations

## To-do
Option to disable JIRA tasks
Notetaker for short random notes
Show agent websearch details
Create better ai workflow for home development
Rework history to resume tasks easier
Show code changes properly when edited
Token statistics and optimizer: show where most of the resources are spent and help optimize it.
Proper git history viewer
Rework command palette
Subagent effort level
Better file viewer
Remove not needed explanations
Ability to see full pasted picture
Estimate progress on a task: what % of completion we're at.
Release notes scraper for new Claude Code features
Plugin browser to install and turn plugins on or off from marketplaces

## Design
Two design directions: a magic one, and one for company work that is more solid, with fewer effects and animations.
Thinking animation: the thinking text as words coming out of a symbol.
Focus mode as a papyrus roll, like an ancient text, instead of a book, so it fits the screen better.

## Maybe
Post mortem automation if ai fails some guidelines
Pull request and CI status for each chat, with auto-fix
Auto-archive chats when their pull request is merged
