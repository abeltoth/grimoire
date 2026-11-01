import { TestBed } from '@angular/core/testing';
import type { GrimoireBridge, PingResult } from '@grimoire/contract';
import { App } from './app';
import { appConfig } from './app.config';
import { GRIMOIRE_BRIDGE } from './core/bridge';

const ping: PingResult = {
  pid: 4242,
  buildId: 'b1',
  startedAt: 0,
  uptimeMs: 65_000,
  node: '24.22.1',
};

function fakeBridge(overrides: Partial<GrimoireBridge> = {}): GrimoireBridge {
  return {
    platform: 'windows',
    invoke: (async () => ping) as GrimoireBridge['invoke'],
    on: () => () => {},
    window: { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() },
    ...overrides,
  };
}

async function render(bridge: GrimoireBridge) {
  TestBed.configureTestingModule({
    providers: [...appConfig.providers, { provide: GRIMOIRE_BRIDGE, useValue: bridge }],
  });
  const fixture = TestBed.createComponent(App);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const texts = (selector: string) =>
    [...el.querySelectorAll(selector)].map((node) => node.textContent!.replace(/\s+/g, ' ').trim());
  return { fixture, el, texts };
}

describe('App', () => {
  it('marks the background service connected once it answers', async () => {
    const { el } = await render(fakeBridge());
    expect(el.getAttribute('data-service-state')).toBe('connected');
    expect(el.textContent).not.toContain('Background service unreachable');
  });

  it('says in the running foot when the service is unreachable', async () => {
    const { el } = await render(
      fakeBridge({ invoke: () => Promise.reject(new Error('pipe closed')) }),
    );
    expect(el.getAttribute('data-service-state')).toBe('failed');
    expect(el.querySelector('.service-failed')!.getAttribute('title')).toBe('pipe closed');
  });

  it('draws window controls on Windows and wires them', async () => {
    const bridge = fakeBridge();
    const { el } = await render(bridge);
    el.querySelector<HTMLButtonElement>('[aria-label="Minimize window"]')!.click();
    el.querySelector<HTMLButtonElement>('[aria-label="Close window"]')!.click();
    expect(bridge.window.minimize).toHaveBeenCalledOnce();
    expect(bridge.window.close).toHaveBeenCalledOnce();
  });

  it('leaves the window controls to macOS', async () => {
    const { el } = await render(fakeBridge({ platform: 'mac' }));
    expect(el.querySelector('[aria-label="Close window"]')).toBeNull();
  });

  it('shows the registered thumb tabs, then the Index', async () => {
    const { texts } = await render(fakeBridge());
    expect(texts('gr-thumb-index button')).toEqual([
      'Table of contents',
      'Front matter',
      'Kanban',
      'Memory map',
      'Scheduled chats',
      'Ledger',
      'Colophon',
      'Index Ctrl K',
    ]);
  });

  it('prints shortcuts the way the platform writes them', async () => {
    const mac = await render(fakeBridge({ platform: 'mac' }));
    expect(mac.el.querySelector('gr-thumb-index .index')!.getAttribute('aria-label')).toBe(
      'Index, the command palette. Command K',
    );
    expect(mac.texts('gr-thumb-index .gr-kbd')).toEqual(['⌘K']);
    expect(mac.texts('gr-ribbon.new i')).toEqual(['Last settings · ⌘N']);
    TestBed.resetTestingModule();

    const windows = await render(fakeBridge());
    expect(windows.el.querySelector('gr-thumb-index .index')!.getAttribute('aria-label')).toBe(
      'Index, the command palette. Control K',
    );
    expect(windows.texts('gr-ribbon.new i')).toEqual(['Last settings · Ctrl+N']);
  });

  it('lays the ribbons out on both sides of the spine', async () => {
    const { texts } = await render(fakeBridge());
    expect(texts('.left-half gr-ribbon b')).toEqual([
      'Context meter',
      'Fix flaky login test',
      'Refactor storage migrations',
    ]);
    expect(texts('.right-half gr-ribbon b')).toEqual([
      'Morning repo summary',
      'Awaiting your seal',
      'New chapter',
    ]);
    expect(texts('[aria-current="page"] b')).toEqual(['Context meter']);
    expect(texts('gr-ribbon .seal')).toEqual(['1']);
  });

  it('makes a picked ribbon the open chapter, nearest the spine', async () => {
    const { fixture, el, texts } = await render(fakeBridge());
    const idle = [...el.querySelectorAll<HTMLButtonElement>('gr-ribbon .flat')].find((b) =>
      b.textContent!.includes('Morning'),
    )!;
    idle.click();
    await fixture.whenStable();
    expect(texts('.left-half gr-ribbon b')[0]).toBe('Morning repo summary');
    expect(texts('[aria-current="page"] b')).toEqual(['Morning repo summary']);
    expect(el.querySelector('gr-page')!.getAttribute('aria-label')).toBe(
      'Chapter: Morning repo summary',
    );
  });

  it('shows the first facing page that can be picked', async () => {
    const { el, texts } = await render(fakeBridge());
    expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Outline']);
    expect(texts('.tabs [aria-disabled="true"]')).toEqual(['Files', 'Git', 'Second chapter']);
    expect(el.querySelector('gr-outline-placeholder')!.textContent).toContain('Claude Code’s plan');
  });

  it('lists the registered indicators in the running foot', async () => {
    const { texts } = await render(fakeBridge());
    expect(texts('gr-status-indicators button')).toEqual([
      'feature/context-meter',
      'Morning repo summary at 8:00',
    ]);
  });
});
