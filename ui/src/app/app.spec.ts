import { fakeBridge, render } from '../testing/app-harness';

describe('App', () => {
  it('marks the background service connected once it answers', async () => {
    const { el } = await render(fakeBridge().bridge);
    expect(el.getAttribute('data-service-state')).toBe('connected');
    expect(el.textContent).not.toContain('Background service unreachable');
  });

  it('says in the page footer when the service is unreachable', async () => {
    const { el } = await render(
      fakeBridge({ invoke: () => Promise.reject(new Error('pipe closed')) }).bridge,
    );
    expect(el.getAttribute('data-service-state')).toBe('failed');
    const alert = el.querySelector('gr-status-indicators .alert')!;
    expect(alert.textContent).toContain('Background service unreachable');
    expect(alert.getAttribute('title')).toBe('pipe closed');
  });
});
