import { planFoot } from './plan-foot';

describe('planFoot', () => {
  it('counts the steps done, and says nothing without a plan', () => {
    expect(
      planFoot([
        { text: 'Read', status: 'done' },
        { text: 'Write', status: 'active' },
        { text: 'Test', status: 'pending' },
      ]),
    ).toBe('1 of 3 done');
    expect(planFoot([])).toBe('');
  });
});
