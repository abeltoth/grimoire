import { TestBed } from '@angular/core/testing';
import { type CommandRequest, DEFAULT_SETTINGS, type GrimoireSettings } from '@grimoire/contract';
import { DesignSettings } from '../../design-system/design-settings';
import { useFakeBridge } from '../../testing/app-testing';
import { Settings } from './settings';

function withSettings() {
  const fake = useFakeBridge();
  let kept: GrimoireSettings = { ...DEFAULT_SETTINGS, wording: 'plain' };
  fake.answers['settings.get'] = () => kept;
  fake.answers['settings.set'] = (change: CommandRequest<'settings.set'>) =>
    (kept = { ...kept, ...change });
  const settings = TestBed.inject(Settings);
  const sent = () => fake.calls.filter((c) => c.command === 'settings.set').map((c) => c.request);
  return { ...fake, settings, sent, kept: () => kept };
}

describe('Settings', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the settings the service keeps, and follows them as they change', async () => {
    const { settings, emit } = withSettings();
    await settings.ready;
    expect(settings.all().wording).toBe('plain');
    emit('settings.changed', { settings: { ...DEFAULT_SETTINGS, drawings: false } });
    expect(settings.all().drawings).toBe(false);
  });

  it('changes at once, and takes the service’s settings back when it refuses', async () => {
    const { settings, answers } = withSettings();
    await settings.ready;
    await settings.set({ drawings: false });
    expect(settings.all().drawings).toBe(false);

    answers['settings.set'] = () => Promise.reject(new Error('The disk is full'));
    await settings.set({ wording: 'book' });
    expect(settings.failed()).toBe('The disk is full');
    expect(settings.all().wording).toBe('plain');
  });

  it('sends a run of changes once it stops, over what the service says meanwhile', async () => {
    vi.useFakeTimers();
    const { settings, sent, emit } = withSettings();
    await vi.runAllTimersAsync();
    settings.setSoon({ theme: { '--gr-page': '#fff' } });
    settings.setSoon({ theme: { '--gr-page': '#eee' } });
    emit('settings.changed', { settings: DEFAULT_SETTINGS });
    expect(settings.all().theme).toEqual({ '--gr-page': '#eee' });
    expect(sent()).toEqual([]);

    await vi.advanceTimersByTimeAsync(300);
    expect(sent()).toEqual([{ theme: { '--gr-page': '#eee' } }]);
  });

  it('hands the look to the design system', async () => {
    const { settings } = withSettings();
    await settings.set({ drawings: false, themeName: 'night', theme: { '--gr-page': '#000' } });
    TestBed.tick();
    const design = TestBed.inject(DesignSettings);
    expect(design.drawings()).toBe(false);
    expect(design.themeName()).toBe('night');
    expect(design.tokens()).toEqual({ '--gr-page': '#000' });
  });
});
