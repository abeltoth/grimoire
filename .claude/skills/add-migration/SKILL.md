---
name: add-migration
description: Change a module's or the core's SQLite tables by appending a migration. Use when adding, altering or dropping a table or column, or moving stored data to a new shape.
argument-hint: "[owner]"
---

# Add a migration

Migrations are SQL strings in an array, one per version, run by `migrate(db, owner, migrations)`
(`service/src/storage/database.ts`). Each runs once, in its own transaction, and the owner's
version is kept in `schema_versions`. The owner is `$ARGUMENTS`: a module's `id`, or `core`.

1. Find the owner's array: a module's `MIGRATIONS` (`modules/<name>/service/migrations.ts`,
   passed as `migrations` in its `ServiceModule`), or `CORE_MIGRATIONS` in
   `service/src/storage/database.ts`.
2. Append one new string at the end. Never edit, reorder or remove an existing one: databases
   on other machines have already run it.
3. A migration may hold several statements separated by `;`. To reshape data, create the new
   table, copy with `INSERT ... SELECT`, drop the old one and rename, all in the same string.
4. Test it in the owner's `*.test.ts`: open `openDatabase(':memory:')`, run `migrate` to the
   version before yours with its `latest` argument, insert rows in the old shape, run `migrate`
   to the end, and assert on the new shape. Also check a fresh database migrates in one go.
5. Run `npm run check`.
