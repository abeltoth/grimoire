import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { useFakeBridge } from '../../testing/app-testing';
import { ServiceStatus } from './service-status';

describe('ServiceStatus', () => {
  it('is connected once the service answers', async () => {
    useFakeBridge();
    const status = TestBed.inject(ServiceStatus);
    status.check();
    expect(status.state()).toBe('connecting');
    await TestBed.inject(ApplicationRef).whenStable();
    expect(status.state()).toBe('connected');
    expect(status.error()).toBeNull();
  });

  it('has failed, and says why, when the service doesn’t answer', async () => {
    const { answers } = useFakeBridge();
    answers['core.ping'] = () => Promise.reject(new Error('No service'));
    const status = TestBed.inject(ServiceStatus);
    status.check();
    await TestBed.inject(ApplicationRef).whenStable();
    expect(status.state()).toBe('failed');
    expect(status.error()).toBe('No service');
  });
});
