import type { ServiceModule } from '@grimoire/service/core/module';
import { addNoteTool } from './add-note';
import { MIGRATIONS } from './migrations';
import { Reminders } from './reminders';
import { NoteStore } from './store';

/** Notes: short loose thoughts, each with an optional one-off reminder shown in the app. */
export const notes: ServiceModule = {
  id: 'notes',
  migrations: MIGRATIONS,
  start({ registry, db, events, registerTool }) {
    const store = new NoteStore(db);
    const reminders = new Reminders(store, events.emit);
    registry.register('notes.list', () => store.list());
    registry.register('notes.save', (draft) => reminders.changed(store.save(draft)));
    registry.register('notes.done', ({ id, done }) => reminders.changed(store.done(id, done)));
    registry.register('notes.remove', ({ id }) => reminders.changed(store.remove(id)));
    // A note the agent saves goes in the notes in use, which every window is told of.
    registerTool(addNoteTool((draft, madeIn) => reminders.changed(store.save(draft, madeIn))));
    let stopChecking: (() => void) | undefined;
    return {
      // Checked twice a minute, which also notices a time that passed while the computer slept.
      ready: () => (stopChecking = reminders.checkEvery(30_000)),
      profileSwitched: () => reminders.changed(),
      profileRemoved: (id) => store.removeProfile(id),
      stop: () => stopChecking?.(),
    };
  },
};
