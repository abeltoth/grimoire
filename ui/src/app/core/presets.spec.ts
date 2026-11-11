import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { NewChatSettings, Preset } from '@grimoire/contract';
import { useFakeBridge } from '../../testing/app-testing';
import type { Chat } from './chat';
import { ChatActions } from './chat-actions';
import { Presets } from './presets';

const chat = (settings: NewChatSettings, status: Chat['status'] = 'idle'): Chat => ({
  id: 'chat-1',
  agent: 'claude-code',
  title: '',
  settings,
  status,
  entries: [],
  approvals: [],
  queued: [],
  plan: [],
  withdrawn: [],
  copied: [],
});

const planning: Preset = {
  name: 'Planning',
  agent: 'claude-code',
  settings: { cwd: 'C:/Users/me', model: 'opus', effort: 'xhigh', mode: 'plan' },
};

async function withPresets(saved: Preset[] = [planning]) {
  const fake = useFakeBridge();
  fake.answers['presets.list'] = () => saved;
  fake.answers['presets.save'] = (preset: Preset) => [...saved, preset];
  const presets = TestBed.inject(Presets);
  await TestBed.inject(ApplicationRef).whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  return { ...fake, presets };
}

describe('Presets', () => {
  it('puts a chat on the preset its settings are, with the defaults written in', async () => {
    const { presets } = await withPresets();
    expect(presets.of(chat({ mode: 'plan' }))?.name).toBe('Planning');
    expect(presets.of(chat({ mode: 'plan', effort: 'low' }))).toBeUndefined();
    expect(presets.describe(planning)).toBe('Claude Code · Plan only');
  });

  it('saves a chat’s settings spelled out, under a name', async () => {
    const { presets, calls } = await withPresets([]);
    await presets.save(chat({ mode: 'plan' }), '  ');
    await presets.save(chat({ mode: 'plan' }), ' Planning ');
    expect(calls.filter((c) => c.command === 'presets.save').map((c) => c.request)).toEqual([
      planning,
    ]);
    expect(presets.all().map(({ name }) => name)).toEqual(['Planning']);
  });

  it('fits any blank chat, and a begun one only in its own agent and folder', async () => {
    const { presets } = await withPresets();
    expect(presets.fits(planning, chat({ cwd: 'D:/elsewhere' }, 'blank'))).toBe(true);
    expect(presets.fits(planning, chat({}))).toBe(true);
    expect(presets.fits(planning, chat({ cwd: 'D:/elsewhere' }))).toBe(false);
  });

  it('sets a blank chat up from the preset, and gives a begun one its model, effort and mode', async () => {
    const { presets } = await withPresets();
    const actions = TestBed.inject(ChatActions);
    const setUp = vi.spyOn(actions, 'setUp').mockImplementation(() => {});
    const configure = vi.spyOn(actions, 'configure').mockResolvedValue();
    await presets.use(planning, chat({}, 'blank'));
    expect(setUp).toHaveBeenCalledWith('chat-1', 'claude-code', planning.settings, undefined);
    await presets.use(planning, chat({}));
    expect(configure).toHaveBeenCalledWith('chat-1', {
      model: 'opus',
      effort: 'xhigh',
      mode: 'plan',
    });
  });
});
