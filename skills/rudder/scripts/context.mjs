#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  captureRudderTelemetry,
  isSpecCandidatePath,
  isTestPath,
  repositoryKey,
  testDiffLineCounts,
} from './telemetry.mjs';

function argumentValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new TypeError(`${name} requires a value`);
  }
  return value;
}

function git(cwd, args, optional = false) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status === 0) return result.stdout.trim();
  if (optional) return null;
  throw new Error(
    result.stderr.trim() || `git ${args.join(' ')} exited with ${result.status}`
  );
}

function gitNullList(cwd, args) {
  const output = execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
  });
  return output.split('\0').filter(Boolean);
}

function resolveBase(root, requested) {
  const candidates = requested
    ? [requested]
    : [
        git(
          root,
          ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
          true
        ),
        'origin/main',
        'main',
        'origin/master',
        'master',
      ];

  for (const candidate of candidates.filter(Boolean)) {
    if (git(root, ['rev-parse', '--verify', '--quiet', candidate], true)) {
      return candidate;
    }
  }
  return 'HEAD';
}

function tableExists(database, name) {
  return Boolean(
    database
      .prepare(
        "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?"
      )
      .get(name)
  );
}

function storedContext(repository, branch) {
  const stateRoot = process.env.RUDDER_HOME || join(homedir(), '.rudder');
  const databasePath = join(stateRoot, 'rudder.db');
  if (!existsSync(databasePath)) {
    return { databasePath, localSpec: null, prompts: [] };
  }

  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const prompts = tableExists(database, 'prompt_branches')
      ? database
          .prepare(
            `SELECT source,
                    session_id AS sessionId,
                    prompt_id AS promptId,
                    prompt_text AS promptText,
                    previous_agent_output AS previousAgentOutput,
                    submitted_at AS submittedAt,
                    reconciled_at AS reconciledAt
               FROM prompt_branches
              WHERE repository = ? AND branch = ?
              ORDER BY submitted_at, source, session_id, prompt_id`
          )
          .all(repository, branch)
      : [];
    const localSpec = tableExists(database, 'specs')
      ? (database
          .prepare(
            `SELECT repository,
                    branch,
                    spec_path AS specPath,
                    source_relative_path AS sourceRelativePath
               FROM specs
              WHERE repository = ? AND branch = ?`
          )
          .get(repository, branch) ?? null)
      : null;
    return { databasePath, localSpec, prompts };
  } finally {
    database.close();
  }
}

function main() {
  const args = process.argv.slice(2);
  const phase = argumentValue(args, '--phase') ?? 'start';
  if (phase !== 'start' && phase !== 'refresh') {
    throw new TypeError('--phase must be start or refresh');
  }
  const requestedRunId = argumentValue(args, '--run-id');
  if (phase === 'refresh' && !requestedRunId) {
    throw new TypeError('--run-id is required when --phase is refresh');
  }
  const rudderRunId = requestedRunId ?? randomUUID();
  const cwd = realpathSync(argumentValue(args, '--cwd') ?? process.cwd());
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  const branch = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!branch) throw new Error('Rudder requires an attached Git branch');

  const baseRef = resolveBase(root, argumentValue(args, '--base'));
  const mergeBase = git(root, ['merge-base', 'HEAD', baseRef]);
  const tracked = gitNullList(root, [
    'diff',
    '--name-only',
    '-z',
    mergeBase,
    '--',
  ]);
  const untracked = gitNullList(root, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
  ]);
  const changedPaths = [...new Set([...tracked, ...untracked])].sort();
  const specCandidatePaths = changedPaths.filter(isSpecCandidatePath);
  const testPaths = changedPaths.filter(isTestPath);
  const productionCandidatePaths = changedPaths.filter(
    (path) => !isTestPath(path)
  );
  const testLines = testDiffLineCounts(root, mergeBase);
  const repository = repositoryKey(root, branch);
  const stored = storedContext(repository, branch);
  const promptSessions = new Set(
    stored.prompts.map((prompt) => `${prompt.source}\0${prompt.sessionId}`)
  );
  const promptSourceCounts = {};
  for (const prompt of stored.prompts) {
    const source = ['claude-code', 'codex', 'cursor'].includes(prompt.source)
      ? prompt.source
      : 'other';
    promptSourceCounts[source] = (promptSourceCounts[source] ?? 0) + 1;
  }
  captureRudderTelemetry(
    phase === 'start' ? 'run-started' : 'context-refreshed',
    {
      repository,
      branch,
      runId: rudderRunId,
      capturedPromptCount: stored.prompts.length,
      capturedSessionCount: promptSessions.size,
      reconciledPromptCount: stored.prompts.filter(
        (prompt) => prompt.reconciledAt !== null
      ).length,
      promptSourceCounts,
      changedPathCount: changedPaths.length,
      changedTestPathCount: testPaths.length,
      changedProductionPathCount: productionCandidatePaths.length,
      untrackedPathCount: untracked.length,
      testLineAdditionCount: testLines.additions,
      testLineDeletionCount: testLines.deletions,
    }
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: 2,
        rudderRunId,
        root,
        repository,
        branch,
        baseRef,
        mergeBase,
        changedPaths,
        localSpec: stored.localSpec,
        productionCandidatePaths,
        specCandidatePaths,
        testPaths,
        untrackedPaths: untracked.sort(),
        testLineAdditionCount: testLines.additions,
        testLineDeletionCount: testLines.deletions,
        promptDatabasePath: stored.databasePath,
        prompts: stored.prompts,
      },
      null,
      2
    )}\n`
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
