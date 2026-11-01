import type { AlwaysAllow, Answer, Question } from '@grimoire/contract';
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

/** Claude Code's tool for asking you questions; its input carries them. */
export const ASK_TOOL = 'AskUserQuestion';

interface ClaudeQuestion {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
}

const RECOMMENDED = /\s*\(recommended\)\s*$/i;

/** Claude Code's questions in the contract's terms. It marks its pick with "(Recommended)". */
export function toQuestions(input: Record<string, unknown>): Question[] {
  const questions = (input['questions'] ?? []) as ClaudeQuestion[];
  return questions.map((q) => ({
    question: q.question,
    ...(q.header ? { header: q.header } : {}),
    options: q.options.map((option) => ({
      label: option.label.replace(RECOMMENDED, ''),
      ...(option.description ? { description: option.description } : {}),
      ...(RECOMMENDED.test(option.label) ? { recommended: true } : {}),
    })),
    multiSelect: q.multiSelect === true,
  }));
}

/**
 * Your answers as Claude Code takes them: one string per question, keyed by
 * the question, with the options it offered (labels as it wrote them) and
 * your own words joined by commas.
 */
export function toClaudeAnswers(
  input: Record<string, unknown>,
  answers: Answer[],
): Record<string, string> {
  const questions = (input['questions'] ?? []) as ClaudeQuestion[];
  return Object.fromEntries(
    questions.map((q, i) => {
      const answer = answers[i] ?? { chosen: [] };
      const labels = answer.chosen.map(
        (chosen) =>
          q.options.find((option) => option.label.replace(RECOMMENDED, '') === chosen)?.label ??
          chosen,
      );
      const ownWords = answer.ownWords?.trim();
      return [q.question, [...labels, ...(ownWords ? [ownWords] : [])].join(', ')];
    }),
  );
}

/** What Claude Code's suggested permission update would allow, in the contract's terms. */
export function alwaysAllowOf(
  suggestions: PermissionUpdate[] | undefined,
): AlwaysAllow | undefined {
  const suggestion =
    suggestions?.find((s) => s.type === 'addRules' && s.behavior === 'allow') ?? suggestions?.[0];
  if (!suggestion) return undefined;
  const scope: AlwaysAllow['scope'] =
    suggestion.destination === 'userSettings'
      ? 'everywhere'
      : suggestion.destination === 'projectSettings' || suggestion.destination === 'localSettings'
        ? 'project'
        : 'chat';
  const rule =
    suggestion.type === 'addRules'
      ? suggestion.rules
          .map((r) => r.ruleContent?.replace(/:\*$/, ''))
          .filter(Boolean)
          .join(', ')
      : suggestion.type === 'addDirectories'
        ? suggestion.directories.join(', ')
        : '';
  return rule ? { rule, scope } : { scope };
}
