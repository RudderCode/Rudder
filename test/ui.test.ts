import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  startRudderApp,
  type RudderAppBridge,
  type RudderAppDocument,
} from '../ui/rudder-app.ts';

interface UiHarness {
  app: RudderAppBridge;
  elements: Record<string, { textContent: string | null }>;
  root: RudderAppDocument;
}

function harness(connect: () => Promise<void> = async () => {}): UiHarness {
  const elements = Object.fromEntries(
    ['status', 'title', 'summary', 'fallback'].map((id) => [
      id,
      { textContent: null },
    ])
  );
  return {
    app: {
      connect,
      ontoolresult: undefined,
    } as unknown as RudderAppBridge,
    elements,
    root: {
      getElementById: (id) => elements[id] ?? null,
    } as unknown as RudderAppDocument,
  };
}

// codex/019fb444-8493-7973-9439-341f7b35ed2a/019fb444-892e-7462-946a-9ad14220edcc
test('renders the structured launch result from the host', async () => {
  const ui = harness();
  await startRudderApp(ui.root, ui.app);

  assert.ok(ui.app.ontoolresult);
  ui.app.ontoolresult({
    structuredContent: {
      status: 'ready',
      title: 'Rudder workspace',
      summary: 'Review captured intent.',
      fallback: 'Continue from chat.',
    },
  });

  assert.equal(ui.elements.status?.textContent, 'Ready');
  assert.equal(ui.elements.title?.textContent, 'Rudder workspace');
  assert.equal(ui.elements.summary?.textContent, 'Review captured intent.');
  assert.equal(ui.elements.fallback?.textContent, 'Continue from chat.');
});

// codex/019fb444-8493-7973-9439-341f7b35ed2a/019fb444-892e-7462-946a-9ad14220edcc
test('keeps a useful fallback when no launch result or host is available', async () => {
  const connected = harness();
  await startRudderApp(connected.root, connected.app);

  assert.ok(connected.app.ontoolresult);
  connected.app.ontoolresult({ structuredContent: null });
  assert.equal(connected.elements.status?.textContent, 'Connected');

  const unavailable = harness(async () => {
    throw new Error('No MCP Apps bridge');
  });
  await startRudderApp(unavailable.root, unavailable.app);
  assert.equal(unavailable.elements.status?.textContent, 'Unavailable');
  assert.match(
    unavailable.elements.fallback?.textContent ?? '',
    /needs a host with MCP Apps support/
  );
});

// codex/019fb490-6768-7fe2-917f-a2ae504a4e42/019fb495-1a04-7ff3-845e-cf0eedacb024
test('shows an error when the host returns malformed content', async () => {
  const ui = harness();
  await startRudderApp(ui.root, ui.app);

  assert.ok(ui.app.ontoolresult);
  ui.app.ontoolresult({
    structuredContent: {
      status: 'ready',
      summary: 'Missing its required title.',
      fallback: 'Do not render this partial result.',
    },
  });

  assert.equal(ui.elements.status?.textContent, 'Error');
  assert.match(
    ui.elements.fallback?.textContent ?? '',
    /malformed content from the host/
  );
});
