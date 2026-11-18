import { describe, expect, it, vi } from 'vitest';
import { PROPOSE_ISSUE_PROMPT, proposeIssueTool } from './propose-issue';

const chat = { chatId: 'chat-1', agent: 'claude-code', cwd: '/git/grimoire' };

/** The tool over a chat linked to `key`, if given, noting what it proposed. */
function tool(key?: string, enabled = () => true) {
  const propose = vi.fn();
  return { tool: proposeIssueTool(() => key, propose, enabled), propose };
}

describe('the propose_jira_issue tool', () => {
  it('tells the agent to propose once, for real work, and never to create an issue itself', () => {
    const { tool: proposing } = tool();
    expect(proposing.name).toBe('propose_jira_issue');
    expect(proposing.prompt).toBe(PROPOSE_ISSUE_PROMPT);
    expect(PROPOSE_ISSUE_PROMPT).toContain('Call it once');
    expect(PROPOSE_ISSUE_PROMPT).toContain('Never create a Jira issue any other way');
  });

  it('is given while what enables it says', () => {
    let on = false;
    const { tool: proposing } = tool(undefined, () => on);
    expect(proposing.enabled?.()).toBe(false);
    on = true;
    expect(proposing.enabled?.()).toBe(true);
  });

  it('keeps the draft for the chat, its project in capitals and a Task by default', async () => {
    const { tool: proposing, propose } = tool();
    const said = await proposing.run(
      {
        summary: ' Draw the context meter ',
        description: ' From the usage events. ',
        project: 'grim',
      },
      chat,
    );
    expect(propose).toHaveBeenCalledWith(chat, {
      summary: 'Draw the context meter',
      description: 'From the usage events.',
      project: 'GRIM',
      issueType: 'Task',
    });
    expect(said).toContain("Don't create it yourself");
  });

  it('takes the project and type the agent leaves out from the settings', async () => {
    const propose = vi.fn();
    const proposing = proposeIssueTool(
      () => undefined,
      propose,
      () => true,
      () => ({ project: 'OPS', issueType: 'Story' }),
    );
    await proposing.run({ summary: 'Deploy', description: '' }, chat);
    await proposing.run(
      { summary: 'Deploy', description: '', project: 'grim', issueType: 'Bug' },
      chat,
    );
    expect(propose.mock.calls.map(([, draft]) => [draft.project, draft.issueType])).toEqual([
      ['OPS', 'Story'],
      ['GRIM', 'Bug'],
    ]);
  });

  it('proposes nothing for a chat linked to an issue already', async () => {
    const { tool: proposing, propose } = tool('GRIM-12');
    expect(await proposing.run({ summary: 'More', description: '' }, chat)).toBe(
      "This chat is linked to GRIM-12 already; there's nothing to propose.",
    );
    expect(propose).not.toHaveBeenCalled();
  });

  it('turns away a draft with no summary, or no chat', () => {
    const { tool: proposing } = tool();
    expect(() => proposing.run({ summary: ' ', description: '' }, chat)).toThrow(
      'The issue needs a summary.',
    );
    expect(() => proposing.run({ summary: 'A', description: '' }, undefined)).toThrow(
      'There is no chat to propose the issue in yet.',
    );
  });
});
