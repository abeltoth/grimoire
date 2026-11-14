import { describe, expect, it, vi } from 'vitest';
import { ContextMeter } from './context-meter';

const window = { rawMaxTokens: 200_000, autoCompactThreshold: 167_000, isAutoCompactEnabled: true };

describe('ContextMeter', () => {
  it('shows each reply once the window is measured, with where it compacts', () => {
    const report = vi.fn();
    const meter = new ContextMeter(report);
    meter.reply(30_000);
    expect(report).not.toHaveBeenCalled();
    meter.measured({ totalTokens: 30_000, ...window }, meter.asking());
    meter.reply(42_000);
    meter.reply(42_000);
    expect(report.mock.calls).toEqual([
      [{ used: 30_000, limit: 200_000, compactsAt: 167_000 }],
      [{ used: 42_000, limit: 200_000, compactsAt: 167_000 }],
    ]);
  });

  it('leaves out where it compacts when the agent never does', () => {
    const report = vi.fn();
    new ContextMeter(report).measured(
      { totalTokens: 9_000, ...window, isAutoCompactEnabled: false },
      0,
    );
    expect(report).toHaveBeenCalledWith({ used: 9_000, limit: 200_000 });
  });

  it('names the model whose window it measured', () => {
    const report = vi.fn();
    new ContextMeter(report).measured(
      { totalTokens: 9_000, ...window, model: 'claude-opus-5-5' },
      0,
    );
    expect(report).toHaveBeenCalledWith({
      used: 9_000,
      limit: 200_000,
      compactsAt: 167_000,
      model: 'claude-opus-5-5',
    });
  });

  it("keeps a reply's count over a measure asked for before it", () => {
    const report = vi.fn();
    const meter = new ContextMeter(report);
    meter.measured({ totalTokens: 10_000, ...window }, meter.asking());
    const asked = meter.asking();
    meter.reply(50_000);
    meter.measured({ totalTokens: 10_000, ...window, rawMaxTokens: 1_000_000 }, asked);
    expect(report).toHaveBeenLastCalledWith({
      used: 50_000,
      limit: 1_000_000,
      compactsAt: 167_000,
    });
  });

  it("shows what a compaction left, when it says, and waits for the measure when it doesn't", () => {
    const report = vi.fn();
    const meter = new ContextMeter(report);
    meter.measured({ totalTokens: 150_000, ...window }, meter.asking());
    meter.compacted(20_000);
    expect(report).toHaveBeenLastCalledWith({ used: 20_000, limit: 200_000, compactsAt: 167_000 });
    meter.compacted(undefined);
    expect(report).toHaveBeenCalledTimes(2);
    meter.measured({ totalTokens: 18_000, ...window }, meter.asking());
    expect(report).toHaveBeenLastCalledWith({ used: 18_000, limit: 200_000, compactsAt: 167_000 });
  });
});
