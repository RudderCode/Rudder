---
title: "CodeAlmanac Maintenance"
summary: "This reference records how to verify Rudder's local CodeAlmanac maintenance state, with dated snapshots for scheduled automation and the wiki-source commit boundary."
topics: [reference, wiki, automation]
sources:
  - id: automation-session
    type: conversation
    path: /Users/vivek/.codex/sessions/2026/07/22/rollout-2026-07-22T11-37-04-019f8a79-2786-7200-bc5f-4d94980ab0fc.jsonl
    title: "CodeAlmanac automation setup transcript"
  - id: live-garden-snapshot
    type: conversation
    path: /Users/vivek/.codex/sessions/2026/07/29/rollout-2026-07-29T17-12-22-019fafb8-a3c6-7f11-9b38-0b5430c6ce08.jsonl
    title: "CodeAlmanac Garden live-state transcript"
  - id: ingest-manual
    type: manual
    path: ingest.md
    title: "Ingest manual"
  - id: garden-manual
    type: manual
    path: garden.md
    title: "Garden manual"
  - id: sources-manual
    type: manual
    path: sources.md
    title: "Sources manual"
---

CodeAlmanac maintenance for Rudder is user-scoped local automation, not a per-PR documentation requirement. Treat this page as a verification reference: run `codealmanac config list` and `codealmanac automation status` in the repository before depending on telemetry, scheduled jobs, or `auto_commit`, because those settings live outside the committed wiki source [@automation-session] [@live-garden-snapshot]. For broader repository routing, use [Getting Started](../../getting-started).

## Verify Live State

Start with `codealmanac config list`. Check `telemetry.enabled`, `auto_commit`, `automation.sync.enabled`, `automation.garden.enabled`, `automation.update.enabled`, and the matching `*.every` intervals before describing local maintenance state as current [@live-garden-snapshot].

Then run `codealmanac automation status`. Check whether the sync, garden, and update LaunchAgents are installed, loaded, idle or running, and whether their last result succeeded [@live-garden-snapshot]. The current LaunchAgent paths use `/Users/vivek/Library/LaunchAgents/com.codealmanac.sync.plist`, `com.codealmanac.garden.plist`, and `com.codealmanac.update.plist` when installed [@live-garden-snapshot].

## Dated Snapshots

On July 22, 2026, the setup transcript recorded transcript sync and garden automation as enabled, update automation as not installed, telemetry as disabled, and `auto_commit` as enabled [@automation-session]. That snapshot is historical evidence, not a standing claim about the user's current machine state.

On July 29, 2026, a Garden run observed `telemetry.enabled true`, `automation.sync.enabled true`, `automation.garden.enabled true`, `automation.update.enabled true`, and `auto_commit true`; `codealmanac automation status` also reported sync, garden, and update automation installed, loaded, idle, and last succeeded [@live-garden-snapshot].

## Commit Boundary

The user allowed CodeAlmanac to create its own commits for the repository knowledge base, after which `codealmanac config set auto_commit true` succeeded [@automation-session]. Treat that permission as scoped to wiki-source maintenance under `almanac/`; the automation setup did not authorize unrelated repository commits [@automation-session].

When reviewing automated work, inspect `almanac/**/*.md` and `almanac/topics.yaml`, then run `codealmanac validate`. The Ingest manual allows a no-op when selected material adds no durable wiki knowledge, Garden defines graph cleanup work, and Sources treats transcripts, PRs, and diffs as raw material rather than automatic wiki content [@ingest-manual] [@garden-manual] [@sources-manual].

## Useful Commands

| Task | Command |
| --- | --- |
| Check local configuration | `codealmanac config list` |
| Check scheduled job installation and results | `codealmanac automation status` |
| Inspect recent maintenance jobs | `codealmanac jobs --limit 8` |
| Attach to a running job | `codealmanac jobs attach <run-id>` |
| Validate wiki source after edits | `codealmanac validate` |
