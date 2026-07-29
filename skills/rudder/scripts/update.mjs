#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 1500;
const UPDATE_COMMAND_ATTEMPTS = 3;
const REGISTRY_URL =
  'https://registry.npmjs.org/@ruddercode%2Frudder-plugin/latest';

const updatePlans = {
  codex: {
    commands: [
      ['codex', 'plugin', 'marketplace', 'upgrade', 'rudder', '--json'],
      ['codex', 'plugin', 'add', 'rudder@rudder', '--json'],
    ],
    nextStep: 'Start a new Codex session to use the updated Rudder plugin.',
  },
  'claude-code': {
    commands: [
      ['claude', 'plugin', 'marketplace', 'update', 'rudder'],
      ['claude', 'plugin', 'update', 'rudder@rudder'],
    ],
    nextStep: 'Run /reload-plugins in this session to use the updated Rudder plugin.',
  },
};

function rudderHome() {
  return process.env.RUDDER_HOME || join(homedir(), '.rudder');
}

function statePath() {
  return join(rudderHome(), 'update-state.json');
}

function packageVersion() {
  const packagePath = fileURLToPath(
    new URL('../../../package.json', import.meta.url)
  );
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
  if (typeof manifest.version !== 'string' || !manifest.version) {
    throw new TypeError('Rudder package version is missing');
  }
  return manifest.version;
}

function parseVersion(version) {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(
      version
    );
  if (!match) return null;
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split('.') ?? [],
  };
}

function comparePrerelease(left, right) {
  if (left.length === 0 || right.length === 0) {
    if (left.length === right.length) return 0;
    return left.length === 0 ? 1 : -1;
  }

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined || rightPart === undefined) {
      if (leftPart === rightPart) return 0;
      return leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;

    const leftNumber = /^\d+$/u.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/u.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) {
      return Math.sign(leftNumber - rightNumber);
    }
    if (leftNumber !== null || rightNumber !== null) {
      return leftNumber !== null ? -1 : 1;
    }
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function compareVersions(leftVersion, rightVersion) {
  const left = parseVersion(leftVersion);
  const right = parseVersion(rightVersion);
  if (!left || !right) return null;

  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] !== right.core[index]) {
      return Math.sign(left.core[index] - right.core[index]);
    }
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function readState() {
  try {
    if (!existsSync(statePath())) return {};
    const state = JSON.parse(readFileSync(statePath(), 'utf8'));
    if (typeof state !== 'object' || state === null || Array.isArray(state)) {
      return {};
    }
    return state;
  } catch {
    return {};
  }
}

function writeState(state) {
  const home = rudderHome();
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const temporaryPath = join(home, `.update-state-${process.pid}.json`);
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(temporaryPath, statePath());
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function tryWriteState(state) {
  try {
    writeState(state);
  } catch {
    // Update checks are best-effort and must never block a Rudder invocation.
  }
}

function cachedVersion(state) {
  return typeof state.latestVersion === 'string'
    ? state.latestVersion
    : null;
}

function cacheIsFresh(state, now) {
  if (typeof state.lastCheckedAt !== 'string') return false;
  const checkedAt = Date.parse(state.lastCheckedAt);
  const age = now - checkedAt;
  return Number.isFinite(checkedAt) && age >= 0 && age < CHECK_INTERVAL_MS;
}

async function fetchLatestVersion() {
  const response = await fetch(REGISTRY_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`npm registry returned HTTP ${response.status}`);
  }
  const manifest = await response.json();
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    typeof manifest.version !== 'string' ||
    compareVersions(manifest.version, manifest.version) === null
  ) {
    throw new TypeError('npm registry returned an invalid Rudder version');
  }
  return manifest.version;
}

function result(currentVersion, latestVersion, source) {
  const comparison = latestVersion
    ? compareVersions(latestVersion, currentVersion)
    : null;
  const updateAvailable = comparison !== null && comparison > 0;
  return {
    currentVersion,
    latestVersion,
    updateAvailable,
    shouldNotify: updateAvailable,
    source,
  };
}

export async function checkForUpdate({ force = false } = {}) {
  const currentVersion = packageVersion();
  if (process.env.RUDDER_DISABLE_UPDATE_CHECK === '1') {
    return result(currentVersion, null, 'disabled');
  }

  const now = Date.now();
  const state = readState();
  if (!force && cacheIsFresh(state, now)) {
    return result(currentVersion, cachedVersion(state), 'cache');
  }

  try {
    const latestVersion = await fetchLatestVersion();
    const nextState = {
      schemaVersion: 1,
      lastCheckedAt: new Date(now).toISOString(),
      latestVersion,
    };
    tryWriteState(nextState);
    return result(currentVersion, latestVersion, 'registry');
  } catch {
    const latestVersion = cachedVersion(state);
    return result(
      currentVersion,
      latestVersion,
      latestVersion ? 'stale-cache' : 'unavailable'
    );
  }
}

export function updatePlan(host) {
  const plan = updatePlans[host];
  if (!plan) {
    throw new TypeError('host must be codex or claude-code');
  }
  return plan;
}

function commandError(command, args, run) {
  return (
    run.error?.message ||
    run.stderr?.trim() ||
    run.stdout?.trim() ||
    `${command} ${args.join(' ')} exited with ${run.status}`
  );
}

function runCommand([command, ...args]) {
  let failure;
  for (let attempt = 0; attempt < UPDATE_COMMAND_ATTEMPTS; attempt += 1) {
    const run = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: 60_000,
    });
    if (!run.error && run.status === 0) return null;
    failure = commandError(command, args, run);
  }
  return failure;
}

export async function applyUpdate(host) {
  const update = await checkForUpdate({ force: true });
  if (!update.updateAvailable || !update.latestVersion) {
    return { status: 'current', ...update };
  }

  const plan = updatePlan(host);
  for (const command of plan.commands) {
    const error = runCommand(command);
    if (error) {
      return {
        status: 'failed',
        previousVersion: update.currentVersion,
        version: update.latestVersion,
        error,
      };
    }
  }
  return {
    status: 'updated',
    previousVersion: update.currentVersion,
    version: update.latestVersion,
    nextStep: plan.nextStep,
  };
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new TypeError(`${name} requires a value`);
  }
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  let output;

  if (command === 'check') {
    output = await checkForUpdate({ force: args.includes('--force') });
  } else if (command === 'plan') {
    const host = argumentValue(args, '--host');
    if (!host) throw new TypeError('plan requires --host');
    output = updatePlan(host);
  } else if (command === 'apply') {
    const host = argumentValue(args, '--host');
    if (!host) throw new TypeError('apply requires --host');
    output = await applyUpdate(host);
  } else {
    throw new TypeError(
      'usage: update.mjs <check [--force]|plan --host <codex|claude-code>|apply --host <codex|claude-code>>'
    );
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

const entrypoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (entrypoint === import.meta.url) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
