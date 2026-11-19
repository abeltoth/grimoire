import { serverOf, toolName } from './tool-name';

describe('toolName', () => {
  it('reads an MCP tool as its server and what it does', () => {
    expect(toolName('mcp__claude_ai_Atlassian__createConfluencePage')).toBe(
      'Atlassian: create confluence page',
    );
    expect(toolName('mcp__grimoire__add_todo')).toBe('Grimoire: add todo');
  });

  it('keeps acronyms', () => {
    expect(toolName('mcp__web__getURLContents')).toBe('Web: get URL contents');
    expect(toolName('mcp__claude_ai_Google_Drive__list_PDF_files')).toBe(
      'Google Drive: list PDF files',
    );
  });

  it('leaves any other tool as it is', () => {
    expect(toolName('WebFetch')).toBe('WebFetch');
    expect(toolName('mcp__broken')).toBe('mcp__broken');
  });
});

describe('serverOf', () => {
  it("names an MCP tool's server, and no other tool's", () => {
    expect(serverOf('mcp__claude_ai_Google_Drive__list_files')).toBe('Google Drive');
    expect(serverOf('mcp__grimoire__add_todo')).toBe('Grimoire');
    expect(serverOf('Read')).toBeUndefined();
  });
});
