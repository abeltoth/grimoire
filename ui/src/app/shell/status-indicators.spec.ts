import { fakeBridge, render } from '../../testing/app-harness';

describe('status-indicators', () => {
  it('shows no indicators or badges without a repository or a schedule', async () => {
    const { texts } = await render(fakeBridge().bridge);
    expect(texts('gr-status-indicators button')).toEqual([]);
    expect(texts('gr-header-badges button')).toEqual([]);
  });
});
