import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { UsageBreakdown } from '@grimoire/contract';
import { useFakeBridge } from '@ui/testing/app-testing';
import { ScanReadings } from './scan-readings';

const span = { requests: 1, chats: 1, behaviours: [], advice: [], sources: [] };

describe('ScanReadings', () => {
  function setUp() {
    const fake = useFakeBridge();
    fake.answers['usage.breakdown'] = (): UsageBreakdown => ({ day: span, week: span, at: 5 });
    TestBed.configureTestingModule({ providers: [ScanReadings] });
    const stable = () => TestBed.inject(ApplicationRef).whenStable();
    return { ...fake, scans: TestBed.inject(ScanReadings), stable };
  }

  it("reads the agents' scans once the agents are known, and again when asked", async () => {
    const { scans, calls, stable } = setUp();
    expect(scans.of('claude-code')).toBeUndefined();
    await stable();
    expect(scans.of('claude-code')!.at).toBe(5);
    expect(scans.of('codex')).toBeNull();
    await scans.read();
    expect(calls.filter((c) => c.command === 'usage.breakdown')).toHaveLength(2);
  });

  it('keeps what went wrong', async () => {
    const { scans, answers, stable } = setUp();
    answers['usage.breakdown'] = () => {
      throw new Error('No answer');
    };
    await stable();
    expect(scans.failed()).toBe('No answer');
  });
});
