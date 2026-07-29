import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { closeDb } from '../src/db/client.ts';
import { recordPromptHookEvent } from '../src/prompt-hook.ts';
import {
  promptsForBranch,
  promptsForSession,
} from '../src/prompt-tagger.ts';

const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
const contextScript = join(
  pluginRoot,
  'skills',
  'rudder',
  'scripts',
  'context.mjs'
);
const backupScript = join(
  pluginRoot,
  'skills',
  'rudder',
  'scripts',
  'backup-tests.mjs'
);
const dataScript = join(
  pluginRoot,
  'skills',
  'rudder',
  'scripts',
  'manage-data.mjs'
);
const updateScriptUrl = new URL(
  '../skills/rudder/scripts/update.mjs',
  import.meta.url
);

interface UpdateResult {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  shouldNotify: boolean;
  source: string;
}

interface UpdateModule {
  applyUpdate(host: 'codex' | 'claude-code'): Promise<{
    status: string;
    error?: string;
    previousVersion?: string;
    version?: string;
  }>;
  checkForUpdate(options?: { force?: boolean }): Promise<UpdateResult>;
  updatePlan(host: 'codex' | 'claude-code'): {
    commands: string[][];
    nextStep: string;
  };
}

let root: string;
let repo: string;
let stateRoot: string;
let originalRudderHome: string | undefined;

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
  }).trim();
}

function runData(...args: string[]): Record<string, unknown> {
  return JSON.parse(
    execFileSync(process.execPath, [dataScript, ...args], {
      encoding: 'utf8',
      env: { ...process.env, RUDDER_HOME: stateRoot },
    })
  ) as Record<string, unknown>;
}

async function loadUpdateModule(): Promise<UpdateModule> {
  return import(updateScriptUrl.href) as Promise<UpdateModule>;
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'rudder-skill-runtime-'));
  repo = join(root, 'repo');
  stateRoot = join(root, 'state');
  mkdirSync(repo);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Rudder Tests');
  git('config', 'user.email', 'tests@rudder.local');
  git('remote', 'add', 'origin', 'git@github.com:rudder-test/skill.git');
  writeFileSync(join(repo, 'fixture.txt'), 'fixture\n');
  git('add', 'fixture.txt');
  git('commit', '-m', 'fixture');

  originalRudderHome = process.env.RUDDER_HOME;
  process.env.RUDDER_HOME = stateRoot;
});

after(() => {
  closeDb();
  if (originalRudderHome === undefined) delete process.env.RUDDER_HOME;
  else process.env.RUDDER_HOME = originalRudderHome;
  rmSync(root, { recursive: true, force: true });
});

test('data controls do not permit disabling prompt capture', () => {
  const disabled = spawnSync(process.execPath, [dataScript, 'disable'], {
    encoding: 'utf8',
    env: { ...process.env, RUDDER_HOME: stateRoot },
  });
  assert.equal(disabled.status, 1);
  assert.match(disabled.stderr, /status\|delete/);
});

test('the skill helper returns branch changes and locally captured intent', () => {
  const originalCaptureDisabled = process.env.RUDDER_DISABLE_PROMPT_CAPTURE;
  mkdirSync(stateRoot, { recursive: true });
  writeFileSync(
    join(stateRoot, 'prompt-capture-disabled'),
    'legacy preference\n'
  );
  process.env.RUDDER_DISABLE_PROMPT_CAPTURE = '1';
  try {
    assert.notEqual(
      recordPromptHookEvent('codex', {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'skill-context',
        turn_id: 'skill-turn',
        prompt: 'Return cached data when the request times out.',
        cwd: repo,
      }),
      null
    );
  } finally {
    if (originalCaptureDisabled === undefined) {
      delete process.env.RUDDER_DISABLE_PROMPT_CAPTURE;
    } else {
      process.env.RUDDER_DISABLE_PROMPT_CAPTURE = originalCaptureDisabled;
    }
  }
  mkdirSync(join(repo, 'src'));
  mkdirSync(join(repo, 'test'));
  writeFileSync(join(repo, 'src', 'feature.ts'), 'export const feature = true;\n');
  writeFileSync(join(repo, 'test', 'feature.test.ts'), '/* pending */\n');

  closeDb();
  const context = JSON.parse(
    execFileSync(
      process.execPath,
      [contextScript, '--cwd', repo, '--base', 'HEAD'],
      {
        encoding: 'utf8',
        env: { ...process.env, RUDDER_HOME: stateRoot },
      }
    )
  ) as {
    branch: string;
    otherPaths: string[];
    testPaths: string[];
    prompts: Array<{
      source: string;
      sessionId: string;
      promptId: string;
      promptText: string;
    }>;
  };

  assert.equal(context.branch, 'main');
  assert.deepEqual(context.testPaths, ['test/feature.test.ts']);
  assert.ok(context.otherPaths.includes('src/feature.ts'));
  assert.deepEqual(
    {
      source: context.prompts[0]?.source,
      sessionId: context.prompts[0]?.sessionId,
      promptId: context.prompts[0]?.promptId,
    },
    {
      source: 'codex',
      sessionId: 'skill-context',
      promptId: 'skill-turn',
    }
  );
  assert.equal(
    context.prompts[0]?.promptText,
    'Return cached data when the request times out.'
  );
});

// codex/019faf66-7413-7a31-a0ea-b5fe1c9b66d6/019faf8b-5c9c-7962-b60a-19e540b127d5
test('caches the latest registry version while reminders continue', async () => {
  const updateStatePath = join(stateRoot, 'update-state.json');
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({ version: '0.1.4' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    rmSync(updateStatePath, { force: true });
    const { checkForUpdate } = await loadUpdateModule();

    const discovered = await checkForUpdate({ force: true });
    assert.equal(discovered.currentVersion, '0.1.3');
    assert.equal(discovered.latestVersion, '0.1.4');
    assert.equal(discovered.shouldNotify, true);
    assert.equal(discovered.source, 'registry');

    const cached = await checkForUpdate();
    assert.equal(cached.shouldNotify, true);
    assert.equal(cached.source, 'cache');
    assert.equal(fetchCount, 1);

    const state = JSON.parse(readFileSync(updateStatePath, 'utf8')) as {
      schemaVersion: number;
      lastCheckedAt: string;
      latestVersion: string;
    };
    assert.equal(state.schemaVersion, 1);
    assert.ok(Number.isFinite(Date.parse(state.lastCheckedAt)));
    assert.equal(state.latestVersion, '0.1.4');
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(updateStatePath, { force: true });
  }
});

// codex/019faf66-7413-7a31-a0ea-b5fe1c9b66d6/019faf95-d1bc-7911-a067-9e6580871b15
test('uses stale cache or skips the prompt when registry data is unavailable', async () => {
  const updateStatePath = join(stateRoot, 'update-state.json');
  const originalFetch = globalThis.fetch;

  try {
    mkdirSync(stateRoot, { recursive: true });
    writeFileSync(
      updateStatePath,
      JSON.stringify({
        schemaVersion: 1,
        lastCheckedAt: '2000-01-01T00:00:00.000Z',
        latestVersion: '0.1.4',
      })
    );
    globalThis.fetch = async () => {
      throw new Error('offline');
    };

    const { checkForUpdate } = await loadUpdateModule();
    const staleCache = await checkForUpdate({ force: true });

    assert.equal(staleCache.latestVersion, '0.1.4');
    assert.equal(staleCache.shouldNotify, true);
    assert.equal(staleCache.source, 'stale-cache');
    const stateAfterFailure = JSON.parse(
      readFileSync(updateStatePath, 'utf8')
    ) as {
      lastCheckedAt: string;
      latestVersion: string;
    };
    assert.equal(stateAfterFailure.lastCheckedAt, '2000-01-01T00:00:00.000Z');
    assert.equal(stateAfterFailure.latestVersion, '0.1.4');

    rmSync(updateStatePath, { force: true });
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ version: 'invalid' }), { status: 200 });

    const unavailable = await checkForUpdate({ force: true });

    assert.equal(unavailable.latestVersion, null);
    assert.equal(unavailable.shouldNotify, false);
    assert.equal(unavailable.source, 'unavailable');
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(updateStatePath, { force: true });
  }
});

// codex/019faf9a-f8c0-7d33-8f77-a17b27aa7a14/019fafac-79fa-7e03-9de5-78fcfeb51076
test('uses the default Rudder marketplace for an accepted update', async () => {
  const { updatePlan } = await loadUpdateModule();

  assert.deepEqual(updatePlan('codex').commands, [
    ['codex', 'plugin', 'marketplace', 'upgrade', 'rudder', '--json'],
    ['codex', 'plugin', 'add', 'rudder@rudder', '--json'],
  ]);
  assert.deepEqual(updatePlan('claude-code').commands, [
    ['claude', 'plugin', 'marketplace', 'update', 'rudder'],
    ['claude', 'plugin', 'update', 'rudder@rudder'],
  ]);
});

// codex/019faf66-7413-7a31-a0ea-b5fe1c9b66d6/019faf99-21d4-7f62-ba6f-48cd6cb249c8
test('exposes a JSON CLI contract with clear argument errors', () => {
  const runUpdateCli = (...args: string[]) =>
    spawnSync(process.execPath, [fileURLToPath(updateScriptUrl), ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        RUDDER_DISABLE_UPDATE_CHECK: '1',
        RUDDER_HOME: stateRoot,
      },
    });

  const checked = runUpdateCli('check');
  assert.equal(checked.status, 0);
  assert.equal(JSON.parse(checked.stdout).source, 'disabled');

  const planned = runUpdateCli('plan', '--host', 'codex');
  assert.equal(planned.status, 0);
  assert.deepEqual(JSON.parse(planned.stdout).commands, [
    ['codex', 'plugin', 'marketplace', 'upgrade', 'rudder', '--json'],
    ['codex', 'plugin', 'add', 'rudder@rudder', '--json'],
  ]);

  const applied = runUpdateCli('apply', '--host', 'codex');
  assert.equal(applied.status, 0);
  assert.equal(JSON.parse(applied.stdout).status, 'current');

  const incomplete = runUpdateCli('plan', '--host');
  assert.equal(incomplete.status, 1);
  assert.match(incomplete.stderr, /--host requires a value/);

  const unsupportedHost = runUpdateCli('plan', '--host', 'other');
  assert.equal(unsupportedHost.status, 1);
  assert.match(unsupportedHost.stderr, /host must be codex or claude-code/);

  const unsupported = runUpdateCli('unsupported');
  assert.equal(unsupported.status, 1);
  assert.match(unsupported.stderr, /usage: update\.mjs/);
});

// codex/019faf66-7413-7a31-a0ea-b5fe1c9b66d6/019faf90-8df6-7223-aa9f-33012b8f26cb
test('retries a failed update twice without blocking the flow', async () => {
  const updateStatePath = join(stateRoot, 'update-state.json');
  const commandLog = join(root, 'update-commands.log');
  const fakeBin = join(root, 'update-bin');
  const executable = join(fakeBin, 'codex');
  const originalFetch = globalThis.fetch;
  const originalPath = process.env.PATH;
  const originalLog = process.env.RUDDER_TEST_COMMAND_LOG;
  const originalFailure = process.env.RUDDER_TEST_UPDATE_FAILURE;

  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(
    executable,
    [
      '#!/bin/sh',
      'printf \'%s\\n\' "$*" >> "$RUDDER_TEST_COMMAND_LOG"',
      'if [ "$RUDDER_TEST_UPDATE_FAILURE" = "1" ]; then',
      '  echo "simulated plugin failure" >&2',
      '  exit 7',
      'fi',
      '',
    ].join('\n')
  );
  chmodSync(executable, 0o755);
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ version: '0.1.4' }), { status: 200 });
  process.env.PATH = `${fakeBin}:${originalPath ?? ''}`;
  process.env.RUDDER_TEST_COMMAND_LOG = commandLog;

  try {
    rmSync(updateStatePath, { force: true });
    const { applyUpdate } = await loadUpdateModule();

    const updated = await applyUpdate('codex');
    assert.equal(updated.status, 'updated');
    assert.deepEqual(readFileSync(commandLog, 'utf8').trim().split('\n'), [
      'plugin marketplace upgrade rudder --json',
      'plugin add rudder@rudder --json',
    ]);

    writeFileSync(commandLog, '');
    process.env.RUDDER_TEST_UPDATE_FAILURE = '1';
    const failed = await applyUpdate('codex');

    assert.equal(failed.status, 'failed');
    assert.match(failed.error ?? '', /simulated plugin failure/);
    assert.deepEqual(readFileSync(commandLog, 'utf8').trim().split('\n'), [
      'plugin marketplace upgrade rudder --json',
      'plugin marketplace upgrade rudder --json',
      'plugin marketplace upgrade rudder --json',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalLog === undefined) delete process.env.RUDDER_TEST_COMMAND_LOG;
    else process.env.RUDDER_TEST_COMMAND_LOG = originalLog;
    if (originalFailure === undefined) {
      delete process.env.RUDDER_TEST_UPDATE_FAILURE;
    } else {
      process.env.RUDDER_TEST_UPDATE_FAILURE = originalFailure;
    }
    rmSync(updateStatePath, { force: true });
  }
});

test('the skill helper backs up only explicit test paths', () => {
  const backup = JSON.parse(
    execFileSync(
      process.execPath,
      [
        backupScript,
        '--cwd',
        repo,
        '--base',
        'HEAD',
        '--path',
        'test/feature.test.ts',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, RUDDER_HOME: stateRoot },
      }
    )
  ) as {
    patchPath: string;
    metadataPath: string;
    copiedUntrackedPaths: string[];
  };

  assert.ok(existsSync(backup.patchPath));
  assert.ok(existsSync(backup.metadataPath));
  assert.deepEqual(backup.copiedUntrackedPaths, ['test/feature.test.ts']);
  assert.equal(
    readFileSync(
      join(
        backup.metadataPath,
        '..',
        'untracked',
        'test',
        'feature.test.ts'
      ),
      'utf8'
    ),
    '/* pending */\n'
  );
});

test('data controls require confirmation and delete only prompt records', () => {
  assert.equal(runData('status').promptCount, 1);

  const unconfirmed = spawnSync(
    process.execPath,
    [dataScript, 'delete'],
    {
      encoding: 'utf8',
      env: { ...process.env, RUDDER_HOME: stateRoot },
    }
  );
  assert.equal(unconfirmed.status, 1);
  assert.match(unconfirmed.stderr, /requires --confirm/);
  assert.equal(runData('status').promptCount, 1);

  const deleted = runData('delete', '--confirm');
  assert.equal(deleted.deletedPromptCount, 1);
  assert.equal(deleted.promptCount, 0);
  assert.deepEqual(
    promptsForBranch('github.com/rudder-test/skill', 'main'),
    []
  );

});
