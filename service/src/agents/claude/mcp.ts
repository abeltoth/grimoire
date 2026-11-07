import type { Settings } from '@anthropic-ai/claude-agent-sdk';
import type { ChatSettings } from '@grimoire/contract';

/** The MCP servers off for a chat: those off in every chat, and its own; each once, sorted. */
export function mcpOff(everywhere: readonly string[], settings?: Pick<ChatSettings, 'mcpOff'>): string[] {
  return [...new Set([...everywhere, ...(settings?.mcpOff ?? [])])].sort();
}

/**
 * Settings that keep the MCP servers named from starting for one Claude
 * Code process. Claude Code's own /mcp turning off (toggleMcpServer) is
 * kept in its config for the folder, so terminal Claude Code would see it
 * too; this is gone with the process. Denying a server can't be undone
 * while the process runs, so a change starts it again.
 */
export function mcpSettings(off: readonly string[]): Pick<Settings, 'deniedMcpServers'> {
  return off.length ? { deniedMcpServers: off.map((serverName) => ({ serverName })) } : {};
}
