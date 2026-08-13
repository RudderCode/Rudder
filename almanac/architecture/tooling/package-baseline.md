---
title: "Package Baseline"
summary: "The package baseline defines Rudder's scoped ESM plugin package, validation scripts, bundled hook output, dependency set, and publishable files."
topics: [architecture, tooling, package, typescript, plugin]
sources:
  - id: package-json
    type: file
    path: package.json
  - id: tsconfig
    type: file
    path: tsconfig.json
  - id: hook-bin
    type: file
    path: bin/rudder-prompt-hook.ts
  - id: plugin-tests
    type: file
    path: test/plugin-package.test.ts
  - id: gitignore
    type: file
    path: .gitignore
---

Rudder's package baseline is the repo's build and distribution frame for the plugin. The package is published as `@ruddercode/rudder-plugin`, uses ESM, requires Node `>=24.0.0`, bundles the prompt-capture and telemetry entrypoint to `dist/rudder-prompt-hook.mjs`, copies generated Drizzle migrations into `dist/drizzle`, and includes plugin manifests, assets, docs, hooks, skills, `dist`, and `LICENSE` in the npm file allowlist [@package-json] [@hook-bin]. That baseline connects runtime, plugin, and tooling work to [Contributor Automation](../automation/contributor-automation), because the package scripts define the command set those pages reuse [@package-json].

## Package Contract

`package.json` is the public package contract. It names the package, carries the current release version, declares the Apache-2.0 license and GitHub repository metadata, sets the supported Node engine, and defines package scripts plus the package file allowlist [@package-json]. The manifest intentionally carries plugin artifacts rather than a `main`, `types`, or package-root `exports` entry; plugin hosts load the installed hook through `hooks/hooks.json`, while tests enforce that the manifest does not define runtime dependencies or npm workspaces [@package-json] [@plugin-tests].

The package file allowlist keeps distribution narrow but plugin-complete. `.claude-plugin`, `.codex-plugin`, `assets`, `docs`, `hooks`, `skills`, `dist`, and `LICENSE` ship with the package [@package-json]. Build output and transient development files are excluded from the working tree by `.gitignore`, which ignores `node_modules/`, `dist/`, TypeScript build info, logs, `.env` files except `.env.example`, coverage, and common editor files [@gitignore].

## TypeScript Shape

The TypeScript configuration targets `ES2023`, uses `NodeNext` module and module-resolution behavior, enables `strict`, sets Node types, and includes `bin/**/*.ts`, `dangerfile.ts`, and `src/**/*.ts` [@tsconfig]. The configuration uses `noEmit: true`; package build output comes from esbuild, not from a separate TypeScript emit overlay [@tsconfig] [@package-json].

The bundled hook imports repository runtime modules from `bin/rudder-prompt-hook.ts` and selects prompt-capture or internal Rudder-event mode from its arguments [@hook-bin]. The `build` script bundles that entrypoint for Node ESM output before copying migrations [@package-json]. The companion [TypeScript build reference](../../reference/tooling/typescript-build) records the exact compiler and bundle contract as lookup material.

## Scripts And Validation

The baseline includes scripts for migration generation, markdown formatting, Danger, agent-layout validation, typechecking, package bundling, tests, changed-line coverage, packing, and publishing [@package-json]. `typecheck` runs `tsc --noEmit`, `test` runs Node's built-in test runner, `test:coverage` builds and runs that suite under c8 before requiring 90% coverage on changed and untracked lines with `diff-cover`, `pretest` rebuilds the package artifacts, `build` clears `dist`, bundles the prompt hook, and copies `drizzle/`, and `prepack` rebuilds before npm packing [@package-json]. The package-level script contract is described in [Package Scripts](../../reference/tooling/package-scripts).

This structure makes the package baseline small but not inert. Future runtime or hook code must fit the existing NodeNext TypeScript model, keep generated package artifacts under `dist`, keep generated migrations available to installed hook code, and keep the validation scripts green before package publication [@tsconfig] [@package-json].

## Dependency Boundary

The root package currently lists Drizzle ORM, PostHog's Node client, c8, diff-cover, esbuild, Danger, rumdl, TypeScript, Drizzle Kit, and Node type definitions as development dependencies, with Drizzle ORM and Drizzle Kit pinned to `1.0.0-rc.4` [@package-json]. c8 produces LCOV for all configured TypeScript and skill-script sources, while diff-cover compares that report with Git changes [@package-json]. Because the hook bundle is self-contained and `package.json` has no runtime `dependencies` field, changing dependency scope should be treated as a package-contract change and checked against [Rudder Plugin Package](plugin-package) [@package-json] [@plugin-tests].

Package changes should be read together with [contributor automation](../automation/contributor-automation). That page explains how local check surfaces and GitHub Actions reuse the `typecheck`, `test`, and `build` scripts documented here.
