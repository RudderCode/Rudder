#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
}

function strippedRepositoryPath(path) {
  return path.replace(/^\/+|\/+$/gu, '').replace(/\.git$/u, '');
}

function normalizeRepository(repository) {
  const value = repository.trim();
  const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/u.exec(value);
  if (scp && !value.includes('://')) {
    return `${scp[1].toLowerCase()}/${strippedRepositoryPath(scp[2])}`;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'file:') {
      return `${url.host.toLowerCase()}/${strippedRepositoryPath(
        decodeURIComponent(url.pathname)
      )}`;
    }
  } catch {
    // Treat non-URL values as local paths.
  }
  return strippedRepositoryPath(value);
}

export function repositoryKey(root, branch) {
  const branchRemote = git(
    root,
    ['config', '--get', `branch.${branch}.remote`],
    true
  );
  const remoteNames = [
    branchRemote && branchRemote !== '.' ? branchRemote : null,
    'origin',
    ...((git(root, ['remote'], true) ?? '').split('\n').filter(Boolean)),
  ].filter(Boolean);

  for (const remoteName of new Set(remoteNames)) {
    const remote = git(root, ['remote', 'get-url', remoteName], true);
    if (remote) return normalizeRepository(remote);
  }

  const commonDir = git(root, ['rev-parse', '--git-common-dir']);
  const absolute = realpathSync(resolve(root, commonDir));
  return `local:${createHash('sha256').update(absolute).digest('hex')}`;
}

export function isSpecCandidatePath(path) {
  const normalized = path.replaceAll('\\', '/');
  const file = basename(normalized);
  if (/\.(feature|md|mdx)$/iu.test(file)) return true;

  return (
    /\.(json|ya?ml)$/iu.test(file) &&
    (/(?:^|\/)(?:asyncapi|openapi)(?:\/|$)/iu.test(normalized) ||
      /^(?:asyncapi|openapi)\.(?:json|ya?ml)$/iu.test(file))
  );
}

export function isTestPath(path) {
  const normalized = path.replaceAll('\\', '/');
  const file = basename(normalized);
  if (isSpecCandidatePath(normalized)) return false;
  return (
    /(^|\/)(__tests__|tests?|specs?|testdata|fixtures?)(\/|$)/iu.test(
      normalized
    ) ||
    /\.(test|spec)\.[^.]+$/iu.test(file) ||
    /^(test_.+|.+_test)\.[^.]+$/iu.test(file)
  );
}

function textLineCount(path) {
  try {
    const content = readFileSync(path);
    if (content.length === 0 || content.includes(0)) return 0;
    let lines = 0;
    for (const byte of content) {
      if (byte === 10) lines += 1;
    }
    return lines + (content.at(-1) === 10 ? 0 : 1);
  } catch {
    return 0;
  }
}

export function testDiffLineCounts(root, mergeBase) {
  const output = execFileSync(
    'git',
    ['-C', root, 'diff', '--numstat', '-z', mergeBase, '--'],
    { encoding: 'utf8' }
  );
  const fields = output.split('\0');
  let additions = 0;
  let deletions = 0;
  for (let index = 0; index < fields.length; ) {
    const field = fields[index++];
    if (!field) continue;
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/su.exec(field);
    if (!match) continue;

    let paths;
    if (match[3]) {
      paths = [match[3]];
    } else {
      paths = [fields[index++] ?? '', fields[index++] ?? ''];
    }
    if (!paths.some(isTestPath)) continue;
    if (match[1] !== '-') additions += Number(match[1]);
    if (match[2] !== '-') deletions += Number(match[2]);
  }

  const untracked = gitNullList(root, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
  ]);
  for (const path of untracked.filter(isTestPath)) {
    additions += textLineCount(join(root, path));
  }
  return { additions, deletions };
}

function host() {
  if (process.env.PLUGIN_ROOT) return 'codex';
  if (process.env.CLAUDE_PLUGIN_ROOT) return 'claude-code';
  return 'unknown';
}

export function captureRudderTelemetry(event, payload) {
  const executable = fileURLToPath(
    new URL('../../../dist/rudder-prompt-hook.mjs', import.meta.url)
  );
  if (!existsSync(executable)) return false;

  try {
    const input = JSON.stringify({ ...payload, host: host() });
    const telemetry = spawn(
      process.execPath,
      [executable, '--rudder-event', event],
      {
        env: process.env,
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
      }
    );
    telemetry.once('error', () => {
      // Telemetry dispatch failures must not interrupt the Rudder workflow.
    });
    telemetry.stdin.once('error', () => {
      // The child may exit before reading its best-effort telemetry payload.
    });
    telemetry.stdin.end(input);
    telemetry.stdin.unref();
    telemetry.unref();
    return true;
  } catch {
    return false;
  }
}

function argumentValue(args, name, required = false) {
  const index = args.indexOf(name);
  if (index === -1) {
    if (required) throw new TypeError(`${name} is required`);
    return null;
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new TypeError(`${name} requires a value`);
  }
  return value;
}

function argumentChoice(args, name, choices) {
  const value = argumentValue(args, name, true);
  if (!choices.includes(value)) {
    throw new TypeError(`${name} must be one of: ${choices.join(', ')}`);
  }
  return value;
}

function argumentCount(args, name, positive = false) {
  const value = argumentValue(args, name, true);
  if (!/^(0|[1-9]\d*)$/u.test(value)) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  if (positive && result === 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return result;
}

function safeRelativePath(root, path) {
  const absolute = resolve(root, path);
  const normalized = relative(root, absolute);
  if (
    !normalized ||
    normalized === '..' ||
    normalized.startsWith(
      `..${process.platform === 'win32' ? '\\' : '/'}`
    )
  ) {
    return null;
  }
  return normalized;
}

function specBackedTestCount(root, testPaths) {
  const tag =
    /^\s*(?:(?:\/\/|#|--|;)\s*rudder-spec:\s*(?:REQ|EC)-\d{3}|\/\*+\s*rudder-spec:\s*(?:REQ|EC)-\d{3}\s*\*\/)\s*$/gmu;
  let count = 0;
  for (const path of testPaths) {
    const safePath = safeRelativePath(root, path);
    if (!safePath) continue;
    try {
      count += readFileSync(join(root, safePath), 'utf8').match(tag)?.length ?? 0;
    } catch {
      // Deleted, binary, and unreadable test paths contribute no tags.
    }
  }
  return count;
}

function activeRun(args) {
  const cwd = realpathSync(argumentValue(args, '--cwd', true));
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  const branch = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!branch) throw new Error('Rudder requires an attached Git branch');
  return {
    root,
    branch,
    repository: repositoryKey(root, branch),
    runId: argumentValue(args, '--run-id', true),
  };
}

function recordQuestion(args) {
  const run = activeRun(args);
  const questionNumber = argumentCount(args, '--question-number', true);
  const dispatched = captureRudderTelemetry('question-asked', {
    repository: run.repository,
    branch: run.branch,
    runId: run.runId,
    questionNumber,
  });
  return { schemaVersion: 1, telemetryDispatched: dispatched, questionNumber };
}

function finishRun(args) {
  const run = activeRun(args);
  const { root } = run;
  const baseRef = argumentValue(args, '--base', true);
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
  const testPaths = changedPaths.filter(isTestPath);
  const productionPaths = changedPaths.filter((path) => !isTestPath(path));
  const testLines = testDiffLineCounts(root, mergeBase);
  const result = {
    status: argumentChoice(args, '--status', [
      'completed',
      'stopped',
      'blocked',
    ]),
    testsPassed: argumentChoice(args, '--tests-passed', [
      'yes',
      'no',
      'unknown',
    ]),
    coverageTargetMet: argumentChoice(args, '--coverage-target-met', [
      'yes',
      'no',
      'unknown',
    ]),
    changedPathCount: changedPaths.length,
    changedTestPathCount: testPaths.length,
    changedProductionPathCount: productionPaths.length,
    specBackedTestCount: specBackedTestCount(root, testPaths),
    finalTestLineAdditionCount: testLines.additions,
    finalTestLineDeletionCount: testLines.deletions,
    questionsAskedCount: argumentCount(args, '--questions-asked'),
  };
  const dispatched = captureRudderTelemetry('run-finished', {
    repository: run.repository,
    branch: run.branch,
    runId: run.runId,
    status: result.status,
    testsPassed: result.testsPassed,
    coverageTargetMet: result.coverageTargetMet,
    changedPathCount: result.changedPathCount,
    changedTestPathCount: result.changedTestPathCount,
    changedProductionPathCount: result.changedProductionPathCount,
    specBackedTestCount: result.specBackedTestCount,
    testLineAdditionCount: result.finalTestLineAdditionCount,
    testLineDeletionCount: result.finalTestLineDeletionCount,
    questionsAskedCount: result.questionsAskedCount,
  });
  return { schemaVersion: 1, telemetryDispatched: dispatched, ...result };
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'question-asked':
      process.stdout.write(`${JSON.stringify(recordQuestion(args), null, 2)}\n`);
      return;
    case 'complete':
      process.stdout.write(`${JSON.stringify(finishRun(args), null, 2)}\n`);
      return;
    default:
      throw new TypeError(
        'usage: telemetry.mjs <question-asked|complete> --cwd <path> --run-id <id> [command options]'
      );
  }
}

const entrypoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (entrypoint === import.meta.url) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
