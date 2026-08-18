import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { closeDb, openDb } from '../src/db/client.ts';

const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
const localSpecScript = join(
  pluginRoot,
  'skills',
  'rudder',
  'scripts',
  'local-spec.mjs'
);
const contextScript = join(
  pluginRoot,
  'skills',
  'rudder',
  'scripts',
  'context.mjs'
);

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
  }).trim();
}

function createRepository(root: string): string {
  const repo = join(root, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Rudder Tests');
  git(repo, 'config', 'user.email', 'tests@rudder.local');
  git(repo, 'remote', 'add', 'origin', 'git@github.com:rudder-test/local-spec.git');
  writeFileSync(join(repo, 'fixture.txt'), 'fixture\n');
  git(repo, 'add', 'fixture.txt');
  git(repo, 'commit', '-m', 'fixture');
  return repo;
}

function migrateState(stateRoot: string): void {
  const original = process.env.RUDDER_HOME;
  closeDb();
  process.env.RUDDER_HOME = stateRoot;
  try {
    openDb();
  } finally {
    closeDb();
    if (original === undefined) delete process.env.RUDDER_HOME;
    else process.env.RUDDER_HOME = original;
  }
}

function runLocalSpec(
  repo: string,
  stateRoot: string,
  args: string[],
  environment: NodeJS.ProcessEnv = {}
) {
  return spawnSync(process.execPath, [localSpecScript, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      DO_NOT_TRACK: '1',
      RUDDER_HOME: stateRoot,
      ...environment,
    },
  });
}

async function telemetryReceiver(): Promise<{
  bodies: string[];
  host: string;
  stop: () => Promise<void>;
}> {
  const bodies: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      const decoded =
        request.headers['content-encoding'] === 'gzip'
          ? gunzipSync(body)
          : body;
      bodies.push(decoded.toString('utf8'));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    bodies,
    host: `http://127.0.0.1:${address.port}`,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for telemetry');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// rudder-spec: REQ-003
test('imports and refreshes a repository spec without modifying its source', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rudder-local-spec-'));
  const stateRoot = join(root, 'state');
  const receiver = await telemetryReceiver();
  try {
    const repo = createRepository(root);
    migrateState(stateRoot);
    mkdirSync(join(repo, 'specs'));
    mkdirSync(join(repo, 'src'));
    mkdirSync(join(repo, 'test', 'fixtures'), { recursive: true });
    mkdirSync(join(repo, 'openapi'));
    mkdirSync(join(repo, 'api'));
    const sourcePath = join(repo, 'specs', 'feature.spec.md');
    writeFileSync(sourcePath, '# Imported spec\n');
    writeFileSync(join(repo, 'specs', 'feature.spec.ts'), 'test("feature", () => {});\n');
    writeFileSync(join(repo, 'src', 'feature.ts'), 'export const feature = true;\n');
    writeFileSync(join(repo, 'test', 'fixtures', 'expected.md'), '# Expected fixture\n');
    writeFileSync(join(repo, 'openapi', 'feature.yaml'), 'openapi: 3.1.0\n');
    writeFileSync(join(repo, 'openapi.yaml'), 'openapi: 3.1.0\n');
    writeFileSync(join(repo, 'api', 'openapi.yaml'), 'openapi: 3.1.0\n');
    writeFileSync(join(repo, 'asyncapi.yml'), 'asyncapi: 3.0.0\n');
    const initialStatus = git(repo, 'status', '--short');

    const created = runLocalSpec(
      repo,
      stateRoot,
      [
        'create',
        '--cwd',
        repo,
        '--run-id',
        'local-spec-run',
        '--source',
        'specs/feature.spec.md',
      ],
      {
        DO_NOT_TRACK: '',
        POSTHOG_HOST: receiver.host,
        POSTHOG_PROJECT_TOKEN: 'test-project-token',
      }
    );
    assert.equal(created.status, 0, created.stderr);
    const result = JSON.parse(created.stdout) as {
      created: boolean;
      localSpec: {
        branch: string;
        repository: string;
        sourceRelativePath: string | null;
        specPath: string;
      };
    };
    assert.equal(result.created, true);
    assert.equal(result.localSpec.branch, 'main');
    assert.equal(result.localSpec.repository, 'github.com/rudder-test/local-spec');
    assert.equal(result.localSpec.sourceRelativePath, 'specs/feature.spec.md');
    assert.ok(
      result.localSpec.specPath.startsWith(realpathSync(join(stateRoot, 'specs')))
    );
    assert.equal(readFileSync(result.localSpec.specPath, 'utf8'), '# Imported spec\n');
    assert.equal(readFileSync(sourcePath, 'utf8'), '# Imported spec\n');
    assert.equal(git(repo, 'status', '--short'), initialStatus);
    if (process.platform !== 'win32') {
      assert.equal(statSync(join(stateRoot, 'specs')).mode & 0o777, 0o700);
      assert.equal(statSync(result.localSpec.specPath).mode & 0o777, 0o600);
    }

    await waitFor(() =>
      receiver.bodies.some((body) => body.includes('rudder spec created'))
    );
    const telemetry = receiver.bodies.join('\n');
    assert.equal(telemetry.match(/rudder spec created/gu)?.length, 1);
    assert.doesNotMatch(telemetry, /Imported spec|feature\.spec\.md/);
    assert.equal(telemetry.includes(repo), false);
    assert.equal(telemetry.includes(result.localSpec.specPath), false);

    const duplicate = runLocalSpec(repo, stateRoot, [
      'create',
      '--cwd',
      repo,
      '--run-id',
      'duplicate-run',
      '--source',
      'specs/feature.spec.md',
    ]);
    assert.equal(duplicate.status, 1);
    assert.match(duplicate.stderr, /already exists/);

    const context = JSON.parse(
      execFileSync(
        process.execPath,
        [contextScript, '--cwd', repo, '--base', 'HEAD', '--phase', 'start'],
        {
          encoding: 'utf8',
          env: { ...process.env, DO_NOT_TRACK: '1', RUDDER_HOME: stateRoot },
        }
      )
    ) as {
      localSpec: typeof result.localSpec;
      productionCandidatePaths: string[];
      schemaVersion: number;
      specCandidatePaths: string[];
      testPaths: string[];
    };
    assert.equal(context.schemaVersion, 2);
    assert.deepEqual(context.localSpec, result.localSpec);
    assert.deepEqual(context.specCandidatePaths, [
      'api/openapi.yaml',
      'asyncapi.yml',
      'openapi.yaml',
      'openapi/feature.yaml',
      'specs/feature.spec.md',
      'test/fixtures/expected.md',
    ]);
    assert.deepEqual(context.testPaths, [
      'specs/feature.spec.md',
      'specs/feature.spec.ts',
      'test/fixtures/expected.md',
    ]);
    assert.deepEqual(context.productionCandidatePaths, [
      'api/openapi.yaml',
      'asyncapi.yml',
      'openapi.yaml',
      'openapi/feature.yaml',
      'src/feature.ts',
    ]);

    writeFileSync(sourcePath, '# Refreshed repository spec\n');
    const changedSourceStatus = git(repo, 'status', '--short');
    const replaced = runLocalSpec(repo, stateRoot, [
      'replace-source',
      '--cwd',
      repo,
    ]);
    assert.equal(replaced.status, 0, replaced.stderr);
    assert.equal(
      readFileSync(result.localSpec.specPath, 'utf8'),
      '# Refreshed repository spec\n'
    );
    assert.equal(readFileSync(sourcePath, 'utf8'), '# Refreshed repository spec\n');
    assert.equal(git(repo, 'status', '--short'), changedSourceStatus);

    writeFileSync(result.localSpec.specPath, '# User-edited local spec\n');
    assert.equal(readFileSync(sourcePath, 'utf8'), '# Refreshed repository spec\n');
    assert.equal(receiver.bodies.join('\n').match(/rudder spec created/gu)?.length, 1);

    rmSync(result.localSpec.specPath);
    const missing = runLocalSpec(repo, stateRoot, [
      'replace-source',
      '--cwd',
      repo,
    ]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /database-linked local Rudder spec is missing/);

    const database = new DatabaseSync(join(stateRoot, 'rudder.db'));
    try {
      database
        .prepare(
          `UPDATE specs
              SET spec_path = ?
            WHERE repository = ? AND branch = ?`
        )
        .run(sourcePath, result.localSpec.repository, result.localSpec.branch);
    } finally {
      database.close();
    }
    const unsafeStoredPath = runLocalSpec(repo, stateRoot, [
      'replace-source',
      '--cwd',
      repo,
    ]);
    assert.equal(unsafeStoredPath.status, 1);
    assert.match(unsafeStoredPath.stderr, /not valid local Rudder state/);
  } finally {
    await receiver.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

// rudder-spec: REQ-002
test('creates generated specs locally and refuses repository-local state', () => {
  const root = mkdtempSync(join(tmpdir(), 'rudder-generated-spec-'));
  try {
    const repo = createRepository(root);
    const stateRoot = join(root, 'state');
    const inputPath = join(root, 'generated.md');
    writeFileSync(inputPath, '# Generated spec\n');
    migrateState(stateRoot);

    const created = runLocalSpec(repo, stateRoot, [
      'create',
      '--cwd',
      repo,
      '--run-id',
      'generated-run',
      '--input',
      inputPath,
    ]);
    assert.equal(created.status, 0, created.stderr);
    const result = JSON.parse(created.stdout) as {
      localSpec: { sourceRelativePath: null; specPath: string };
    };
    assert.equal(result.localSpec.sourceRelativePath, null);
    assert.equal(readFileSync(result.localSpec.specPath, 'utf8'), '# Generated spec\n');

    const noSource = runLocalSpec(repo, stateRoot, [
      'replace-source',
      '--cwd',
      repo,
    ]);
    assert.equal(noSource.status, 1);
    assert.match(noSource.stderr, /has no repository source/);

    const nestedState = join(repo, '.rudder');
    migrateState(nestedState);
    const rejected = runLocalSpec(repo, nestedState, [
      'create',
      '--cwd',
      repo,
      '--run-id',
      'rejected-run',
      '--input',
      inputPath,
    ]);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /must be stored outside the repository/);
    assert.equal(existsSync(join(nestedState, 'specs')), false);
    const nestedDatabase = new DatabaseSync(join(nestedState, 'rudder.db'), {
      readOnly: true,
    });
    try {
      assert.equal(
        (nestedDatabase.prepare('SELECT count(*) AS count FROM specs').get() as {
          count: number;
        }).count,
        0
      );
    } finally {
      nestedDatabase.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// rudder-spec: REQ-002
test('rejects uninitialized state and invalid helper inputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'rudder-spec-validation-'));
  try {
    const repo = createRepository(root);
    const inputPath = join(root, 'generated.md');
    writeFileSync(inputPath, '# Generated spec\n');
    const missingState = join(root, 'missing-state');
    const noDatabase = runLocalSpec(repo, missingState, [
      'create',
      '--cwd',
      repo,
      '--run-id',
      'missing-database',
      '--input',
      inputPath,
    ]);
    assert.equal(noDatabase.status, 1);
    assert.match(noDatabase.stderr, /database is not initialized/);

    const contextWithoutDatabase = spawnSync(
      process.execPath,
      [contextScript, '--cwd', repo, '--base', 'HEAD', '--phase', 'start'],
      {
        cwd: repo,
        encoding: 'utf8',
        env: {
          ...process.env,
          DO_NOT_TRACK: '1',
          RUDDER_HOME: missingState,
        },
      }
    );
    assert.equal(contextWithoutDatabase.status, 0, contextWithoutDatabase.stderr);
    assert.equal(JSON.parse(contextWithoutDatabase.stdout).localSpec, null);

    const unmigratedState = join(root, 'unmigrated-state');
    mkdirSync(unmigratedState);
    new DatabaseSync(join(unmigratedState, 'rudder.db')).close();
    const noMigration = runLocalSpec(repo, unmigratedState, [
      'create',
      '--cwd',
      repo,
      '--run-id',
      'missing-migration',
      '--input',
      inputPath,
    ]);
    assert.equal(noMigration.status, 1);
    assert.match(noMigration.stderr, /migration has not been applied/);

    const stateRoot = join(root, 'state');
    migrateState(stateRoot);
    for (const fixture of [
      {
        args: [
          'create',
          '--cwd',
          repo,
          '--run-id',
          'missing-value',
          '--input',
        ],
        expected: /--input requires a value/,
      },
      {
        args: [
          'create',
          '--cwd',
          repo,
          '--run-id',
          'two-inputs',
          '--source',
          'fixture.txt',
          '--input',
          inputPath,
        ],
        expected: /exactly one of --source or --input/,
      },
      {
        args: [
          'create',
          '--cwd',
          repo,
          '--run-id',
          'absolute-source',
          '--source',
          inputPath,
        ],
        expected: /--source must be repository-relative/,
      },
      {
        args: [
          'create',
          '--cwd',
          repo,
          '--run-id',
          'directory-source',
          '--source',
          '.',
        ],
        expected: /--source must identify a file inside the repository/,
      },
      {
        args: [
          'create',
          '--cwd',
          repo,
          '--run-id',
          'directory-input',
          '--input',
          root,
        ],
        expected: /--input must identify a file/,
      },
      {
        args: ['unsupported-command'],
        expected: /usage: local-spec\.mjs/,
      },
    ]) {
      const result = runLocalSpec(repo, stateRoot, fixture.args);
      assert.equal(result.status, 1);
      assert.match(result.stderr, fixture.expected);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
