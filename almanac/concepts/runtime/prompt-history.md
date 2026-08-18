---
title: "Prompt History"
summary: "Prompt history is Rudder's local prompt context for intent-driven test generation, stored per agent prompt and used as provenance for approved local spec sections."
topics: [concepts, product-intent, prompt-history, prompt-capture, local-spec]
sources:
  - id: schema
    type: file
    path: src/db/schema.ts
  - id: prompt-tagger
    type: file
    path: src/prompt-tagger.ts
  - id: prompt-hook
    type: file
    path: src/prompt-hook.ts
  - id: transcript
    type: file
    path: src/transcript.ts
  - id: context-script
    type: file
    path: skills/rudder/scripts/context.mjs
  - id: skill
    type: file
    path: skills/rudder/SKILL.md
  - id: local-spec-script
    type: file
    path: skills/rudder/scripts/local-spec.mjs
  - id: readme
    type: file
    path: README.md
---

# Prompt History

Prompt history is Rudder's local record of prompt context that can explain user intent for generated tests.
The README says coding-session prompts and follow-up answers can name expected behavior, edge cases, and tradeoffs that never appear in code diffs [@readme].
The implemented runtime stores submitted prompt text in `prompt_branches`, associates each prompt with source/session/prompt IDs, repository, branch, timestamps, and optional previous agent output, and exposes lookup helpers for session and branch context [@schema] [@prompt-tagger].
The installed skill now uses those prompt identifiers as provenance inside the approved local spec, while generated tests tag the spec sections that authorize them [@skill] [@local-spec-script].

## Product Meaning

The README describes Rudder as running inside the same coding-agent session where the feature was built, using that session context plus worktree changes to create tests for new production code [@readme].
In that product model, prompt history is behavioral evidence: it carries the user's stated expectations and the answers to later clarification questions [@readme].

The current implementation gives the [Rudder Skill Runtime](../../architecture/runtime/rudder-skill-runtime) local prompt context for that model.
The skill still asks the host coding agent to reason about behavior, inspect tests, generate new tests, and interpret coverage; prompt history is evidence for local spec sections, not an automatic test oracle [@context-script] [@skill].
At the end of a Rudder run, the final report resolves each test's `rudder-spec` tag to a spec section, then checks that the section's prompt provenance cites prompt identifiers present in the refreshed prompt history [@skill] [@context-script].

## Capture Model

Prompt capture starts from coding-agent hooks.
`recordPromptHookEvent()` normalizes Claude Code, Codex, and Cursor payloads, records prompt text on submit events, and reconciles the prompt to the active branch on stop events [@prompt-hook].
When a submit payload includes `transcript_path`, the hook reads the latest visible assistant text from that JSONL transcript and stores it as `previous_agent_output` when one is found [@prompt-hook] [@transcript].

`recordPromptBranch()` writes the submitted prompt with the branch active before the turn runs, while `reconcilePromptBranch()` updates the row to the branch active after the turn and sets `reconciled_at` [@prompt-tagger].
Replaying the same source/session/prompt ID updates prompt text, keeps the earliest submission time, and preserves the first non-null previous agent output by coalescing the stored value with the replayed one [@prompt-tagger].

## Working Implication

When updating the product workflow, treat prompt history as local and branch-scoped.
`skills/rudder/scripts/context.mjs` reads prompt identifiers, exact text, previous agent output, submission time, and reconciliation time for the resolved repository and branch from `prompt_branches` and returns them beside the branch diff, spec candidates, and optional local spec record [@context-script].
The skill uses prompt identifiers as `Prompt provenance` inside approved `REQ-NNN` and `EC-NNN` spec sections; it does not copy prompt identifiers or prompt text into test code, and it does not infer missing provenance from the implementation or model memory [@skill].
Use [Prompt Branch Store](../../architecture/runtime/prompt-branch-store), [Prompt Branches Schema](../../reference/database/prompt-branches-schema), [Local Spec Store](../../architecture/runtime/local-spec-store), and [Use Prompt Capture](../../guides/runtime/use-prompt-capture) for current implementation work.
