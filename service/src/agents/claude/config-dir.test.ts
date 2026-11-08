import { homedir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { claudeHome, useClaudeFolder } from './config-dir';

describe('claudeHome', () => {
  it('is CLAUDE_CONFIG_DIR when set, else ~/.claude', () => {
    expect(claudeHome({ CLAUDE_CONFIG_DIR: '/work/claude' })).toBe('/work/claude');
    expect(claudeHome({ CLAUDE_CONFIG_DIR: '' })).toBe(path.join(homedir(), '.claude'));
    expect(claudeHome({})).toBe(path.join(homedir(), '.claude'));
  });
});

describe('useClaudeFolder', () => {
  const started = process.env['CLAUDE_CONFIG_DIR'];
  afterEach(() => {
    if (started === undefined) delete process.env['CLAUDE_CONFIG_DIR'];
    else process.env['CLAUDE_CONFIG_DIR'] = started;
    vi.resetModules();
  });

  it('sets the folder, and claudeHome reads it at once', () => {
    const env: NodeJS.ProcessEnv = {};
    useClaudeFolder('/work/claude', env);
    expect(env['CLAUDE_CONFIG_DIR']).toBe('/work/claude');
    expect(claudeHome(env)).toBe('/work/claude');
  });

  it('leaves the variable unset for the usual place when the service started without it', async () => {
    delete process.env['CLAUDE_CONFIG_DIR'];
    vi.resetModules();
    const fresh = await import('./config-dir');
    const env: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: '/work/claude' };
    fresh.useClaudeFolder(null, env);
    expect('CLAUDE_CONFIG_DIR' in env).toBe(false);
  });

  it('restores the folder the service started with for the usual place', async () => {
    process.env['CLAUDE_CONFIG_DIR'] = '/own/claude';
    vi.resetModules();
    const fresh = await import('./config-dir');
    const env: NodeJS.ProcessEnv = {};
    fresh.useClaudeFolder('/work/claude', env);
    fresh.useClaudeFolder(null, env);
    expect(env['CLAUDE_CONFIG_DIR']).toBe('/own/claude');
  });
});
