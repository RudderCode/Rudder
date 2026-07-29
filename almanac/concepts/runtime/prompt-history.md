---
title: "Prompt History"
summary: "Prompt history is Rudder's local prompt context for intent-driven test generation, stored per agent prompt and reconciled to the active Git branch."
topics: [concepts, product-intent, prompt-history, prompt-capture]
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
  - id: readme
    type: file
    path: README.md
---

# Prompt History

Prompt history is Rudder's local record of prompt context that can explain user intent for generated tests. The README says coding-session prompts and follow-up answers can name expected behavior, edge cases, and tradeoffs that never appear in code diffs [@readme]. The implemented runtime stores submitted prompt text in `prompt_branches`, associates each prompt with source/session/prompt IDs, repository, branch, timestamps, and optional previous agent output, and exposes lookup helpers for session and branch context [@schema] [@prompt-tagger].

## Product Meaning

The README describes Rudder as running inside the same coding-agent session where the feature was built, using that session context plus worktree changes to create tests for new production code [@readme]. In that product model, prompt history is behavioral evidence: it carries the user's stated expectations and the answers to later clarification questions [@readme].

The current implementation gives the [Rudder Skill Runtime](../../architecture/runtime/rudder-skill-runtime) local prompt context for that model. The skill still asks the host coding agent to reason about behavior, inspect tests, generate new tests, and interpret coverage; prompt history is evidence for those steps, not an automatic test oracle [@context-script].

## Capture Model

Prompt capture starts from coding-agent hooks. `recordPromptHookEvent()` normalizes Claude Code, Codex, and Cursor payloads, records prompt text on submit events, and reconciles the prompt to the active branch on stop events [@prompt-hook]. When a submit payload includes `transcript_path`, the hook reads the latest visible assistant text from that JSONL transcript and stores it as `previous_agent_output` when one is found [@prompt-hook] [@transcript].

`recordPromptBranch()` writes the submitted prompt with the branch active before the turn runs, while `reconcilePromptBranch()` updates the row to the branch active after the turn and sets `reconciled_at` [@prompt-tagger]. Replaying the same source/session/prompt ID updates prompt text, keeps the earliest submission time, and preserves the first non-null previous agent output by coalescing the stored value with the replayed one [@prompt-tagger].

## Working Implication

When updating the product workflow, treat prompt history as local and branch-scoped. `skills/rudder/scripts/context.mjs` reads prompt identifiers, text, and timestamps for the resolved repository and branch from `prompt_branches` and returns them beside the branch diff, so the skill can combine implementation changes with user-stated intent [@context-script]. The table can store `previous_agent_output`, but the current context helper does not include that field in the skill JSON; using previous agent output in `$rudder` requires changing the helper and its tests, not just reading the stored rows [@schema] [@context-script]. Use [Prompt Branch Store](../../architecture/runtime/prompt-branch-store), [Prompt Branches Schema](../../reference/database/prompt-branches-schema), and [Use Prompt Capture](../../guides/runtime/use-prompt-capture) for current implementation work.
