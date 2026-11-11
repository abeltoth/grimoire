import { TestBed } from '@angular/core/testing';
import type { Preset } from '@grimoire/contract';
import { useFakeBridge } from '../../testing/app-testing';
import { PresetList } from './preset-list';

const preset = (name: string, prompt?: string): Preset => ({
  name,
  agent: 'claude-code',
  settings: { mode: 'plan' },
  ...(prompt ? { prompt } : {}),
});

describe('PresetList', () => {
  it('lists the presets the service keeps, and keeps them when it can’t say', async () => {
    const { answers } = useFakeBridge();
    answers['presets.list'] = () => [preset('Planning')];
    const list = TestBed.inject(PresetList);
    await list.ready;
    expect(list.all().map(({ name }) => name)).toEqual(['Planning']);

    answers['presets.list'] = () => Promise.reject(new Error('gone'));
    await list.load();
    expect(list.all().map(({ name }) => name)).toEqual(['Planning']);
  });

  it('renames, removes and writes in a first message, saying why a change failed', async () => {
    const { answers, calls } = useFakeBridge();
    answers['presets.list'] = () => [preset('Planning')];
    answers['presets.rename'] = () => [preset('Plans')];
    answers['presets.save'] = () => [preset('Plans', 'Plan it')];
    answers['presets.remove'] = () => Promise.reject(new Error('It’s in use'));
    const list = TestBed.inject(PresetList);
    await list.ready;

    expect(await list.rename('Planning', 'Plans')).toBe(true);
    expect(await list.setPrompt(list.all()[0]!, 'Plan it')).toBe(true);
    expect(calls.find((c) => c.command === 'presets.save')!.request).toEqual(
      preset('Plans', 'Plan it'),
    );
    expect(list.all()).toEqual([preset('Plans', 'Plan it')]);
    expect(await list.remove('Plans')).toBe(false);
    expect(list.failed()).toBe('It’s in use');
    expect(list.all()).toHaveLength(1);
  });
});
