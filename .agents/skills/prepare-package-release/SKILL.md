---
name: prepare-package-release
description: Prepare and validate Rudder plugin version bumps, including synchronized package/plugin manifests and a CodeAlmanac wiki refresh. Use whenever changing the version in package.json, package-lock.json, .codex-plugin/plugin.json, .claude-plugin/plugin.json, or .claude-plugin/marketplace.json; when asked to bump, cut, or prepare a Rudder release; or when reviewing a branch that already contains a version bump.
---

# Prepare Package Release

Keep the release version synchronized, update the repository wiki from the
complete release diff, and leave tag and artifact creation to the publish
workflow.

## Follow the workflow

1. Inspect `git status`, the branch diff against `origin/main`, `package.json`,
   the plugin manifests, and the current release guidance:

   ```bash
   git fetch origin main --tags
   git diff --stat origin/main...HEAD
   codealmanac show guides/release/prepare-package-release
   ```

2. Confirm the intended semantic version.
   Treat `package.json` as the release version source of truth.
   Ask the user if the task does not establish the bump level.

3. Run npm's version command without creating a commit or tag:

   ```bash
   npm version <patch|minor|major|version> --no-git-tag-version
   ```

   Synchronize that exact version in:

   - `package-lock.json` at the root `version` and `packages[""].version`;
   - `.codex-plugin/plugin.json`;
   - `.claude-plugin/plugin.json`;
   - `.claude-plugin/marketplace.json` at both the plugin version and npm source
     version.

   Do not create or push a release tag.
   The publish workflow creates the tag and GitHub Release after merge.

4. Find the previous release tag after the manifests are synchronized:

   ```bash
   previous_release_tag="$(
     git describe --tags --match 'rudder-plugin-v*' --abbrev=0
   )"
   release_range="${previous_release_tag}..HEAD"
   ```

   Stop and ask the user if no previous release tag exists.
   Do not use `origin/main` as the source boundary.
   Merged changes since the previous tag still belong to the release.

5. Run CodeAlmanac Ingest for every version bump.
   Give it the complete committed release range plus staged and unstaged edits:

   ```bash
   guidance="Update durable release knowledge and version claims."
   guidance+=" A no-op is valid."
   codealmanac ingest "git:range:${release_range}" git:diff \
     --title "Document Rudder release <version>" \
     --guidance "$guidance"
   ```

   Wait for the ingest job to finish.
   Use `codealmanac jobs attach <run-id>` if the command returns early.

6. Run Garden after Ingest.
   Ingest defines the release source boundary.
   Garden reconciles that knowledge with the rest of the wiki:

   ```bash
   codealmanac garden \
     --title "Garden after Rudder release <version>" \
     --guidance "Reconcile the wiki after ingesting ${release_range}."
   ```

   Wait for the Garden job to finish or attach to its run ID.
   Review all resulting `almanac/**/*.md` and `almanac/topics.yaml` changes.
   Accept a no-op when the release adds no durable knowledge.
   Do not manufacture a wiki edit solely to record a version number.

7. Validate the wiki and package:

   ```bash
   codealmanac validate
   npm run typecheck
   npm test
   npm run build
   ```

   Also run `npm run format:markdown:check` when CodeAlmanac changed Markdown.

8. Review the complete diff:

   ```bash
   git diff --check
   git diff --stat origin/main...HEAD
   git diff
   ```

   Confirm all version-bearing manifests match `package.json`, CodeAlmanac
   completed successfully or explicitly made a valid no-op, no local release
   tag was created, and generated `dist/` output is not included.

## Report the result

State the old and new versions, list synchronized manifests, summarize the
CodeAlmanac outcome and any wiki pages changed, report wiki/package validation,
and note that publishing, tagging, and GitHub Release creation occur after
merge.
