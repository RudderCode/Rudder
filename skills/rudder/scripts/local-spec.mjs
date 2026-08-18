#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  captureRudderTelemetry,
  repositoryKey,
} from './telemetry.mjs';

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

function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  throw new Error(
    result.stderr.trim() || `git ${args.join(' ')} exited with ${result.status}`
  );
}

function branchContext(cwd) {
  const root = realpathSync(git(cwd, ['rev-parse', '--show-toplevel']));
  const branch = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return { root, branch, repository: repositoryKey(root, branch) };
}

function stateRoot() {
  return resolve(process.env.RUDDER_HOME || join(homedir(), '.rudder'));
}

function canonicalFuturePath(path) {
  let existing = resolve(path);
  const missing = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    missing.unshift(basename(existing));
    existing = parent;
  }
  return resolve(realpathSync(existing), ...missing);
}

function isWithin(parent, child) {
  const path = relative(parent, child);
  return (
    path === '' ||
    (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

function restrict(path, mode) {
  try {
    chmodSync(path, mode);
  } catch {
    // Some Windows and network filesystems do not expose POSIX mode bits.
  }
}

function specsDirectory(root) {
  const directory = canonicalFuturePath(join(stateRoot(), 'specs'));
  if (isWithin(root, directory)) {
    throw new Error('Rudder local specs must be stored outside the repository');
  }
  return directory;
}

function openSpecDatabase() {
  const databasePath = join(stateRoot(), 'rudder.db');
  if (!existsSync(databasePath)) {
    throw new Error('Rudder database is not initialized');
  }
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA busy_timeout = 5000');
  const table = database
    .prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'specs'"
    )
    .get();
  if (!table) {
    database.close();
    throw new Error('Rudder specs migration has not been applied');
  }
  return database;
}

function localSpec(database, repository, branch) {
  return (
    database
      .prepare(
        `SELECT repository,
                branch,
                spec_path AS specPath,
                source_relative_path AS sourceRelativePath
           FROM specs
          WHERE repository = ? AND branch = ?`
      )
      .get(repository, branch) ?? null
  );
}

function repositorySource(root, requestedPath) {
  if (isAbsolute(requestedPath)) {
    throw new TypeError('--source must be repository-relative');
  }
  const path = realpathSync(resolve(root, requestedPath));
  if (!isWithin(root, path) || !lstatSync(path).isFile()) {
    throw new Error('--source must identify a file inside the repository');
  }
  return {
    content: readFileSync(path),
    relativePath: relative(root, path).split(sep).join('/'),
  };
}

function inputContent(requestedPath) {
  const path = realpathSync(resolve(requestedPath));
  if (!lstatSync(path).isFile()) {
    throw new Error('--input must identify a file');
  }
  return readFileSync(path);
}

function stageFile(path, content) {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, content, { flag: 'wx', mode: 0o600 });
  restrict(temporaryPath, 0o600);
  return temporaryPath;
}

function create(args) {
  const cwd = realpathSync(argumentValue(args, '--cwd', true));
  const runId = argumentValue(args, '--run-id', true);
  const source = argumentValue(args, '--source');
  const input = argumentValue(args, '--input');
  if (Boolean(source) === Boolean(input)) {
    throw new TypeError('create requires exactly one of --source or --input');
  }

  const context = branchContext(cwd);
  const directory = specsDirectory(context.root);
  const database = openSpecDatabase();
  let specPath;
  let temporaryPath;
  try {
    if (localSpec(database, context.repository, context.branch)) {
      throw new Error('A local Rudder spec already exists for this branch');
    }
    const sourceData = source ? repositorySource(context.root, source) : null;
    const content = sourceData?.content ?? inputContent(input);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    restrict(directory, 0o700);
    specPath = join(directory, `${randomUUID()}.md`);
    temporaryPath = stageFile(specPath, content);

    database.exec('BEGIN IMMEDIATE');
    try {
      renameSync(temporaryPath, specPath);
      temporaryPath = undefined;
      restrict(specPath, 0o600);
      database
        .prepare(
          `INSERT INTO specs (repository, branch, spec_path, source_relative_path)
           VALUES (?, ?, ?, ?)`
        )
        .run(
          context.repository,
          context.branch,
          specPath,
          sourceData?.relativePath ?? null
        );
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      if (specPath) rmSync(specPath, { force: true });
      throw error;
    }

    const result = localSpec(database, context.repository, context.branch);
    captureRudderTelemetry('spec-created', {
      repository: context.repository,
      branch: context.branch,
      runId,
    });
    return { schemaVersion: 1, created: true, localSpec: result };
  } finally {
    if (temporaryPath) rmSync(temporaryPath, { force: true });
    database.close();
  }
}

function replaceSource(args) {
  const cwd = realpathSync(argumentValue(args, '--cwd', true));
  const context = branchContext(cwd);
  const directory = specsDirectory(context.root);
  const database = openSpecDatabase();
  let temporaryPath;
  try {
    const stored = localSpec(database, context.repository, context.branch);
    if (!stored) throw new Error('No local Rudder spec exists for this branch');
    if (!stored.sourceRelativePath) {
      throw new Error('The local Rudder spec has no repository source');
    }
    if (!isAbsolute(stored.specPath) || !existsSync(stored.specPath)) {
      throw new Error('The database-linked local Rudder spec is missing');
    }
    const specPath = realpathSync(stored.specPath);
    const canonicalDirectory = canonicalFuturePath(directory);
    if (!isWithin(canonicalDirectory, specPath) || isWithin(context.root, specPath)) {
      throw new Error('The database-linked spec path is not valid local Rudder state');
    }

    const original = readFileSync(specPath);
    const sourceData = repositorySource(
      context.root,
      stored.sourceRelativePath
    );
    temporaryPath = stageFile(specPath, sourceData.content);
    database.exec('BEGIN IMMEDIATE');
    try {
      database
        .prepare(
          `UPDATE specs
              SET source_relative_path = ?
            WHERE repository = ? AND branch = ?`
        )
        .run(sourceData.relativePath, context.repository, context.branch);
      renameSync(temporaryPath, specPath);
      temporaryPath = undefined;
      restrict(specPath, 0o600);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      const recoveryPath = stageFile(specPath, original);
      renameSync(recoveryPath, specPath);
      restrict(specPath, 0o600);
      throw error;
    }
    return {
      schemaVersion: 1,
      replaced: true,
      localSpec: localSpec(database, context.repository, context.branch),
    };
  } finally {
    if (temporaryPath) rmSync(temporaryPath, { force: true });
    database.close();
  }
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  let result;
  switch (command) {
    case 'create':
      result = create(args);
      break;
    case 'replace-source':
      result = replaceSource(args);
      break;
    default:
      throw new TypeError(
        'usage: local-spec.mjs <create|replace-source> --cwd <path> [command options]'
      );
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
