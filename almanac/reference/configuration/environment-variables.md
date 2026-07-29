---
title: "Environment Variables"
summary: "Rudder runtime configuration currently comes from environment variables covering local state, migration lookup, dashboard port selection, telemetry, and update checks."
topics: [reference, configuration, runtime, telemetry]
sources:
  - id: db-client
    type: file
    path: src/db/client.ts
  - id: telemetry
    type: file
    path: src/telemetry.ts
  - id: telemetry-build-config
    type: file
    path: src/telemetry-build-config.ts
  - id: update-script
    type: file
    path: skills/rudder/scripts/update.mjs
---

Rudder currently reads environment variables for local state location, migration lookup, dashboard port selection, telemetry configuration, and update checks. `RUDDER_HOME`, `RUDDER_MIGRATIONS_PATH`, and `RUDDER_PORT` are read by the database client module; `POSTHOG_PROJECT_TOKEN`, `POSTHOG_API_KEY`, `POSTHOG_HOST`, and `DO_NOT_TRACK` control the PostHog telemetry client and opt-out behavior; `RUDDER_DISABLE_UPDATE_CHECK` disables skill update lookup [@db-client] [@telemetry] [@update-script]. This reference lists the exact parsing and defaults used by those helpers; the surrounding runtime architecture is covered by [Local State](../../architecture/runtime/local-state), [Prompt Branch Store](../../architecture/runtime/prompt-branch-store), and [Telemetry](../../architecture/runtime/telemetry).

## Variables

| Variable | Read By | Accepted Value | Default Or Disabled Behavior |
| --- | --- | --- | --- |
| `RUDDER_HOME` | `rudderHome()` | Any non-empty string path. | Empty or unset values fall back to `join(homedir(), '.rudder')` because the helper uses `process.env.RUDDER_HOME || ...` [@db-client]. |
| `RUDDER_MIGRATIONS_PATH` | `migrationsFolder()` inside `openDb()` | Any string path, including an empty string. | Only `null` or `undefined` fall back to the repository `drizzle/` directory because the helper uses nullish coalescing [@db-client]. |
| `RUDDER_PORT` | `rudderPort()` | A value that `Number()` converts to an integer greater than `0` and less than `65536`. | Invalid, unset, fractional, zero, negative, or out-of-range values return `41789` [@db-client]. |
| `POSTHOG_PROJECT_TOKEN` | Telemetry module constant | Any non-empty string. | Preferred telemetry token source; empty or unset values fall back to `POSTHOG_API_KEY`, then the built-in release-build token [@telemetry] [@telemetry-build-config]. |
| `POSTHOG_API_KEY` | Telemetry module constant | Any non-empty string. | Legacy telemetry token source used only when `POSTHOG_PROJECT_TOKEN` is unset or empty [@telemetry]. |
| `POSTHOG_HOST` | Telemetry module constant | Any non-empty string, passed to the PostHog client as `host`. | Empty or unset values fall back to the built-in release-build host, then `https://us.i.posthog.com` [@telemetry] [@telemetry-build-config]. |
| `DO_NOT_TRACK` | `telemetryDisabled()` | Exactly `1` disables telemetry. | Any other value, including unset, does not disable telemetry by itself [@telemetry]. |
| `RUDDER_DISABLE_UPDATE_CHECK` | `checkForUpdate()` | Exactly `1` disables registry update lookup. | Any other value, including unset, allows `scripts/update.mjs check` to use fresh cache or query npm [@update-script]. |

## Read Timing

`RUDDER_HOME` is read each time `rudderHome()` runs, `RUDDER_MIGRATIONS_PATH` is read when `openDb()` applies migrations, and `RUDDER_PORT` is read each time `rudderPort()` runs [@db-client]. `POSTHOG_PROJECT_TOKEN`, `POSTHOG_API_KEY`, and `POSTHOG_HOST` are assigned to module-level constants when `src/telemetry.ts` is evaluated [@telemetry]. `telemetryDisabled()` defaults to `process.env` but also accepts an explicit environment object, which makes the `DO_NOT_TRACK` check callable against injected values [@telemetry]. `RUDDER_DISABLE_UPDATE_CHECK` is read when `checkForUpdate()` runs [@update-script].

## State Paths

When `RUDDER_HOME` is unset, the runtime state root is `~/.rudder`; when it is set to a non-empty value, that value becomes the state root [@db-client]. The SQLite database path is always `<rudderHome()>/rudder.db` [@db-client]. Telemetry identity uses the same state root and stores the anonymous id at `<rudderHome()>/identity.json` [@telemetry]. The update helper stores its cache at `<rudderHome()>/update-state.json` [@update-script]. Developers using [Use Prompt Capture](../../guides/runtime/use-prompt-capture) should set `RUDDER_HOME` before opening the database when they need isolated local state.

## Telemetry Disablement

Telemetry requires both a project token and an enabled client path. The internal client factory returns `null` when the selected token is empty or `telemetryDisabled()` returns true [@telemetry]. Because `telemetryDisabled()` checks only `DO_NOT_TRACK === '1'`, values such as `true`, `yes`, `0`, or an empty string do not disable telemetry through that helper [@telemetry].
