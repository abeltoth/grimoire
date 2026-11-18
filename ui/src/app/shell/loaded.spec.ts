import { ApplicationRef, Component, PendingTasks } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { loaded } from './loaded';

@Component({ template: '' })
class Ledger {}

describe('loaded', () => {
  it('imports a component once, the app busy until it has', async () => {
    const tasks = TestBed.inject(PendingTasks);
    const load = vi.fn(async () => Ledger);
    const component = loaded(load, tasks);
    expect(component()).toBeUndefined();
    expect(loaded(load, tasks)).toBe(component);
    await TestBed.inject(ApplicationRef).whenStable();
    expect(component()).toBe(Ledger);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('is nothing without a loader', () => {
    expect(loaded(undefined, TestBed.inject(PendingTasks))()).toBeUndefined();
  });
});
