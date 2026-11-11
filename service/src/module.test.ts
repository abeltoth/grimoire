import { describe, expect, it, vi } from 'vitest';
import { type ModuleContext, Modules, type ServiceModule } from './module';
import { openDatabase } from './storage/database';

describe('Modules', () => {
  it('migrates each module’s tables before starting it, in the order listed', () => {
    const db = openDatabase(':memory:');
    const started: string[] = [];
    const module = (id: string): ServiceModule => ({
      id,
      migrations: [`CREATE TABLE ${id}_things (x TEXT)`],
      start: (context) => {
        context.db.prepare(`INSERT INTO ${id}_things (x) VALUES ('started')`).run();
        started.push(id);
      },
    });
    new Modules([module('a'), module('b')]).start({ db } as ModuleContext);
    expect(started).toEqual(['a', 'b']);
    expect(db.prepare('SELECT x FROM b_things').all()).toEqual([{ x: 'started' }]);
  });

  it('passes each step of the service on to the modules that take it', () => {
    const db = openDatabase(':memory:');
    const hooks = {
      ready: vi.fn(),
      profileSwitched: vi.fn(),
      profileRemoved: vi.fn(),
      stop: vi.fn(),
    };
    const modules = new Modules([
      { id: 'a', start: () => hooks },
      { id: 'b', start: () => {} },
    ]);
    modules.start({ db } as ModuleContext);
    modules.ready();
    modules.profileSwitched();
    modules.profileRemoved('work');
    modules.stop();
    expect(hooks.ready).toHaveBeenCalledOnce();
    expect(hooks.profileSwitched).toHaveBeenCalledOnce();
    expect(hooks.profileRemoved).toHaveBeenCalledWith('work');
    expect(hooks.stop).toHaveBeenCalledOnce();
  });
});
