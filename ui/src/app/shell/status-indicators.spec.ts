import { fakeBridge, render } from '../../testing/app-testing';

describe('status-indicators', () => {
  it('shows no indicators without a repository or a schedule', async () => {
    const { texts } = await render(fakeBridge().bridge);
    expect(texts('gr-status-indicators button')).toEqual([]);
  });
});
