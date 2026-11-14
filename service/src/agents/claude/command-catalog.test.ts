import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { catalog } from './command-catalog';

const command = (name: string, argumentHint = ''): SlashCommand => ({
  name,
  description: `${name} it`,
  argumentHint,
});

describe('catalog', () => {
  it('groups the commands, and says how each runs', () => {
    const listed = catalog({
      commands: [
        command('usage'),
        command('compact', '<optional custom summarization instructions>'),
        command('batch', '<instruction>'),
        command('debug', '[issue description]'),
        command('config', 'key=value'),
      ],
      skills: new Set(),
    });
    expect(listed.map(({ name, group, run }) => [name, group, run])).toEqual([
      ['usage', 'reports', 'now'],
      ['compact', 'chat', 'now'],
      ['batch', 'chat', 'compose'],
      ['debug', 'chat', 'now'],
      ['config', 'settings', 'compose'],
      ['permissions', 'settings', 'pick'],
    ]);
  });

  it('writes skills in to finish, even one named as a command it hides', () => {
    const listed = catalog({
      commands: [command('review-pr', '<number>'), command('focus')],
      skills: new Set(['review-pr', 'focus']),
    });
    expect(listed.slice(0, 2)).toEqual([
      {
        name: 'review-pr',
        description: 'review-pr it',
        argumentHint: '<number>',
        group: 'skills',
        run: 'compose',
      },
      { name: 'focus', description: 'focus it', group: 'skills', run: 'compose' },
    ]);
  });

  it('leaves out plumbing, terminal-only commands and a name listed twice', () => {
    const listed = catalog({
      commands: [
        command('__remote-workflow'),
        command('color', '[red|blue]'),
        command('mcp', '[reconnect|enable|disable [<server>|all]]'),
        command('init'),
        command('init'),
      ],
      skills: new Set(),
    });
    expect(listed.map((c) => c.name)).toEqual(['init', 'permissions']);
  });

  it('takes the choices from a hint of words, and the current ones where Claude Code says', () => {
    const listed = catalog({
      commands: [
        command('advisor', '[fable|opus|off]'),
        command('design', 'consent | revoke'),
        command('fast', '[on|off]'),
        command('output-style', '[style]'),
        command('autocompact', '[auto|<tokens>]'),
      ],
      skills: new Set(),
      outputStyle: 'Concise',
      outputStyles: ['default', 'Concise'],
      fastMode: 'cooldown',
    });
    expect(listed.map(({ name, run, choices }) => [name, run, choices])).toEqual([
      ['advisor', 'pick', [{ value: 'fable' }, { value: 'opus' }, { value: 'off' }]],
      ['design', 'pick', [{ value: 'consent' }, { value: 'revoke' }]],
      ['fast', 'pick', [{ value: 'on', current: true }, { value: 'off' }]],
      ['output-style', 'pick', [{ value: 'default' }, { value: 'Concise', current: true }]],
      ['autocompact', 'compose', undefined],
      ['permissions', 'pick', undefined],
    ]);
  });

  it('marks what Grimoire keeps itself, to change it there', () => {
    const listed = catalog({
      commands: [
        command('model', '<model>'),
        command('effort', '<low|high>'),
        command('clear', '[name]'),
        command('rename', '[name]'),
      ],
      skills: new Set(),
    });
    expect(listed.map(({ name, run, owner, choices }) => [name, run, owner, choices])).toEqual([
      ['model', 'pick', 'model', undefined],
      ['effort', 'pick', 'effort', undefined],
      ['clear', 'now', 'new-chat', undefined],
      ['rename', 'now', 'rename', undefined],
      ['permissions', 'pick', 'mode', undefined],
    ]);
  });
});
