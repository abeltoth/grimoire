import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ProfileStore } from '../core/profiles';
import { migrate, openDatabase } from './database';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('database', () => {
  it("migrates each owner's tables on its own, from the version it's at", () => {
    const db = openDatabase(':memory:');
    const first = ['CREATE TABLE a (x TEXT)'];
    migrate(db, 'one', first);
    migrate(db, 'one', [...first, 'ALTER TABLE a ADD COLUMN y TEXT']);
    migrate(db, 'two', ['CREATE TABLE b (x TEXT)']);
    expect(db.prepare('SELECT owner, version FROM schema_versions ORDER BY owner').all()).toEqual([
      { owner: 'core', version: 3 },
      { owner: 'one', version: 2 },
      { owner: 'two', version: 1 },
    ]);
    db.exec("INSERT INTO a (x, y) VALUES ('1', '2')");
  });

  it('leaves an owner at its last good version when a migration fails', () => {
    const db = openDatabase(':memory:');
    expect(() =>
      migrate(db, 'one', ['CREATE TABLE a (x TEXT)', 'CREATE TABLE a (x TEXT)']),
    ).toThrow();
    expect(db.prepare("SELECT version FROM schema_versions WHERE owner = 'one'").get()).toEqual({
      version: 1,
    });
  });

  it('starts a database versioned as one whole again, empty', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'grimoire-db-'));
    dirs.push(dir);
    const file = path.join(dir, 'grimoire.db');
    const old = new DatabaseSync(file);
    old.exec(
      "CREATE TABLE chapters (chat_id TEXT); INSERT INTO chapters VALUES ('a'); PRAGMA user_version = 22",
    );
    old.close();

    const db = openDatabase(file);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[];
    expect(tables.map((table) => table.name)).not.toContain('chapters');
    expect(new ProfileStore(db, () => dir).list().active).toBe('personal');
    db.close();
  });
});
