import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createRudderMcpServer } from './server.ts';

interface RunRudderMcpServerOptions {
  pluginRoot?: URL;
  transport?: Transport;
}

export function resolvePluginRoot(
  env: NodeJS.ProcessEnv = process.env,
  moduleUrl: string = import.meta.url
): URL {
  const configuredRoot = env.PLUGIN_ROOT ?? env.CLAUDE_PLUGIN_ROOT;
  return configuredRoot
    ? pathToFileURL(`${resolve(configuredRoot)}${sep}`)
    : new URL('../', moduleUrl);
}

async function packageVersion(pluginRoot: URL): Promise<string> {
  try {
    const manifest = JSON.parse(
      await readFile(new URL('package.json', pluginRoot), 'utf8')
    ) as Record<string, unknown>;
    return typeof manifest.version === 'string' && manifest.version
      ? manifest.version
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function runRudderMcpServer({
  pluginRoot = resolvePluginRoot(),
  transport = new StdioServerTransport(),
}: RunRudderMcpServerOptions = {}) {
  const server = createRudderMcpServer({
    version: await packageVersion(pluginRoot),
    loadAppHtml: () =>
      readFile(new URL('dist/rudder-app.html', pluginRoot), 'utf8'),
  });
  await server.connect(transport);
  return server;
}
