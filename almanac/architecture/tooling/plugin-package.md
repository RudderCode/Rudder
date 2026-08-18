---
title: "Rudder Plugin Package"
summary: "The root npm package distributes Rudder as one Claude Code and Codex plugin with manifests, hooks, skill files, docs, assets, a prompt-capture and telemetry runtime, and local spec helpers."
topics: [architecture, tooling, package, plugin, prompt-capture, local-spec, release]
sources:
  - id: package-json
    type: file
    path: package.json
  - id: claude-manifest
    type: file
    path: .claude-plugin/plugin.json
  - id: codex-manifest
    type: file
    path: .codex-plugin/plugin.json
  - id: marketplace
    type: file
    path: .claude-plugin/marketplace.json
  - id: hooks
    type: file
    path: hooks/hooks.json
  - id: hook-bin
    type: file
    path: bin/rudder-prompt-hook.ts
  - id: skill
    type: file
    path: skills/rudder/SKILL.md
  - id: local-spec-script
    type: file
    path: skills/rudder/scripts/local-spec.mjs
  - id: spec-template
    type: file
    path: skills/rudder/references/spec-template.md
  - id: skill-telemetry
    type: file
    path: skills/rudder/scripts/telemetry.mjs
  - id: rudder-telemetry
    type: file
    path: src/rudder-telemetry.ts
  - id: plugin-tests
    type: file
    path: test/plugin-package.test.ts
  - id: install-doc
    type: file
    path: docs/install.md
  - id: publish-workflow
    type: file
    path: .github/workflows/publish.yml
---

# Rudder Plugin Package

The repository root is the publishable Rudder plugin package.
`package.json` names the package `@ruddercode/rudder-plugin`, requires Node `>=24.0.0`, and includes `.claude-plugin`, `.codex-plugin`, `assets`, `docs`, `hooks`, `skills`, `dist`, and `LICENSE` in the npm file allowlist [@package-json].
The package carries Claude Code and Codex plugin manifests, a public marketplace catalog that points at the npm package, the Rudder skill and helper scripts, and one bundled runtime used for prompt capture and bounded product telemetry [@claude-manifest] [@codex-manifest] [@marketplace] [@hooks] [@skill] [@skill-telemetry] [@rudder-telemetry].
The current package does not distribute an MCP server or MCP App: both plugin manifests omit `mcpServers`, the package allowlist excludes `.mcp.json` and `.claude-mcp.json`, the Codex interface exposes `Write` without `Interactive`, and package tests assert that the build script contains no MCP or `rudder-app` step [@claude-manifest] [@codex-manifest] [@package-json] [@plugin-tests].

## Distribution Shape

The Claude manifest and Codex manifest share the public plugin name `rudder`, version, description, license, repository, keywords, and `./skills/` path [@claude-manifest] [@codex-manifest].
Plugin hooks remain at the host-discovered default path `hooks/hooks.json`; package tests assert that neither manifest declares a duplicate `hooks` field and that both manifests omit `mcpServers` [@hooks] [@plugin-tests].
The Codex manifest carries interface metadata such as display name, short description, category, default prompt, icon, logo, privacy URL, terms URL, and the `Write` capability [@codex-manifest].

The marketplace catalog under `.claude-plugin/marketplace.json` lists one plugin named `rudder` and resolves it from npm package `@ruddercode/rudder-plugin` on the public npm registry [@marketplace].
Tests enforce that the package version is synchronized across `package.json`, `package-lock.json`, both plugin manifests, and both marketplace version fields [@plugin-tests].
The install docs describe Claude Code and Codex marketplace installation separately but state that both use the same npm-backed plugin package [@install-doc].

## Bundled Hook

`hooks/hooks.json` registers command hooks for `UserPromptSubmit` and `Stop` [@hooks].
Each command executes Node with `--input-type=module`, resolves the plugin root from `PLUGIN_ROOT` or `CLAUDE_PLUGIN_ROOT`, and imports `dist/rudder-prompt-hook.mjs` from that root [@hooks].
In ordinary hook mode, the source executable reads JSON from stdin, infers Codex from `PLUGIN_ROOT` or Claude Code from `CLAUDE_PLUGIN_ROOT`, sets `RUDDER_MIGRATIONS_PATH` to the installed `dist/drizzle` folder, and records the prompt lifecycle event [@hook-bin].

The same executable has an internal `--rudder-event` mode for the validated Rudder usage events in `src/rudder-telemetry.ts` [@hook-bin] [@rudder-telemetry].
`skills/rudder/scripts/telemetry.mjs` launches that bundled artifact as a detached best-effort child for run, context, backup, question, and completion metadata without exposing PostHog to the skill process [@skill-telemetry].
Both modes catch top-level failures, report exceptions best-effort, close any database handle, shut down telemetry, and avoid model-visible output [@hook-bin].

The `build` script creates installed runtime artifacts by bundling `bin/rudder-prompt-hook.ts` with esbuild for Node ESM output and then copying committed Drizzle migrations into `dist/drizzle` [@package-json].
`pretest`, `test:coverage`, and `prepack` build before their downstream work, so tests, coverage, and packed artifacts use fresh package output [@package-json].
Plugin package tests enforce matching Claude/Codex metadata, required package file entries including the local spec helper and spec template, marketplace npm source fields, hook command shape, absence of MCP/App packaging, and silent prompt-hook execution for both `PLUGIN_ROOT` and `CLAUDE_PLUGIN_ROOT` environments [@plugin-tests] [@local-spec-script] [@spec-template].

## Local Spec Assets

The installed skill now resolves an approved device-local spec before generating tests [@skill].
`skills/rudder/scripts/local-spec.mjs` is shipped as a skill helper so the host agent can copy one repository spec or generated temporary Markdown file into Rudder local state, and `skills/rudder/references/spec-template.md` is shipped as the minimum structure for generated specs and amendments [@local-spec-script] [@spec-template] [@plugin-tests].
This asset boundary is part of the plugin package because the generated tests are now tagged to spec sections rather than directly to prompt records [@skill].

## Release Boundary

The publish workflow expects the root package name to be exactly `@ruddercode/rudder-plugin`, checks npmjs.org for the version, creates plugin tags in the `rudder-plugin-v<version>` form, and validates the package with agent layout, typecheck, 90% changed-line coverage, build, and `npm pack --dry-run` before publishing [@publish-workflow] [@package-json].
The release behavior is covered in [Release Automation](../release/release-automation), and the command surface is listed in [Package Scripts](../../reference/tooling/package-scripts).
