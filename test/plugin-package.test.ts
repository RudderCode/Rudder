import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { closeDb } from '../src/db/client.ts';
import { promptsForSession } from '../src/prompt-tagger.ts';

const pluginRoot = fileURLToPath(new URL('../', import.meta.url));

let root: string;
let repo: string;
let originalRudderHome: string | undefined;

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'rudder-plugin-'));
  repo = join(root, 'repo');
  mkdirSync(repo);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Rudder Tests');
  git('config', 'user.email', 'tests@rudder.local');
  git('remote', 'add', 'origin', 'git@github.com:rudder-test/plugin.git');
  writeFileSync(join(repo, 'fixture.txt'), 'fixture\n');
  git('add', 'fixture.txt');
  git('commit', '-m', 'fixture');
  originalRudderHome = process.env.RUDDER_HOME;
  process.env.RUDDER_HOME = join(root, 'state');
});

after(() => {
  closeDb();
  if (originalRudderHome === undefined) delete process.env.RUDDER_HOME;
  else process.env.RUDDER_HOME = originalRudderHome;
  rmSync(root, { recursive: true, force: true });
});

// codex/019fb444-8493-7973-9439-341f7b35ed2a/019fb45d-2e35-73a0-a420-e73a312bb8b8
test('ships matching Codex and Claude plugin metadata', () => {
  const codex = JSON.parse(
    readFileSync(join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf8')
  );
  const claude = JSON.parse(
    readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')
  );
  const packageManifest = JSON.parse(
    readFileSync(join(pluginRoot, 'package.json'), 'utf8')
  );

  assert.equal(codex.name, 'rudder');
  assert.equal(claude.name, codex.name);
  assert.equal(codex.description, claude.description);
  assert.equal(packageManifest.name, '@ruddercode/rudder-plugin');
  assert.equal(packageManifest.engines.node, '>=24.0.0');
  assert.equal(packageManifest.dependencies, undefined);
  assert.equal(packageManifest.workspaces, undefined);
  assert.equal(codex.skills, claude.skills);
  assert.equal(claude.skills, './skills/');
  assert.equal(claude.mcpServers, './.claude-mcp.json');
  assert.equal(codex.mcpServers, './.mcp.json');
  assert.ok(codex.interface.capabilities.includes('Interactive'));
  assert.equal(claude.hooks, './hooks/hooks.json');
  assert.ok(codex.interface.shortDescription.length <= 30);
  assert.match(codex.interface.privacyPolicyURL, /^https:\/\//);
  assert.match(codex.interface.termsOfServiceURL, /^https:\/\//);
  assert.ok(packageManifest.files.includes('.codex-plugin'));
  assert.ok(packageManifest.files.includes('.claude-plugin'));
  assert.ok(packageManifest.files.includes('.mcp.json'));
  assert.ok(packageManifest.files.includes('.claude-mcp.json'));
  assert.ok(packageManifest.files.includes('assets'));
  assert.ok(packageManifest.files.includes('docs'));
  assert.ok(packageManifest.files.includes('hooks'));
  assert.ok(packageManifest.files.includes('skills'));
  assert.ok(packageManifest.files.includes('dist'));
});

// codex/019fb444-8493-7973-9439-341f7b35ed2a/019fb45a-bff9-7380-ad29-eae9c4b02ff7
test('requires coverage for the MCP App UI sources', () => {
  const packageManifest = JSON.parse(
    readFileSync(join(pluginRoot, 'package.json'), 'utf8')
  );

  assert.ok(packageManifest.c8.include.includes('ui/**/*.ts'));
  assert.match(packageManifest.scripts['test:coverage'], /diff-cover/);
  assert.match(packageManifest.scripts['test:coverage'], /--fail-under=90/);
  assert.match(packageManifest.scripts['test:coverage'], /--include-untracked/);
});

// codex/019fb444-8493-7973-9439-341f7b35ed2a/019fb444-892e-7462-946a-9ad14220edcc
test('ships equivalent Claude and Codex MCP server definitions', () => {
  const claudeMcp = JSON.parse(
    readFileSync(join(pluginRoot, '.claude-mcp.json'), 'utf8')
  );
  const codexMcp = JSON.parse(
    readFileSync(join(pluginRoot, '.mcp.json'), 'utf8')
  );

  assert.deepEqual(Object.keys(claudeMcp), ['mcpServers']);
  assert.deepEqual(Object.keys(codexMcp), ['rudder']);
  assert.deepEqual(claudeMcp.mcpServers, codexMcp);
});

// codex/019fb444-8493-7973-9439-341f7b35ed2a/019fb444-892e-7462-946a-9ad14220edcc
test('ships the bundled MCP server and single-file app resource', () => {
  const mcp = JSON.parse(
    readFileSync(join(pluginRoot, '.mcp.json'), 'utf8')
  );
  const packageManifest = JSON.parse(
    readFileSync(join(pluginRoot, 'package.json'), 'utf8')
  );
  const serverPath = join(pluginRoot, 'dist', 'rudder-mcp-server.mjs');
  const appPath = join(pluginRoot, 'dist', 'rudder-app.html');

  assert.deepEqual(Object.keys(mcp), ['rudder']);
  assert.equal(mcp.rudder.command, 'node');
  assert.equal(mcp.rudder.cwd, '.');
  assert.deepEqual(mcp.rudder.args.slice(0, 2), [
    '--input-type=module',
    '-e',
  ]);
  assert.match(mcp.rudder.args[2], /PLUGIN_ROOT/);
  assert.match(mcp.rudder.args[2], /CLAUDE_PLUGIN_ROOT/);
  assert.match(mcp.rudder.args[2], /rudder-mcp-server/);
  assert.match(packageManifest.scripts.build, /rudder-mcp-server/);
  assert.match(packageManifest.scripts.build, /build-mcp-app/);
  assert.ok(readFileSync(serverPath, 'utf8').length > 0);
  assert.ok(readFileSync(appPath, 'utf8').length > 0);
});

test('keeps the Rudder package version synchronized across the codebase', () => {
  const packageManifest = JSON.parse(
    readFileSync(join(pluginRoot, 'package.json'), 'utf8')
  );
  const packageLock = JSON.parse(
    readFileSync(join(pluginRoot, 'package-lock.json'), 'utf8')
  );
  const codex = JSON.parse(
    readFileSync(join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf8')
  );
  const claude = JSON.parse(
    readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')
  );
  const marketplace = JSON.parse(
    readFileSync(
      join(pluginRoot, '.claude-plugin', 'marketplace.json'),
      'utf8'
    )
  );

  for (const [source, version] of [
    ['package-lock.json', packageLock.version],
    ['package-lock.json root package', packageLock.packages[''].version],
    ['.codex-plugin/plugin.json', codex.version],
    ['.claude-plugin/plugin.json', claude.version],
    ['marketplace plugin metadata', marketplace.plugins[0].version],
    ['marketplace npm source', marketplace.plugins[0].source.version],
  ]) {
    assert.equal(
      version,
      packageManifest.version,
      `${source} must match package.json version ${packageManifest.version}`
    );
  }

});

// codex/019fb36f-4dfe-7c91-8674-5caaf68fcced/019fb386-4741-7860-89a9-97f3697fa4f1
test('ships a public marketplace catalog and its package resources', () => {
  const marketplace = JSON.parse(
    readFileSync(
      join(pluginRoot, '.claude-plugin', 'marketplace.json'),
      'utf8'
    )
  );
  const skill = readFileSync(
    join(pluginRoot, 'skills', 'rudder', 'SKILL.md'),
    'utf8'
  );

  assert.equal(marketplace.name, 'rudder');
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, 'rudder');
  assert.equal(marketplace.plugins[0].source.source, 'npm');
  assert.equal(
    marketplace.plugins[0].source.package,
    '@ruddercode/rudder-plugin'
  );
  assert.match(skill, /^---\nname: rudder\n/);

  for (const path of [
    ['skills', 'rudder', 'scripts', 'backup-tests.mjs'],
    ['skills', 'rudder', 'scripts', 'context.mjs'],
    ['skills', 'rudder', 'scripts', 'manage-data.mjs'],
    ['skills', 'rudder', 'scripts', 'telemetry.mjs'],
    ['docs', 'install.md'],
    ['docs', 'privacy.md'],
    ['docs', 'support.md'],
    ['docs', 'terms.md'],
    ['docs', 'marketplace-submission.md'],
  ]) {
    assert.ok(readFileSync(join(pluginRoot, ...path), 'utf8').length > 0);
  }
});

test('releases the root plugin package with plugin-specific artifacts', () => {
  const publishWorkflow = readFileSync(
    join(pluginRoot, '.github', 'workflows', 'publish.yml'),
    'utf8'
  );
  const releaseAlert = readFileSync(
    join(pluginRoot, '.github', 'workflows', 'release-alert.yml'),
    'utf8'
  );

  for (const workflow of [publishWorkflow, releaseAlert]) {
    assert.match(workflow, /@ruddercode\/rudder-plugin/);
    assert.match(workflow, /rudder-plugin-v/);
    assert.doesNotMatch(workflow, /rudder-core|npm\.pkg\.github\.com|plugins\/rudder/);
    assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN/);
  }
  assert.match(publishWorkflow, /Trusted Publishing/);
  assert.match(
    publishWorkflow,
    /POSTHOG_PROJECT_TOKEN: \$\{\{ secrets\.POSTHOG_PROJECT_TOKEN \}\}/
  );
  assert.match(
    publishWorkflow,
    /POSTHOG_HOST: \$\{\{ vars\.POSTHOG_HOST \}\}/
  );
  assert.match(publishWorkflow, /src\/telemetry-build-config\.ts/);
  assert.match(
    publishWorkflow,
    /--title "Rudder v\$\{\{ steps\.check\.outputs\.version \}\}"/
  );
  assert.doesNotMatch(
    `${publishWorkflow}\n${releaseAlert}`,
    /docs\/releasing\.md|npm view "\$\{name\}" version/
  );
});

// codex/019fb375-79ec-7b02-b9d8-19fc4bfcc939/019fb37b-45f5-7d20-a5e9-82491ecced7d
test('keeps the release PostHog host explicit', () => {
  const publishWorkflow = readFileSync(
    join(pluginRoot, '.github', 'workflows', 'publish.yml'),
    'utf8'
  );
  const telemetrySource = readFileSync(
    join(pluginRoot, 'src', 'telemetry.ts'),
    'utf8'
  );

  assert.match(
    publishWorkflow,
    /const host = process\.env\.POSTHOG_HOST\?\.trim\(\) \|\| '';/
  );
  assert.match(
    publishWorkflow,
    /BUILT_IN_POSTHOG_HOST = \$\{JSON\.stringify\(host\)\}/
  );
  assert.match(
    telemetrySource,
    /const DEFAULT_POSTHOG_HOST = 'https:\/\/us\.i\.posthog\.com';/
  );
});

test('registers prompt submission and stop hooks from the plugin root', () => {
  const config = JSON.parse(
    readFileSync(join(pluginRoot, 'hooks', 'hooks.json'), 'utf8')
  );

  for (const event of ['UserPromptSubmit', 'Stop']) {
    assert.equal(config.hooks[event].length, 1);
    assert.equal(config.hooks[event][0].hooks[0].type, 'command');
    assert.match(config.hooks[event][0].hooks[0].command, /PLUGIN_ROOT/);
    assert.match(config.hooks[event][0].hooks[0].command, /CLAUDE_PLUGIN_ROOT/);
    assert.match(config.hooks[event][0].hooks[0].command, /dist\/rudder-prompt-hook/);
    assert.doesNotMatch(config.hooks[event][0].hooks[0].command, /\$\{/);
  }
});

test('maps plugin hosts to Rudder prompt sources without visible output', () => {
  closeDb();

  const fixtures = [
    {
      source: 'codex',
      sessionId: 'plugin-codex-session',
      environment: {
        PLUGIN_ROOT: pluginRoot,
      },
    },
    {
      source: 'claude-code',
      sessionId: 'plugin-claude-session',
      environment: {
        CLAUDE_PLUGIN_ROOT: pluginRoot,
      },
    },
  ] as const;

  for (const fixture of fixtures) {
    const config = JSON.parse(
      readFileSync(join(pluginRoot, 'hooks', 'hooks.json'), 'utf8')
    );
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      ...fixture.environment,
      RUDDER_HOME: process.env.RUDDER_HOME,
    };
    delete environment.PLUGIN_ROOT;
    delete environment.CLAUDE_PLUGIN_ROOT;
    Object.assign(environment, fixture.environment);

    const submitCommand = config.hooks.UserPromptSubmit[0].hooks[0].command;
    const stdout = execFileSync('/bin/sh', ['-c', submitCommand], {
      cwd: repo,
      encoding: 'utf8',
      env: environment,
      input: JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        session_id: fixture.sessionId,
        prompt: `Prompt from the ${fixture.source} plugin.`,
        cwd: repo,
      }),
    });

    assert.equal(stdout, '');

    const stopCommand = config.hooks.Stop[0].hooks[0].command;
    const stopStdout = execFileSync('/bin/sh', ['-c', stopCommand], {
      cwd: repo,
      encoding: 'utf8',
      env: environment,
      input: JSON.stringify({
        hook_event_name: 'Stop',
        session_id: fixture.sessionId,
        cwd: repo,
      }),
    });

    const row = promptsForSession(fixture.source, fixture.sessionId)[0];
    assert.equal(stopStdout, '');
    assert.equal(row?.promptText, `Prompt from the ${fixture.source} plugin.`);
    assert.ok(row?.reconciledAt);
  }
});
