import { App } from '@modelcontextprotocol/ext-apps';

interface LaunchResult {
  fallback: string;
  status: 'ready';
  summary: string;
  title: string;
}

export type RudderAppBridge = Pick<App, 'connect' | 'ontoolresult'>;
export type RudderAppDocument = Pick<Document, 'getElementById'>;

function element(root: RudderAppDocument, id: string): HTMLElement {
  const value = root.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value;
}

function launchResult(value: unknown): LaunchResult | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as Record<string, unknown>;
  if (
    result.status !== 'ready' ||
    typeof result.title !== 'string' ||
    typeof result.summary !== 'string' ||
    typeof result.fallback !== 'string'
  ) {
    return null;
  }
  return result as unknown as LaunchResult;
}

export async function startRudderApp(
  root: RudderAppDocument,
  app: RudderAppBridge
): Promise<void> {
  const status = element(root, 'status');
  const title = element(root, 'title');
  const summary = element(root, 'summary');
  const fallback = element(root, 'fallback');

  app.ontoolresult = (result) => {
    const content = result.structuredContent;
    if (content == null) {
      status.textContent = 'Connected';
      return;
    }
    const launch = launchResult(content);
    if (!launch) {
      status.textContent = 'Error';
      fallback.textContent = 'Rudder received malformed content from the host.';
      return;
    }
    status.textContent = launch.status === 'ready' ? 'Ready' : launch.status;
    title.textContent = launch.title;
    summary.textContent = launch.summary;
    fallback.textContent = launch.fallback;
  };

  try {
    await app.connect();
  } catch {
    status.textContent = 'Unavailable';
    fallback.textContent =
      'This view needs a host with MCP Apps support. The Rudder skill remains available from chat.';
  }
}

if (typeof document !== 'undefined') {
  void startRudderApp(
    document,
    new App({ name: 'Rudder', version: '1.0.0' })
  );
}
