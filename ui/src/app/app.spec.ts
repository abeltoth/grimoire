import { TestBed } from '@angular/core/testing';
import type { GrimoireBridge, PingResult } from '@grimoire/contract';
import { App } from './app';
import { GRIMOIRE_BRIDGE } from './core/bridge';

const ping: PingResult = { pid: 4242, buildId: 'b1', startedAt: 0, uptimeMs: 65_000, node: '24.22.1' };

function fakeBridge(overrides: Partial<GrimoireBridge> = {}): GrimoireBridge {
  return {
    platform: 'windows',
    invoke: (async () => ping) as GrimoireBridge['invoke'],
    on: () => () => {},
    window: { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() },
    ...overrides,
  };
}

async function render(bridge: GrimoireBridge): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    imports: [App],
    providers: [{ provide: GRIMOIRE_BRIDGE, useValue: bridge }],
  });
  const fixture = TestBed.createComponent(App);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('App', () => {
  it('shows the background service once it answers', async () => {
    const el = await render(fakeBridge());
    const status = el.querySelector('[data-service-state]')!;
    expect(status.getAttribute('data-service-state')).toBe('connected');
    expect(status.textContent).toContain('pid 4242');
    expect(status.textContent).toContain('up 1 min 5 s');
  });

  it('says why the service is unreachable', async () => {
    const el = await render(fakeBridge({ invoke: () => Promise.reject(new Error('pipe closed')) }));
    const status = el.querySelector('[data-service-state]')!;
    expect(status.getAttribute('data-service-state')).toBe('failed');
    expect(status.textContent).toContain('pipe closed');
  });

  it('draws window controls on Windows and wires them', async () => {
    const bridge = fakeBridge();
    const el = await render(bridge);
    el.querySelector<HTMLButtonElement>('[aria-label="Minimize window"]')!.click();
    el.querySelector<HTMLButtonElement>('[aria-label="Close window"]')!.click();
    expect(bridge.window.minimize).toHaveBeenCalledOnce();
    expect(bridge.window.close).toHaveBeenCalledOnce();
  });

  it('leaves the window controls to macOS', async () => {
    const el = await render(fakeBridge({ platform: 'mac' }));
    expect(el.querySelector('[aria-label="Close window"]')).toBeNull();
  });
});
