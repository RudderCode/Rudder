---
title: "Telemetry Architecture"
summary: "Rudder telemetry uses a release-configured PostHog client, protected local identity, installation-scoped pseudonyms, and metadata-only prompt, spec, and run events with best-effort dispatch."
topics: [architecture, runtime, telemetry, configuration]
sources:
  - id: telemetry
    type: file
    path: src/telemetry.ts
  - id: rudder-telemetry
    type: file
    path: src/rudder-telemetry.ts
  - id: telemetry-build-config
    type: file
    path: src/telemetry-build-config.ts
  - id: publish-workflow
    type: file
    path: .github/workflows/publish.yml
  - id: prompt-hook
    type: file
    path: src/prompt-hook.ts
  - id: hook-bin
    type: file
    path: bin/rudder-prompt-hook.ts
  - id: skill-telemetry
    type: file
    path: skills/rudder/scripts/telemetry.mjs
  - id: telemetry-tests
    type: file
    path: test/rudder-telemetry.test.ts
  - id: context-script
    type: file
    path: skills/rudder/scripts/context.mjs
  - id: local-spec-script
    type: file
    path: skills/rudder/scripts/local-spec.mjs
  - id: backup-script
    type: file
    path: skills/rudder/scripts/backup-tests.mjs
  - id: package-json
    type: file
    path: package.json
---

Rudder telemetry is a metadata-only runtime path built around `posthog-node`.
`src/telemetry.ts` owns enablement, local identity, common event properties, installation-scoped pseudonymization, capture, exception reporting, and shutdown; `src/rudder-telemetry.ts` validates and translates Rudder run events; prompt hooks and skill helpers supply only the bounded inputs those layers accept [@telemetry] [@rudder-telemetry] [@prompt-hook] [@local-spec-script] [@skill-telemetry].
Source builds keep the built-in token and host empty, while the publish workflow rewrites `src/telemetry-build-config.ts` in the release workspace before bundling so published hooks can carry release telemetry defaults [@telemetry-build-config] [@publish-workflow].
The package keeps `posthog-node` as a development dependency because esbuild includes it in the bundled hook rather than exposing a runtime dependency [@package-json].

## Enablement Boundary

Telemetry enablement is decided before a client or event-property factory is used.
The module chooses the project token from `POSTHOG_PROJECT_TOKEN` and then `BUILT_IN_POSTHOG_PROJECT_TOKEN`; it no longer reads `POSTHOG_API_KEY` [@telemetry].
It chooses the host from `POSTHOG_HOST`, then `BUILT_IN_POSTHOG_HOST`, then `https://us.i.posthog.com` [@telemetry] [@telemetry-build-config].
`telemetryDisabled()` checks exactly `DO_NOT_TRACK === '1'` [@telemetry].
The internal `client()` returns `null` when the selected token is empty or telemetry is disabled, so capture calls remain no-ops and do not evaluate their lazy property factories on a disabled path [@telemetry].

When a client is created, it is cached in `_client` and configured with the selected host, `flushAt: 1`, `flushInterval: 0`, and exception autocapture enabled [@telemetry].
The flush settings fit short-lived CLI invocations because each event is sent immediately instead of waiting for a larger batch [@telemetry].

## Identity And Pseudonyms

Telemetry does not use a user account identity.
`identity.json` under `rudderHome()` stores a stable anonymous UUID plus a local-only random pseudonymization key [@telemetry].
The loader preserves an existing non-empty `id`, fills either missing field, and upgrades the older `{ id }` shape by adding `pseudonymization_key` [@telemetry].
Persistence is best-effort, but when supported the Rudder home is restricted to mode `0700` and the identity file to mode `0600` [@telemetry].

Repository, branch, and run identifiers are not sent raw.
`pseudonymize()` uses HMAC-SHA256 over a namespace, a null separator, and the source value with the installation's local key [@telemetry].
Repository pseudonyms are stable only within one installation, branch pseudonyms include the repository and branch, and run pseudonyms include repository, branch, and run ID [@rudder-telemetry].
That keeps events joinable for one installation without making private identifiers readable or correlatable across installations.

Every ordinary event receives `telemetry_schema_version` and the current `rudder_version`; exception events receive those common properties as well [@telemetry].
The version is read from `package.json` at runtime and falls back to `unknown` if the manifest cannot be read [@telemetry].

## Event Boundary

Prompt lifecycle events are emitted directly by `src/prompt-hook.ts`, while Rudder workflow events pass through the strict schemas in `src/rudder-telemetry.ts` [@prompt-hook] [@rudder-telemetry].

| Event | Bounded properties |
| --- | --- |
| `rudder prompt captured` | Agent source, whether this is the first captured prompt in the session, the session's captured-prompt count, and whether previous agent output was stored [@prompt-hook]. |
| `rudder prompt reconciled` | Agent source and whether the repository branch changed across the prompt turn [@prompt-hook]. |
| `rudder run started` / `rudder context refreshed` | Host, installation-scoped repository/branch/run pseudonyms, local-repository flag, captured and reconciled prompt counts, prompt-source counts, changed-path counts, untracked-path count, and test-line additions/deletions from the merge base [@rudder-telemetry] [@context-script]. |
| `rudder spec created` | Run pseudonyms and host for a newly created local spec record; the helper does not send spec content, source paths, or local spec paths [@rudder-telemetry] [@local-spec-script]. |
| `rudder test backup created` | Run pseudonyms, host, approved test-path count, and copied untracked test-path count [@rudder-telemetry] [@backup-script]. |
| `rudder question asked` | Run pseudonyms, host, and a positive question ordinal [@rudder-telemetry] [@skill-telemetry]. |
| `rudder run finished` | Run pseudonyms, host, bounded completion/test/coverage states, final changed-path counts, recognized `rudder-spec` tag count in changed test paths, test-line additions/deletions, and total questions asked [@rudder-telemetry] [@skill-telemetry]. |

These schemas omit raw prompt and answer text, previous agent output, raw repository, branch, and run identifiers, model and token usage, tool activity, and cost [@prompt-hook] [@rudder-telemetry].
Telemetry tests assert that `rudder spec created` drops spec origin, source path, local spec path, and spec contents, and that `rudder run finished` exposes `spec_backed_test_count` and question count without raw repository, branch, or run identifiers [@telemetry-tests].
The question helper receives only the run ID and ordinal, and the completion helper derives path, tag, and line counts from Git and the worktree instead of accepting arbitrary analytics properties [@skill-telemetry].
The completion helper counts only standalone tag comments whose body is `rudder-spec: REQ-NNN` or `rudder-spec: EC-NNN` using `//`, `#`, `--`, `;`, or block-comment delimiters; deleted, binary, and unreadable changed test paths contribute zero tags [@skill-telemetry].

## Dispatch And Failure Boundary

The installed skill does not import PostHog directly.
`skills/rudder/scripts/telemetry.mjs` serializes a bounded payload and starts the bundled `dist/rudder-prompt-hook.mjs` with `--rudder-event <event>` as a detached, unreferenced child whose stdio is ignored [@skill-telemetry].
Missing bundles, serialization failures, spawn errors, and an unresponsive telemetry receiver do not block the Rudder workflow [@skill-telemetry].
The context helper emits start or refresh events, the local spec helper emits `spec-created` after creating the SQLite mapping, the backup helper emits its event after recovery metadata exists, and the telemetry CLI records question ordinals and final run outcomes [@context-script] [@local-spec-script] [@backup-script] [@skill-telemetry].

The bundled hook selects either Rudder-event mode or ordinary prompt-capture mode from its arguments, parses one JSON payload from stdin, and uses the same telemetry shutdown path for both [@hook-bin].
All top-level hook failures are caught; exception capture, database close, and telemetry shutdown are each best-effort so neither prompt capture nor product telemetry interrupts the host coding agent [@hook-bin].
`shutdown()` awaits the cached PostHog client's close and clears the client reference [@telemetry].
The exact environment-variable behavior is listed in [Environment Variables](../../reference/configuration/environment-variables).
