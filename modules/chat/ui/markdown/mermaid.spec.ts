import { draw } from './mermaid';

describe('draw', () => {
  it('throws when Mermaid can’t read the source', async () => {
    await expect(
      draw('this is not a diagram', { font: 'serif', size: '16px', dark: false }),
    ).rejects.toThrow();
  });
});
