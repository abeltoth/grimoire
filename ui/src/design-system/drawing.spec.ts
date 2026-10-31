import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DesignSettings } from './design-settings';
import { Drawing } from './drawing';

@Component({
  imports: [Drawing],
  template: `<gr-drawing name="spine" /><gr-drawing name="thought" essential />`,
})
class Host {}

describe('Drawing', () => {
  it('paints the named drawing token', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const [spine, thought] = fixture.nativeElement.querySelectorAll('gr-drawing') as NodeListOf<HTMLElement>;
    expect(spine.style.maskImage).toBe('var(--gr-drawing-spine)');
    expect(spine.getAttribute('aria-hidden')).toBe('true');
    expect(spine.classList.contains('essential')).toBe(false);
    expect(thought.classList.contains('essential')).toBe(true);
  });
});

describe('DesignSettings', () => {
  it('marks the document when drawings are turned off and on', async () => {
    const settings = TestBed.inject(DesignSettings);
    TestBed.tick();
    expect(document.documentElement.dataset['drawings']).toBe('on');
    settings.drawings.set(false);
    TestBed.tick();
    expect(document.documentElement.dataset['drawings']).toBe('off');
  });
});
