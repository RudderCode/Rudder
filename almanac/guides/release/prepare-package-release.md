---
title: "Prepare Package Release"
summary: "Prepare package release explains how to change the plugin package version so the publish and release-alert workflows ship the intended npm, tag, and GitHub Release artifacts."
topics: [guides, release, package, automation, plugin]
sources:
  - id: release-skill
    type: file
    path: .agents/skills/prepare-package-release/SKILL.md
  - id: publish
    type: file
    path: .github/workflows/publish.yml
  - id: release-alert
    type: file
    path: .github/workflows/release-alert.yml
  - id: package
    type: file
    path: package.json
  - id: package-lock
    type: file
    path: package-lock.json
  - id: codex-manifest
    type: file
    path: .codex-plugin/plugin.json
  - id: claude-manifest
    type: file
    path: .claude-plugin/plugin.json
  - id: marketplace
    type: file
    path: .claude-plugin/marketplace.json
  - id: plugin-tests
    type: file
    path: test/plugin-package.test.ts
---

# Prepare Package Release

Prepare a package release when a branch should publish a new `@ruddercode/rudder-plugin` version after merge to `main`. The centralized `prepare-package-release` skill owns the contributor procedure: it synchronizes every version-bearing manifest, ingests the complete change range since the previous release, Gardens the whole CodeAlmanac wiki, validates the package and wiki, and leaves artifact creation to the publish workflow [@release-skill]. The release work is version-driven: `package.json` supplies the package name and version, the release-alert workflow tells the PR whether merge would publish the npm plugin package, create the plugin tag, or create a GitHub Release, and the publish workflow runs on `main` to create the missing artifacts [@package] [@release-alert] [@publish]. The package version also has to stay synchronized across `package-lock.json`, the Codex and Claude plugin manifests, and both marketplace version fields because package tests enforce those values against `package.json` [@package-lock] [@codex-manifest] [@claude-manifest] [@marketplace] [@plugin-tests]. See [Release Automation](../../architecture/release/release-automation), [Artifact-Checked Plugin Publishing](../../decisions/release/artifact-checked-plugin-publishing), [Package Scripts](../../reference/tooling/package-scripts), and [GitHub Workflows](../../reference/automation/github-workflows) for the surrounding reference material.

## Synchronize Version Inputs

Invoke the release-preparation skill whenever a version-bearing manifest changes or a branch with a version bump needs review [@release-skill]. Begin from the complete branch and working-tree diff against `origin/main`, then confirm the intended semantic version before editing [@release-skill]. Use a package version change to signal a user-facing release; the release-alert workflow's no-release PR comment tells contributors to bump `package.json` with `npm version patch --no-git-tag-version` when they intend to ship a user-facing change [@release-alert].

Run `npm version <patch|minor|major|version> --no-git-tag-version`, treating `package.json` as the release version source of truth. Synchronize the resulting exact version into the root and root-package entries in `package-lock.json`, `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`, and both the plugin version and npm source version in `.claude-plugin/marketplace.json` [@release-skill] [@package] [@package-lock] [@codex-manifest] [@claude-manifest] [@marketplace]. Do not create or push a tag: the publish workflow owns `rudder-plugin-v<version>` after merge [@release-skill] [@publish].

## Refresh CodeAlmanac

After the manifests agree, find the most recent `rudder-plugin-v*` tag and define the release range from that tag through `HEAD` [@release-skill]. Do not substitute `origin/main` for this source boundary: changes merged since the previous tag still belong to the new release. Stop and ask for direction if no previous release tag exists [@release-skill].

Run CodeAlmanac Ingest over that committed release range plus the staged and unstaged working-tree diff [@release-skill]. After Ingest completes, run Garden to reconcile the newly captured release knowledge with the rest of the wiki. Wait for both jobs to finish, attaching to their run IDs when they return early, then review all resulting `almanac/**/*.md` and `almanac/topics.yaml` changes [@release-skill]. A no-op is valid when the release contains no durable project knowledge; do not manufacture a version-only wiki edit [@release-skill].

## Choose The Version

The package manifest currently names the package `@ruddercode/rudder-plugin` and stores the release version in the `version` field [@package]. The publish and release-alert workflows both compute `tag="rudder-plugin-v${version}"` from that manifest value [@publish] [@release-alert].

Use the appropriate semver level for the change. Package tests compare `package-lock.json`, `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` plugin metadata, and `.claude-plugin/marketplace.json` npm source metadata against `package.json`, so a release version bump is incomplete until all of those fields match [@plugin-tests].

## Validate Before Merge

Run `codealmanac validate`, `npm run typecheck`, `npm test`, and `npm run build` before relying on automation; when Ingest changes Markdown, also run `npm run format:markdown:check` [@release-skill]. Run `npm run test:coverage` to exercise the same changed-line coverage boundary used by CI and release publishing [@package] [@publish]. The package's `prepublishOnly` script runs typecheck and `npm test`, whose lifecycle rebuilds the hook bundle before the test suite [@package]. The publish workflow adds the release packaging gate by running `npm run test:coverage`, `npm run build`, and `npm pack --dry-run` when a release artifact is missing [@publish]. Those commands are also described in [Run Checks](../contributor/run-checks), and they catch local TypeScript, test, build, coverage, wiki, and packaging failures before the release branch reaches `main`.

Also confirm that the package name remains exactly `@ruddercode/rudder-plugin`. Both release workflows fail before release work if `package.json` contains another name [@publish] [@release-alert].

## Read The Release Alert

On PRs targeting `main`, the release-alert workflow checks whether npmjs.org already has the package version, whether the version's plugin tag exists, and whether a GitHub Release exists for the tag [@release-alert]. It posts or updates a sticky PR comment marked by `<!-- release-alert -->`, so repeated pushes update one comment instead of creating new release notices [@release-alert].

If the alert says merge will release the plugin, verify that the named version and artifact targets are intentional. If it says no plugin release on merge, the current version already has the npm package, plugin tag, and GitHub Release; bump the version before merging if a new release is required [@release-alert].

## What Happens On Main

The publish workflow runs on pushes to `main` and on manual dispatch with concurrency group `publish-rudder-plugin` [@publish]. It reads the manifest version and package name, checks npmjs.org for that package version, checks whether the plugin tag exists, and checks whether the GitHub Release for the tag exists [@publish].

If npmjs.org returns a missing-version response, npm publishing is enabled; if the tag or GitHub Release is missing, those artifacts are created [@publish]. When any release artifact is needed, the workflow installs Node 24, upgrades npm for Trusted Publishers support, runs `npm ci`, writes release telemetry defaults into `src/telemetry-build-config.ts`, validates the package with telemetry disabled, publishes to npmjs.org when needed, pushes the tag when needed, and creates the GitHub Release with generated notes and title `Rudder v<version>` when needed [@publish].

## Recover From A Bad Alert

If the PR alert names an unexpected version, fix `package.json` before merge [@release-alert]. If it says merge would only backfill missing artifacts because the tag already exists, do not merge unless that backfill is intentional [@release-alert]. If the publish workflow cannot determine registry or release state, it emits an error and exits instead of guessing [@publish].
