import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export const RUDDER_APP_RESOURCE_URI = 'ui://rudder/workspace.html';

interface RudderMcpServerOptions {
  loadAppHtml(): Promise<string>;
  version: string;
}

const launchResult = {
  status: 'ready' as const,
  title: 'Rudder',
  summary: 'Turn coding-session intent into focused tests.',
  fallback:
    'Use the Rudder skill to generate and verify tests for the current branch.',
};

export function createRudderMcpServer({
  loadAppHtml,
  version,
}: RudderMcpServerOptions): McpServer {
  const server = new McpServer({
    name: 'rudder',
    version,
  });

  registerAppResource(
    server,
    'Rudder workspace',
    RUDDER_APP_RESOURCE_URI,
    {
      description: 'Interactive workspace for the Rudder test workflow.',
    },
    async () => ({
      contents: [
        {
          uri: RUDDER_APP_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await loadAppHtml(),
        },
      ],
    })
  );

  registerAppTool(
    server,
    'open_rudder',
    {
      title: 'Open Rudder',
      description:
        'Open the Rudder workspace. Use it when the user asks to view or work with Rudder in an interactive UI.',
      inputSchema: {},
      outputSchema: {
        status: z.literal('ready'),
        title: z.string(),
        summary: z.string(),
        fallback: z.string(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          resourceUri: RUDDER_APP_RESOURCE_URI,
        },
      },
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: `${launchResult.summary} ${launchResult.fallback}`,
        },
      ],
      structuredContent: launchResult,
    })
  );

  return server;
}
