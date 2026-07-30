import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { PostHog } from 'posthog-node';
import { rudderHome } from './db/index.ts';
import {
  BUILT_IN_POSTHOG_HOST,
  BUILT_IN_POSTHOG_PROJECT_TOKEN,
} from './telemetry-build-config.ts';

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';
const POSTHOG_PROJECT_TOKEN =
  process.env.POSTHOG_PROJECT_TOKEN || BUILT_IN_POSTHOG_PROJECT_TOKEN;
const POSTHOG_HOST =
  process.env.POSTHOG_HOST || BUILT_IN_POSTHOG_HOST || DEFAULT_POSTHOG_HOST;
const TELEMETRY_SCHEMA_VERSION = 1;

export interface TelemetryCaptureContext {
  pseudonymize(namespace: string, value: string): string;
}

export type TelemetryProperties = Record<string, unknown>;
export type TelemetryPropertiesFactory = (
  context: TelemetryCaptureContext
) => TelemetryProperties;

interface TelemetryIdentity {
  id: string;
  pseudonymizationKey: string;
}

function restrictIdentityPath(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // Some Windows and network filesystems do not expose POSIX mode bits.
  }
}

export function telemetryDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DO_NOT_TRACK === '1';
}

function packageVersion(): string {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as Record<string, unknown>;
    return typeof manifest.version === 'string' && manifest.version
      ? manifest.version
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function runtimeTelemetryProperties(): TelemetryProperties {
  return {
    telemetry_schema_version: TELEMETRY_SCHEMA_VERSION,
    rudder_version: packageVersion(),
  };
}

function persistIdentity(idPath: string, identity: TelemetryIdentity): void {
  mkdirSync(rudderHome(), { recursive: true, mode: 0o700 });
  restrictIdentityPath(rudderHome(), 0o700);
  writeFileSync(
    idPath,
    JSON.stringify({
      id: identity.id,
      pseudonymization_key: identity.pseudonymizationKey,
    }),
    { mode: 0o600 }
  );
  restrictIdentityPath(idPath, 0o600);
}

/** Read or generate a stable anonymous installation ID and local-only key. */
function loadIdentity(): TelemetryIdentity {
  const idPath = join(rudderHome(), 'identity.json');
  let id: string | null = null;
  let pseudonymizationKey: string | null = null;
  try {
    if (existsSync(idPath)) {
      const obj = JSON.parse(readFileSync(idPath, 'utf8')) as Record<string, unknown>;
      if (typeof obj.id === 'string' && obj.id) id = obj.id;
      if (
        typeof obj.pseudonymization_key === 'string' &&
        obj.pseudonymization_key.length >= 32
      ) {
        pseudonymizationKey = obj.pseudonymization_key;
      }
    }
  } catch {
    // Fall through to generate missing identity fields.
  }

  const identity = {
    id: id ?? randomUUID(),
    pseudonymizationKey:
      pseudonymizationKey ?? randomBytes(32).toString('hex'),
  };
  try {
    if (id === null || pseudonymizationKey === null) {
      persistIdentity(idPath, identity);
    } else {
      restrictIdentityPath(rudderHome(), 0o700);
      restrictIdentityPath(idPath, 0o600);
    }
  } catch {
    // Best-effort; use an in-memory identity if it cannot be persisted.
  }
  return identity;
}

let _client: PostHog | null = null;
let _identity: TelemetryIdentity | null = null;

function client(): PostHog | null {
  if (!POSTHOG_PROJECT_TOKEN || telemetryDisabled()) return null;
  if (!_client) {
    _client = new PostHog(POSTHOG_PROJECT_TOKEN, {
      host: POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
      enableExceptionAutocapture: true,
      isServer: false,
    });
  }
  return _client;
}

export function distinctId(): string {
  if (!_identity) _identity = loadIdentity();
  return _identity.id;
}

function pseudonymizationKey(): string {
  if (!_identity) _identity = loadIdentity();
  return _identity.pseudonymizationKey;
}

/**
 * Derive a stable, installation-scoped pseudonym without exposing the source
 * identifier or allowing it to be correlated across Rudder installations.
 */
export function pseudonymize(
  secret: string,
  namespace: string,
  value: string
): string {
  return createHmac('sha256', secret)
    .update(namespace)
    .update('\0')
    .update(value)
    .digest('hex');
}

export function capture(
  event: string,
  properties?: TelemetryProperties | TelemetryPropertiesFactory
): void {
  const telemetryClient = client();
  if (!telemetryClient) return;

  const installationId = distinctId();
  const eventProperties =
    typeof properties === 'function'
      ? properties({
          pseudonymize: (namespace, value) =>
            pseudonymize(pseudonymizationKey(), namespace, value),
        })
      : properties;

  telemetryClient.capture({
    distinctId: installationId,
    event,
    properties: {
      ...runtimeTelemetryProperties(),
      ...eventProperties,
    },
  });
}

export function captureException(err: unknown, extra?: TelemetryProperties): void {
  const telemetryClient = client();
  if (!telemetryClient) return;
  telemetryClient.captureException(err, distinctId(), {
    ...runtimeTelemetryProperties(),
    ...extra,
  });
}

export async function shutdown(): Promise<void> {
  if (_client) {
    await _client.shutdown();
    _client = null;
  }
}
