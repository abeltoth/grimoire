import type { JiraIssueDraft } from '@grimoire/contract';
import { z } from 'zod';
import type { AgentTool, ToolChat } from '@grimoire/service/core/module';

/** What the agent is told of the tool, in its system prompt. */
export const PROPOSE_ISSUE_PROMPT =
  'Grimoire, the app this chat is in, gives you the tool propose_jira_issue, which offers the user a ' +
  "Jira issue for this chat's work, to create with a click, so their work shows in Jira. Call it once, " +
  'when the chat turns into real work worth tracking, such as a bug fixed, a feature built or an ' +
  'investigation, and the chat has no Jira issue yet; never for a question, a quick lookup or the ' +
  'next step of work already proposed. Never create a Jira issue any other way.';

const DESCRIPTION =
  "Offer the user a Jira issue for this chat's work, shown in the chat's header to edit, create or " +
  'dismiss; it creates nothing itself. Use it once, when the chat turns into real work worth tracking ' +
  'and has no Jira issue yet; never for questions, quick lookups or routine turns.';

const INPUT = {
  summary: z.string().describe("The issue's summary: a short line naming the work, as a title"),
  description: z
    .string()
    .describe('What the work is and why, in a few plain sentences someone reading Jira follows'),
  project: z
    .string()
    .optional()
    .describe("The Jira project's key, such as PROJ, when the chat makes it clear"),
  issueType: z
    .string()
    .optional()
    .describe("The issue type, such as Task, Bug or Story; the user's usual one when left out"),
};

/** The Jira issue a chat is linked to already, by its key, if any. */
export type LinkedIssue = (chat: ToolChat) => string | undefined;

/** Keeps a chat's proposal, telling every window. */
export type Propose = (chat: ToolChat, draft: JiraIssueDraft) => void;

/** The project and type a new issue begins with, from the settings; an empty project is left to the form. */
export type IssueDefaults = () => Pick<JiraIssueDraft, 'project' | 'issueType'>;

/**
 * The tool that lets the agent offer a Jira issue for a chat's work: it
 * only keeps the draft, shown in the chat's header, which you create or
 * dismiss there. It's given while `enabled` says, as Jira is on; a
 * project or type the agent leaves out is the settings'.
 */
export function proposeIssueTool(
  linked: LinkedIssue,
  propose: Propose,
  enabled: () => boolean,
  defaults: IssueDefaults = () => ({ project: '', issueType: 'Task' }),
): AgentTool<typeof INPUT> {
  return {
    name: 'propose_jira_issue',
    description: DESCRIPTION,
    prompt: PROPOSE_ISSUE_PROMPT,
    input: INPUT,
    enabled,
    run({ summary, description, project, issueType }, chat) {
      if (!chat) throw new Error('There is no chat to propose the issue in yet.');
      const key = linked(chat);
      if (key) return `This chat is linked to ${key} already; there's nothing to propose.`;
      const draft = {
        summary: summary.trim(),
        description: description.trim(),
        project: project?.trim().toUpperCase() || defaults().project,
        issueType: issueType?.trim() || defaults().issueType,
      };
      if (!draft.summary) throw new Error('The issue needs a summary.');
      propose(chat, draft);
      return "Shown to the user in the chat's header, to edit, create or dismiss. Don't create it yourself.";
    },
  };
}
