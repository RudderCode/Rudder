import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { closeDb, openDb } from '../src/db/client.ts';

let root: string;
let originalRudderHome: string | undefined;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'rudder-migrations-'));
  originalRudderHome = process.env.RUDDER_HOME;
  process.env.RUDDER_HOME = join(root, 'state');
});

after(() => {
  closeDb();
  if (originalRudderHome === undefined) delete process.env.RUDDER_HOME;
  else process.env.RUDDER_HOME = originalRudderHome;
  rmSync(root, { recursive: true, force: true });
});

// rudder-spec: REQ-001
test('applies the minimal specs migration to a new database', () => {
  const db = openDb();
  const tableNames = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('prompt_branches', 'session_branches', 'specs') ORDER BY name"
    )
    .all()
    .map((row) => (row as { name: string }).name);

  assert.deepEqual(tableNames, ['prompt_branches', 'specs']);
  assert.deepEqual(
    db
      .prepare('PRAGMA table_info(prompt_branches)')
      .all()
      .filter((row) => (row as { name: string }).name === 'previous_agent_output')
      .map((row) => ({
        name: (row as { name: string }).name,
        notnull: (row as { notnull: number }).notnull,
      })),
    [{ name: 'previous_agent_output', notnull: 0 }]
  );
  assert.deepEqual(
    db
      .prepare('PRAGMA table_info(specs)')
      .all()
      .map((row) => ({
        name: (row as { name: string }).name,
        notnull: (row as { notnull: number }).notnull,
        pk: (row as { pk: number }).pk,
      })),
    [
      { name: 'repository', notnull: 1, pk: 1 },
      { name: 'branch', notnull: 1, pk: 2 },
      { name: 'spec_path', notnull: 1, pk: 0 },
      { name: 'source_relative_path', notnull: 0, pk: 0 },
    ]
  );
  db.prepare(
    `INSERT INTO specs (repository, branch, spec_path, source_relative_path)
     VALUES (?, ?, ?, ?)`
  ).run('github.com/rudder-test/specs', 'main', '/tmp/spec.md', null);
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO specs (repository, branch, spec_path, source_relative_path)
           VALUES (?, ?, ?, ?)`
        )
        .run(
          'github.com/rudder-test/specs',
          'main',
          '/tmp/other.md',
          'requirements.md'
        ),
    /UNIQUE constraint failed/
  );
  assert.equal(
    (
      db.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get() as { count: number }
    ).count,
    4
  );
});
