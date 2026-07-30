import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  resolvePluginRoot,
  runRudderMcpServer,
} from '../src/mcp/run-server.ts';
import { RUDDER_APP_RESOURCE_URI } from '../src/mcp/server.ts';

const pluginRoot = fileURLToPath(new URL('../', import.meta.url));

// codex/019fb444-8493-7973-9439-341f7b35ed2a/019fb444-892e-7462-946a-9ad14220edcc
test('serves a headless-safe tool and its bundled MCP App resource', async (context) => {
  const client = new Client({
    name: 'rudder-test-client',
    version: '1.0.0',
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = await runRudderMcpServer({
    pluginRoot: pathToFileURL(`${pluginRoot}/`),
    transport: serverTransport,
  });
  context.after(async () => server.close());
  context.after(async () => client.close());

  await client.connect(clientTransport);

  const tools = await client.listTools();
  const openRudder = tools.tools.find((tool) => tool.name === 'open_rudder');
  assert.ok(openRudder);
  assert.equal(
    (openRudder._meta?.ui as { resourceUri?: unknown } | undefined)
      ?.resourceUri,
    RUDDER_APP_RESOURCE_URI
  );
  assert.equal(openRudder.annotations?.readOnlyHint, true);

  const result = await client.callTool({
    name: 'open_rudder',
    arguments: {},
  });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, {
    status: 'ready',
    title: 'Rudder',
    summary: 'Turn coding-session intent into focused tests.',
    fallback:
      'Use the Rudder skill to generate and verify tests for the current branch.',
  });
  assert.match(result.content[0]?.text ?? '', /Use the Rudder skill/);

  const resources = await client.listResources();
  assert.ok(
    resources.resources.some(
      (resource) => resource.uri === RUDDER_APP_RESOURCE_URI
    )
  );

  const resource = await client.readResource({
    uri: RUDDER_APP_RESOURCE_URI,
  });
  const appHtml = resource.contents[0];
  assert.equal(appHtml?.mimeType, 'text/html;profile=mcp-app');
  assert.ok('text' in appHtml);
  assert.match(appHtml.text, /data-rudder-app/);
  assert.match(appHtml.text, /Turn coding-session intent into focused tests/);
  assert.doesNotMatch(appHtml.text, /<script[^>]+src=/);
});

// codex/019fb444-8493-7973-9439-341f7b35ed2a/019fb45d-2e35-73a0-a420-e73a312bb8b8
test('starts the packaged server for Codex and Claude', async (context) => {
  type McpServerConfig = {
    command: string;
    args: string[];
    cwd: string;
  };
  const claudeMcp = JSON.parse(
    readFileSync(join(pluginRoot, '.claude-mcp.json'), 'utf8')
  ) as {
    mcpServers: {
      rudder: McpServerConfig;
    };
  };
  const codexMcp = JSON.parse(
    readFileSync(join(pluginRoot, '.mcp.json'), 'utf8')
  ) as {
    rudder: McpServerConfig;
  };
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );

  for (const [hostRoot, config] of [
    ['PLUGIN_ROOT', codexMcp.rudder],
    ['CLAUDE_PLUGIN_ROOT', claudeMcp.mcpServers.rudder],
  ] as const) {
    const client = new Client({
      name: `rudder-${hostRoot.toLowerCase()}-test-client`,
      version: '1.0.0',
    });
    const environment = {
      ...inheritedEnvironment,
      [hostRoot]: pluginRoot,
    };
    delete environment[
      hostRoot === 'PLUGIN_ROOT' ? 'CLAUDE_PLUGIN_ROOT' : 'PLUGIN_ROOT'
    ];
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      cwd: join(pluginRoot, config.cwd),
      env: environment,
      stderr: 'pipe',
    });
    context.after(async () => client.close());

    await client.connect(transport);

    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === 'open_rudder'));
    await client.close();
  }
});
