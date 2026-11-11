import { EFFORTS, effortName } from './efforts';

describe('effortName', () => {
  it('names a level as the settings card does, with "effort" after it', () => {
    expect(effortName('xhigh')).toBe('Extra high effort');
    expect(EFFORTS.map(({ level }) => level)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('says Default effort when the level isn’t known', () => {
    expect(effortName(undefined)).toBe('Default effort');
  });
});
