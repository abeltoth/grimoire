import { describe, expect, it } from 'vitest';
import { ServiceEvents } from './events';

describe('ServiceEvents', () => {
  it('tells an event to what listens for it in the service, and to the windows once they can hear', () => {
    const events = new ServiceEvents();
    const heard: unknown[] = [];
    const windows: unknown[] = [];
    events.on('agents.title', (payload) => heard.push(payload));
    events.emit('agents.title', { chatId: 'a', title: 'First' });
    events.toWindows((event, payload) => windows.push([event, payload]));
    events.emit('agents.title', { chatId: 'a', title: 'Second' });
    events.emit('agents.turnEnded', { chatId: 'a' });
    expect(heard).toEqual([
      { chatId: 'a', title: 'First' },
      { chatId: 'a', title: 'Second' },
    ]);
    expect(windows).toEqual([
      ['agents.title', { chatId: 'a', title: 'Second' }],
      ['agents.turnEnded', { chatId: 'a' }],
    ]);
  });
});
