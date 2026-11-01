import { describe, expect, it } from 'vitest';
import { alwaysAllowOf, toClaudeAnswers, toQuestions } from './permissions';

const input = {
  questions: [
    {
      question: 'Where should the meter appear?',
      header: 'Placement',
      options: [
        { label: 'In the composer (Recommended)', description: 'Next to Send' },
        { label: 'In the running head', description: 'Under the title' },
      ],
      multiSelect: false,
    },
    {
      question: 'Which warnings do you want?',
      header: 'Warnings',
      options: [
        { label: 'At 80% used', description: '' },
        { label: 'At 95% used', description: '' },
      ],
      multiSelect: true,
    },
  ],
};

describe('Claude Code questions', () => {
  it('reads the questions and its recommendation', () => {
    expect(toQuestions(input)).toEqual([
      {
        question: 'Where should the meter appear?',
        header: 'Placement',
        options: [
          { label: 'In the composer', description: 'Next to Send', recommended: true },
          { label: 'In the running head', description: 'Under the title' },
        ],
        multiSelect: false,
      },
      {
        question: 'Which warnings do you want?',
        header: 'Warnings',
        options: [{ label: 'At 80% used' }, { label: 'At 95% used' }],
        multiSelect: true,
      },
    ]);
  });

  it('answers with the labels as Claude Code wrote them, and your own words', () => {
    expect(
      toClaudeAnswers(input, [
        { chosen: ['In the composer'] },
        { chosen: ['At 80% used', 'At 95% used'], ownWords: ' and at 99% ' },
      ]),
    ).toEqual({
      'Where should the meter appear?': 'In the composer (Recommended)',
      'Which warnings do you want?': 'At 80% used, At 95% used, and at 99%',
    });
  });
});

describe('alwaysAllowOf', () => {
  it('names the rule and where it applies', () => {
    expect(
      alwaysAllowOf([
        {
          type: 'addRules',
          rules: [{ toolName: 'Bash', ruleContent: 'git push:*' }],
          behavior: 'allow',
          destination: 'localSettings',
        },
      ]),
    ).toEqual({ rule: 'git push', scope: 'project' });
  });

  it('covers a whole tool, a folder, or nothing', () => {
    expect(
      alwaysAllowOf([
        {
          type: 'addRules',
          rules: [{ toolName: 'Edit' }],
          behavior: 'allow',
          destination: 'session',
        },
      ]),
    ).toEqual({ scope: 'chat' });
    expect(
      alwaysAllowOf([
        { type: 'addDirectories', directories: ['/repo/docs'], destination: 'userSettings' },
      ]),
    ).toEqual({ rule: '/repo/docs', scope: 'everywhere' });
    expect(alwaysAllowOf([])).toBeUndefined();
    expect(alwaysAllowOf(undefined)).toBeUndefined();
  });
});
