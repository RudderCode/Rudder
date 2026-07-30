import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { closeDb } from '../src/db/client.ts';
import {
  normalizePromptHookPayload,
  recordPromptHookEvent,
} from '../src/prompt-hook.ts';
import { promptsForSession } from '../src/prompt-tagger.ts';

let root: string;
let repo: string;
let originalRudderHome: string | undefined;

const hookExecutable = fileURLToPath(new URL('../bin/rudder-prompt-hook.ts', import.meta.url));
const pluginRoot = fileURLToPath(new URL('../', import.meta.url));

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

async function startTelemetryReceiver(capturePath: string): Promise<{
  host: string;
  stop: () => Promise<void>;
}> {
  const receiver = spawn(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        import http from 'node:http';
        import { appendFileSync } from 'node:fs';
        import { gunzipSync } from 'node:zlib';

        const server = http.createServer(async (request, response) => {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          const body = Buffer.concat(chunks);
          const decoded =
            request.headers['content-encoding'] === 'gzip'
              ? gunzipSync(body)
              : body;
          appendFileSync(
            process.env.RUDDER_TELEMETRY_CAPTURE_PATH,
            decoded.toString('utf8') + '\\n'
          );
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end('{}');
        });

        server.listen(0, '127.0.0.1', () => {
          console.log(server.address().port);
        });
        process.on('SIGTERM', () => server.close());
      `,
    ],
    {
      env: {
        ...process.env,
        RUDDER_TELEMETRY_CAPTURE_PATH: capturePath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  receiver.stdout.setEncoding('utf8');
  const [portOutput] = (await once(receiver.stdout, 'data')) as [string];

  return {
    host: `http://127.0.0.1:${portOutput.trim()}`,
    stop: async () => {
      receiver.kill('SIGTERM');
      await once(receiver, 'exit');
    },
  };
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'rudder-prompt-hook-'));
  repo = join(root, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Rudder Tests');
  git(repo, 'config', 'user.email', 'tests@rudder.local');
  git(repo, 'remote', 'add', 'origin', 'git@github.com:rudder-test/hooks.git');
  writeFileSync(join(repo, 'fixture.txt'), 'fixture\n');
  git(repo, 'add', 'fixture.txt');
  git(repo, 'commit', '-m', 'fixture');

  originalRudderHome = process.env.RUDDER_HOME;
  process.env.RUDDER_HOME = join(root, 'state');
});

after(() => {
  closeDb();
  if (originalRudderHome === undefined) delete process.env.RUDDER_HOME;
  else process.env.RUDDER_HOME = originalRudderHome;
  rmSync(root, { recursive: true, force: true });
});

test('normalizes the prompt key used by each supported agent', () => {
  const fixtures = [
    ['claude-code', 'prompt_id', 'UserPromptSubmit', 'claude-prompt'],
    ['codex', 'turn_id', 'UserPromptSubmit', 'codex-turn'],
    ['cursor', 'generation_id', 'beforeSubmitPrompt', 'cursor-generation'],
  ] as const;

  for (const [source, idField, hookEvent, id] of fixtures) {
    const transcriptPath = join(root, `${source}.jsonl`);
    const payload = normalizePromptHookPayload(source, {
      hook_event_name: hookEvent,
      session_id: `${source}-session`,
      [idField]: id,
      prompt: `Prompt from ${source}`,
      transcript_path: transcriptPath,
      cwd: repo,
    });

    assert.equal(payload.promptId, id);
    assert.equal(payload.transcriptPath, transcriptPath);
  }
});

test('stores the latest agent output before each supported agent prompt', () => {
  const fixtures = [
    {
      source: 'claude-code',
      idField: 'prompt_id',
      id: 'claude-context-prompt',
      hookEvent: 'UserPromptSubmit',
      entries: [
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Older Claude output.' }],
          },
        },
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'private reasoning' },
              { type: 'text', text: 'Latest Claude output.' },
            ],
          },
        },
      ],
      expected: 'Latest Claude output.',
    },
    {
      source: 'codex',
      idField: 'turn_id',
      id: 'codex-context-turn',
      hookEvent: 'UserPromptSubmit',
      entries: [
        {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Latest Codex output.' }],
          },
        },
      ],
      expected: 'Latest Codex output.',
    },
    {
      source: 'cursor',
      idField: 'generation_id',
      id: 'cursor-context-generation',
      hookEvent: 'beforeSubmitPrompt',
      entries: [
        {
          role: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Latest Cursor output.' },
              { type: 'tool_use', name: 'Read', input: {} },
            ],
          },
        },
      ],
      expected: 'Latest Cursor output.',
    },
  ] as const;

  for (const fixture of fixtures) {
    const transcriptPath = join(root, `${fixture.source}-context.jsonl`);
    writeFileSync(
      transcriptPath,
      [
        ...fixture.entries.map((entry) => JSON.stringify(entry)),
        '{"partially_written":',
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'Go ahead.' }],
          },
        }),
      ].join('\n')
    );

    const row = recordPromptHookEvent(fixture.source, {
      hook_event_name: fixture.hookEvent,
      session_id: `${fixture.source}-context-session`,
      [fixture.idField]: fixture.id,
      prompt: 'Go ahead.',
      transcript_path: transcriptPath,
      cwd: repo,
    });

    assert.equal(row?.previousAgentOutput, fixture.expected);
  }
});

test('stores a prompt on submit and reconciles it on stop', () => {
  recordPromptHookEvent('cursor', {
    hook_event_name: 'beforeSubmitPrompt',
    conversation_id: 'cursor-session',
    generation_id: 'cursor-generation',
    prompt: 'Create and switch to a feature branch.',
    workspace_roots: [repo],
    transcript_path: join(root, 'cursor.jsonl'),
  });

  git(repo, 'switch', '-c', 'feature/cursor-prompt');

  const row = recordPromptHookEvent('cursor', {
    hook_event_name: 'stop',
    conversation_id: 'cursor-session',
    generation_id: 'cursor-generation',
    workspace_roots: [repo],
    transcript_path: join(root, 'cursor.jsonl'),
  });

  assert.equal(row?.promptText, 'Create and switch to a feature branch.');
  assert.equal(row?.previousAgentOutput, null);
  assert.equal(row?.branch, 'feature/cursor-prompt');
  assert.ok(row?.reconciledAt);
});

test('the executable performs both phases without model-visible output', () => {
  closeDb();
  const env = { ...process.env, RUDDER_HOME: process.env.RUDDER_HOME };
  const stdout = execFileSync(
    process.execPath,
    [hookExecutable, '--source', 'codex'],
    {
      cwd: repo,
      encoding: 'utf8',
      env,
      input: JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        session_id: 'codex-session',
        turn_id: 'codex-turn',
        prompt: 'Switch to the CLI branch.',
        cwd: repo,
      }),
    }
  );
  assert.equal(stdout, '');

  git(repo, 'switch', '-c', 'feature/cli-prompt');
  execFileSync(process.execPath, [hookExecutable, '--source', 'codex'], {
    cwd: repo,
    encoding: 'utf8',
    env,
    input: JSON.stringify({
      hook_event_name: 'Stop',
      session_id: 'codex-session',
      turn_id: 'codex-turn',
      cwd: repo,
    }),
  });

  const storedPrompt = promptsForSession('codex', 'codex-session')[0];
  assert.equal(storedPrompt?.branch, 'feature/cli-prompt');
  assert.equal(storedPrompt?.previousAgentOutput, null);
});

// codex/019fb36f-4dfe-7c91-8674-5caaf68fcced/019fb386-4741-7860-89a9-97f3697fa4f1
test('the executable flushes metadata-only telemetry before exiting', async () => {
  closeDb();
  const capturePath = join(root, 'telemetry-capture.jsonl');
  const receiver = await startTelemetryReceiver(capturePath);

  try {
    const stdout = execFileSync(
      process.execPath,
      [hookExecutable, '--source', 'codex'],
      {
        cwd: repo,
        encoding: 'utf8',
        env: {
          ...process.env,
          DO_NOT_TRACK: '',
          POSTHOG_PROJECT_TOKEN: 'test-project-token',
          POSTHOG_HOST: receiver.host,
          RUDDER_HOME: process.env.RUDDER_HOME,
        },
        input: JSON.stringify({
          hook_event_name: 'UserPromptSubmit',
          session_id: 'telemetry-session',
          turn_id: 'telemetry-turn',
          prompt: 'This prompt must stay local.',
          cwd: repo,
        }),
      }
    );

    assert.equal(stdout, '');
    execFileSync(process.execPath, [hookExecutable, '--source', 'codex'], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        DO_NOT_TRACK: '',
        POSTHOG_PROJECT_TOKEN: 'test-project-token',
        POSTHOG_HOST: receiver.host,
        RUDDER_HOME: process.env.RUDDER_HOME,
      },
      input: JSON.stringify({
        hook_event_name: 'Stop',
        session_id: 'telemetry-session',
        turn_id: 'telemetry-turn',
        cwd: repo,
      }),
    });
    execFileSync(
      process.execPath,
      [hookExecutable, '--rudder-event', 'run-started'],
      {
        cwd: repo,
        encoding: 'utf8',
        env: {
          ...process.env,
          DO_NOT_TRACK: '',
          POSTHOG_PROJECT_TOKEN: 'test-project-token',
          POSTHOG_HOST: receiver.host,
          RUDDER_HOME: process.env.RUDDER_HOME,
        },
        input: JSON.stringify({
          host: 'codex',
          repository: 'github.com/private/RAW-REPOSITORY',
          branch: 'RAW-BRANCH',
          runId: 'RAW-RUN-ID',
          capturedPromptCount: 3,
          capturedSessionCount: 2,
          reconciledPromptCount: 2,
          promptSourceCounts: { codex: 2, 'claude-code': 1 },
          changedPathCount: 4,
          changedTestPathCount: 1,
          changedProductionPathCount: 3,
          untrackedPathCount: 1,
          testLineAdditionCount: 8,
          testLineDeletionCount: 2,
          inputTokens: 10,
          model: 'RAW-MODEL',
          toolUsage: { Read: 1 },
          costUsd: 0.25,
        }),
      }
    );

    const requestBodies = readFileSync(capturePath, 'utf8');
    assert.match(requestBodies, /"event":"rudder prompt captured"/);
    assert.match(requestBodies, /"event":"rudder prompt reconciled"/);
    assert.match(requestBodies, /"event":"rudder run started"/);
    assert.match(requestBodies, /"source":"codex"/);
    assert.match(requestBodies, /"has_previous_agent_output":false/);
    assert.match(requestBodies, /"telemetry_schema_version":1/);
    assert.match(requestBodies, /"repository_pseudonym":"[a-f0-9]{64}"/);
    assert.match(requestBodies, /"run_pseudonym":"[a-f0-9]{64}"/);
    assert.match(requestBodies, /"captured_prompt_count":3/);
    assert.match(requestBodies, /"captured_session_count":2/);
    assert.match(requestBodies, /"changed_test_path_count":1/);
    assert.match(requestBodies, /"test_lines_added_from_base":8/);
    assert.match(requestBodies, /"test_lines_deleted_from_base":2/);
    assert.doesNotMatch(requestBodies, /This prompt must stay local/);
    assert.doesNotMatch(requestBodies, /telemetry-session|telemetry-turn/);
    assert.doesNotMatch(
      requestBodies,
      /RAW-|inputTokens|RAW-MODEL|toolUsage|costUsd/
    );
    assert.equal(requestBodies.includes(repo), false);
  } finally {
    await receiver.stop();
  }
});

// codex/019fb36f-4dfe-7c91-8674-5caaf68fcced/019fb3a8-3fc7-7410-aa52-473842eeab9a
test('DO_NOT_TRACK prevents Rudder event delivery and identity creation', async () => {
  closeDb();
  const capturePath = join(root, 'do-not-track-capture.jsonl');
  const statePath = join(root, 'do-not-track-state');
  const receiver = await startTelemetryReceiver(capturePath);

  try {
    execFileSync(
      process.execPath,
      [hookExecutable, '--rudder-event', 'run-started'],
      {
        cwd: repo,
        encoding: 'utf8',
        env: {
          ...process.env,
          DO_NOT_TRACK: '1',
          POSTHOG_PROJECT_TOKEN: 'test-project-token',
          POSTHOG_HOST: receiver.host,
          RUDDER_HOME: statePath,
        },
        input: JSON.stringify({
          host: 'codex',
          repository: 'github.com/private/repository',
          branch: 'private-branch',
          runId: 'private-run',
          capturedPromptCount: 1,
          capturedSessionCount: 1,
          reconciledPromptCount: 1,
          promptSourceCounts: { codex: 1 },
          changedPathCount: 1,
          changedTestPathCount: 1,
          changedProductionPathCount: 0,
          untrackedPathCount: 0,
          testLineAdditionCount: 4,
          testLineDeletionCount: 0,
        }),
      }
    );

    assert.equal(existsSync(capturePath), false);
    assert.equal(existsSync(join(statePath, 'identity.json')), false);
  } finally {
    await receiver.stop();
  }
});

// codex/019fb375-79ec-7b02-b9d8-19fc4bfcc939/019fb376-ca9b-7243-af54-c8affdbc0dc3
test('the legacy PostHog API key does not enable telemetry', async () => {
  closeDb();
  const capturePath = join(root, 'legacy-telemetry-capture.jsonl');
  const receiver = await startTelemetryReceiver(capturePath);

  try {
    const stdout = execFileSync(
      process.execPath,
      [hookExecutable, '--source', 'codex'],
      {
        cwd: repo,
        encoding: 'utf8',
        env: {
          ...process.env,
          DO_NOT_TRACK: '',
          POSTHOG_API_KEY: 'legacy-api-key',
          POSTHOG_PROJECT_TOKEN: '',
          POSTHOG_HOST: receiver.host,
          RUDDER_HOME: process.env.RUDDER_HOME,
        },
        input: JSON.stringify({
          hook_event_name: 'UserPromptSubmit',
          session_id: 'legacy-telemetry-session',
          turn_id: 'legacy-telemetry-turn',
          prompt: 'This prompt must stay local.',
          cwd: repo,
        }),
      }
    );

    assert.equal(stdout, '');
    assert.equal(existsSync(capturePath), false);
  } finally {
    await receiver.stop();
  }
});

// codex/019fb36f-4dfe-7c91-8674-5caaf68fcced/019fb386-4741-7860-89a9-97f3697fa4f1
test('a release build sends telemetry without user environment configuration', async () => {
  closeDb();
  const capturePath = join(root, 'built-telemetry-capture.jsonl');
  const receiver = await startTelemetryReceiver(capturePath);
  const releaseRoot = join(root, 'release');
  const dist = join(releaseRoot, 'dist');

  try {
    cpSync(join(pluginRoot, 'bin'), join(releaseRoot, 'bin'), {
      recursive: true,
    });
    cpSync(join(pluginRoot, 'src'), join(releaseRoot, 'src'), {
      recursive: true,
    });
    symlinkSync(join(pluginRoot, 'node_modules'), join(releaseRoot, 'node_modules'));
    writeFileSync(
      join(releaseRoot, 'src', 'telemetry-build-config.ts'),
      [
        "export const BUILT_IN_POSTHOG_PROJECT_TOKEN = 'built-test-project-token';",
        `export const BUILT_IN_POSTHOG_HOST = ${JSON.stringify(receiver.host)};`,
        '',
      ].join('\n')
    );
    execFileSync(
      join(pluginRoot, 'node_modules', '.bin', 'esbuild'),
      [
        join(releaseRoot, 'bin', 'rudder-prompt-hook.ts'),
        '--bundle',
        '--platform=node',
        '--format=esm',
        '--target=node23',
        `--outfile=${join(dist, 'rudder-prompt-hook.mjs')}`,
      ],
      {
        cwd: releaseRoot,
        stdio: 'ignore',
      }
    );

    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      RUDDER_HOME: process.env.RUDDER_HOME,
      RUDDER_MIGRATIONS_PATH: join(pluginRoot, 'drizzle'),
    };
    delete environment.DO_NOT_TRACK;
    delete environment.POSTHOG_API_KEY;
    delete environment.POSTHOG_PROJECT_TOKEN;
    delete environment.POSTHOG_HOST;

    const stdout = execFileSync(
      process.execPath,
      [join(dist, 'rudder-prompt-hook.mjs'), '--source', 'codex'],
      {
        cwd: repo,
        encoding: 'utf8',
        env: environment,
        input: JSON.stringify({
          hook_event_name: 'UserPromptSubmit',
          session_id: 'built-telemetry-session',
          turn_id: 'built-telemetry-turn',
          prompt: 'This built prompt must stay local.',
          cwd: repo,
        }),
      }
    );

    assert.equal(stdout, '');
    const requestBodies = readFileSync(capturePath, 'utf8');
    assert.match(requestBodies, /"event":"rudder prompt captured"/);
    assert.doesNotMatch(
      requestBodies,
      /This built prompt must stay local|built-telemetry-session|built-telemetry-turn/
    );
    assert.doesNotMatch(requestBodies, /"\$process_person_profile":false/);
  } finally {
    await receiver.stop();
  }
});

test('the executable ignores unavailable Git context', () => {
  closeDb();
  const result = spawnSync(process.execPath, [hookExecutable, '--source', 'claude-code'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, RUDDER_HOME: process.env.RUDDER_HOME },
    input: JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'outside-git-session',
      prompt: 'Draft a note.',
      cwd: root,
    }),
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.deepEqual(promptsForSession('claude-code', 'outside-git-session'), []);
});
