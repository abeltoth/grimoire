/** An MCP tool's name: `mcp__<server>__<tool>`. */
const MCP_TOOL = /^mcp__(.+?)__(.+)$/;

/** Words of a camelCase or snake_case name, lower case but for acronyms. */
function words(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => (/^[A-Z0-9]{2,}$/.test(word) ? word : word.toLowerCase()))
    .join(' ');
}

/** The server an MCP tool is from, to read, such as "Atlassian"; undefined for any other tool. */
export function serverOf(tool: string): string | undefined {
  const mcp = MCP_TOOL.exec(tool);
  if (!mcp) return undefined;
  const server = mcp[1]!.replace(/^claude_ai_/, '').replaceAll('_', ' ');
  return `${server.charAt(0).toUpperCase()}${server.slice(1)}`;
}

/** A tool's name to read: an MCP tool as its server and what it does, such as "Atlassian: create confluence page". */
export function toolName(tool: string): string {
  const server = serverOf(tool);
  return server ? `${server}: ${words(MCP_TOOL.exec(tool)![2]!)}` : tool;
}
