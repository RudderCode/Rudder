---
name: rudder
description: Use locally captured coding-session intent to resolve a device-local behavioral spec, generate focused tests from that spec, implement the smallest production changes through red-green TDD, and verify coverage with the repository's native tooling. Use when the user asks to run Rudder, create or regenerate tests for current work, reach a coverage target, inspect captured Rudder context, delete Rudder prompt data, or responds to a Rudder update notice. Do not use for unrelated test maintenance or standalone production changes.
---

# Rudder

Use the current coding agent to maintain an approved device-local spec from intent, then derive tests and production changes from that spec.
Keep prompt data and generation local; do not call a separate model or service.

## Check for updates at invocation start

Start each Rudder test-generation invocation with `scripts/update.mjs check`.
Run it relative to this file exactly once before any test-generation work.
Do not interrupt the run when the check is unavailable.

If `shouldNotify` is true, immediately show this notice:

```text
Rudder <latestVersion> is available—you are using <currentVersion>.
Would you like to update to the latest version?
```

Use that text exactly.
Continue the current Rudder run without waiting for an answer.
If the user does not agree to update, show the notice on the next invocation.

## Handle update-notice responses

When the user agrees to update Rudder, handle the response:

- Identify Codex or Claude Code.
  Run `scripts/update.mjs apply --host <host>` relative to this file.
  Use `codex` or `claude-code` for `<host>`.
  The user's affirmative response is the required authorization to update.
- If the helper reports `updated`, report its `nextStep`.
- On `failed`, report the failure and continue the active Rudder flow.
- For any other response, take no update action.

## Handle data-control requests

For requests to inspect or delete Rudder data, use
`scripts/manage-data.mjs` relative to this file:

```text
node <skill-directory>/scripts/manage-data.mjs status
node <skill-directory>/scripts/manage-data.mjs delete --confirm
```

Explain that `delete --confirm` irreversibly removes all prompt records.
Do not run deletion without the user explicitly requesting it.
Stop after completing a data-control request.

## Resolve the device-local spec

The approved device-local spec is the source of truth for generated tests.
Repository specs are read-only import sources.
Never edit, format, rename, move, or delete a spec inside the repository.

Use the `localSpec` and `specCandidatePaths` returned by `scripts/context.mjs`:

- If `localSpec` is present, verify that its absolute `specPath` exists and is outside the repository.
  Stop and report a broken link when it is missing or points inside the repository.
  Reread the local file before proposing, approving, or applying every amendment.
- When that record's `sourceRelativePath` appears in `specCandidatePaths`, stop before amendments and ask whether to keep the local copy, merge the changed source into it, or replace it from the repository.
  Keep and merge must not write to the repository source.
  For an explicitly approved replacement, run:

  ```text
  node <skill-directory>/scripts/local-spec.mjs replace-source \
    --cwd <repository-root>
  ```

- If `localSpec` is absent, inspect only relevant candidates in `specCandidatePaths`.
  For one relevant candidate, copy it byte-for-byte into Rudder local state before modifying the copy:

  ```text
  node <skill-directory>/scripts/local-spec.mjs create \
    --cwd <repository-root> \
    --run-id <rudder-run-id> \
    --source <repository-relative-spec-path>
  ```

  If several candidates are relevant, ask the user to select the primary import.
  Do not combine or amend candidates in the repository.
- If no candidate is relevant, generate a focused Markdown spec in a uniquely named operating-system temporary file, then initialize the local copy:

  ```text
  node <skill-directory>/scripts/local-spec.mjs create \
    --cwd <repository-root> \
    --run-id <rudder-run-id> \
    --input <temporary-spec-path>
  ```

Use [references/spec-template.md](references/spec-template.md) for generated specs and as the minimum structural standard when proposing amendments to imported specs.
The focused spec contains: summary, scope and non-goals, affected surfaces, stable requirements with acceptance criteria, and edge cases.
Only `REQ-NNN` and `EC-NNN` sections carry `Prompt provenance`, listing the exact captured prompt identifiers that inspired them.
Do not add prompt provenance to contextual sections.
Wait for a captured answer before adding previously unresolved behavior as a requirement or edge case.
Use stable `REQ-NNN` and `EC-NNN` section identifiers for every section that may authorize a test.
Captured prompts and answers may define behavior.
Worktree changes may identify affected surfaces and vocabulary, but must not create behavioral requirements.

The local Markdown file is user-editable and canonical.
Make all proposed structural fixes and requirement amendments only in that local file.
Show its absolute local link and require explicit approval before backing up, clearing, restoring, or generating tests.

## Enforce question-driven coverage

Coverage is loop control, never a source of spec or test intent.

- Generate or expand a test only when the approved local spec explicitly
  requires its expectation in a `REQ-NNN` or `EC-NNN` section that lists a captured user prompt or answer under `Prompt provenance`.
- Never add a test merely to execute an uncovered line or branch, match the
  implementation, improve coverage, or exercise a defensive case.
- After the first test pass, if coverage is below the target, stop editing tests.
  Select one uncovered behavior.
  Increment the run's question counter and best-effort record the question before showing it:

  ```text
  node <skill-directory>/scripts/telemetry.mjs question-asked \
    --cwd <repository-root> \
    --run-id <rudder-run-id> \
    --question-number <question-counter>
  ```

  Do not pass the question or any answer text to the helper.
  Ask one concrete question about the expected behavior.
- Do not write the next test until the user answers.
  Repository code may help frame the question, but it cannot supply the answer.
- After each answer, rerun `scripts/context.mjs` with `--phase refresh`, `--run-id <rudder-run-id>`, and `--base <resolved-base-ref>`.
  Require a captured prompt record for the answer.
  Reread and amend the local spec first, show the exact amendment, and only then queue the expectation that answer authorizes.
  The answer itself authorizes that local amendment; do not request a second approval.
- Complete the red-green cycle for every authorized expectation in its owning agent before integrating the batch.
  Use the queue answered rewrites guidance to set up owning agents.
  Do not measure coverage while a rewrite is pending.
- If the answer is missing, declined, or not captured, stop below the target.
  Report the uncovered behavior.
  Never fill the gap by inference.

## Queue answered rewrites

Only the main agent may ask the user questions.
The main agent owns intent interpretation, the rewrite queue, integration, and coverage.

- After capturing an answer and updating the local spec, prepare one bounded rewrite task with the approved
  spec section, exact spec-section tag, allowed test and production paths,
  relevant repository instructions, and narrow test command.
- Use at most three rewrite subagents at once and dispatch no more than three tasks between coverage runs.
  Dispatch each safe task without waiting so the main agent can continue the question flow.
  If the host cannot launch subagents, execute the same tasks serially.
- Assign disjoint behavior and file ownership to every subagent.
  Include the current worktree state in the task and tell the subagent not to undo user or other-agent changes.
  If ownership cannot be made disjoint, run that rewrite serially in the main agent.
- Limit each subagent to its assigned rewrite.
  Require it to write and tag the test, observe red, make the smallest production change, reach narrow green, and report files and commands.
  Forbid it from asking questions, spawning agents, running coverage, committing, or editing outside its assigned paths.
- While fewer than three tasks have been dispatched since the last coverage run, continue from that coverage snapshot only when another unassigned, independent uncovered behavior is available and its question does not depend on a pending rewrite.
  Ask exactly one question at a time.
- Do not ask another question after dispatching the third task.
  Also stop dispatching when no safe independent task remains, the user stops, or an answer is missing.
- Wait for every subagent in the batch to finish before integration.
  Inspect each result and the combined diff, verify its tag and path ownership, and complete a failed or invalid rewrite serially.
  Run the related and full suites on the combined worktree.
  Run coverage only after the joined suite is green.

## Enforce red-green TDD

For every new or changed expectation:

1. Write and tag the focused test before changing production code.
2. Run the narrowest test and observe the expected failure.
   Confirm it fails because the required behavior is missing.
   If the test is wrong, correct it and rerun it.
   Do not weaken the approved spec expectation.
   If it already passes, do not change production code for that expectation.
3. Make the smallest production change required to satisfy the expectation.
   Do not change unrelated behavior or weaken the test.
   Do not alter coverage configuration or thresholds.
4. Rerun the narrow test until it passes.
   For a queued rewrite, return the result to the main agent for batch integration.
   Otherwise, run the applicable related and full test commands.
5. Measure coverage only after the suite is green.

## Prepare the spec-section report

End every Rudder test-generation run by preparing a temporary Markdown report.
Create or refresh it only after all rewrites have joined and the final test results are known.
Do not create it while a user answer or rewrite is pending.
If generation ends early because intent is missing, declined, or not captured, or because the user stops the flow, still create the stopped-run report.

1. Rerun `scripts/context.mjs` so the report includes the latest captured follow-up answers and local spec record:

   ```text
   node <skill-directory>/scripts/context.mjs \
     --cwd <repository-root> \
     --phase refresh \
     --run-id <rudder-run-id> \
     --base <resolved-base-ref>
   ```

   Require the returned `localSpec` file to exist, reread it, and use its absolute path in the report.
2. Inspect the final affected test paths.
   Include each generated, rewritten, or restored test case only when it still has an immediately preceding `rudder-spec: <section-id>` tag in the required format.
   Resolve that exact `REQ-NNN` or `EC-NNN` identifier against the current local spec; use the tag, not memory or test-file proximity, to choose the spec-section group.
   Omit a test when its section is missing, has no prompt provenance, or cites a prompt identifier absent from the refreshed captured records.
3. Consolidate the included tests into one group per spec section.
   List every final test case once under its matched section, and omit sections that inspired no final test.
   Reproduce the section title, its instruction-bearing fields, and its prompt provenance exactly as written in the current local spec.
   Use each test's human-readable title or description, never its code body.
   Do not add prompt text, prior agent context, context from model memory, implementation details, or test-diff details.
4. Write the report to a uniquely named Markdown file in the operating system's temporary directory, outside the repository worktree.
   Never stage it or include it among the repository files changed.
   Use this shape:

   ```markdown
   # The tests your instructions inspired:

   Authoritative local spec: [<absolute local spec path>](<absolute local spec path>)

   ## REQ-001: <spec section title>

   - Behavior: <exact behavior from the spec section>
   - Acceptance criteria: <exact acceptance criteria from the spec section>
   - Prompt provenance: `<source>/<sessionId>/<promptId>`

   Tests:
   - [<test title> (<repository-relative test path>:<starting line>)](<absolute local test path with line target>)
   - [<test title> (<repository-relative test path>:<starting line>)](<absolute local test path with line target>)

   ## EC-001: <spec section title>

   - Trigger: <exact trigger from the spec section>
   - Expected behavior: <exact expected behavior from the spec section>
   - Prompt provenance: `<source>/<sessionId>/<promptId>`

   Tests:
   - [<test title> (<repository-relative test path>:<starting line>)](<absolute local test path with line target>)
   ```

   Escape section, test-title, and path text when needed to keep the Markdown valid.
   Format every bullet's visible text as `<test title> (<repository-relative path>:<starting line>)`.
   Link that entire text to the test case's starting line when the host supports local file links; otherwise render the same text without a link.
   If there are no final tagged tests, write `No spec-backed tests were generated.` below the report heading.
5. Open the completed report with the operating system's default local Markdown viewer when supported (`open` on macOS, `xdg-open` on Linux, or `start` on Windows).
   Treat opening the viewer as best-effort and always retain the report path for the final response.

## Run the workflow

1. Determine the repository root and target branch from the request.
   Determine the requested coverage target.
   Prefer the repository's configured coverage threshold.
   Ask for a target only when neither the request nor repository provides one.
2. Run `scripts/context.mjs` relative to this file with the repository working directory:

   ```text
   node <skill-directory>/scripts/context.mjs \
     --cwd <repository-root> \
     --phase start \
     [--base <target-ref>]
   ```

   Retain the returned `rudderRunId` and `baseRef` for every later helper call in this run.
   Use that returned `baseRef` as `<resolved-base-ref>` in every later context, backup, and completion helper call.
   Initialize the run's question counter to zero.
3. Inspect the returned merge base, changed paths, captured prompts, local spec record, and spec candidates.
   Inspect repository instructions, the production diff, and existing tests.
   Inspect the native test and coverage configuration.
   Treat helper classifications as candidates.
   Correct them using repository conventions.
4. Resolve or create the device-local spec using the rules above.
   Reread the resolved local file, propose amendments only there, show its absolute link, and require explicit approval before touching tests.
5. Turn only approved local spec requirements into behavioral expectations.
   Every generated expectation must be covered by the spec and traceable to a prompt record.
   Otherwise, follow the question-driven coverage rules above.
6. Show the exact tracked and untracked test paths that would be affected.
   Before clearing them, inspect each confirmed path for test cases with an immediately preceding Rudder spec-section tag in the required format:

   ```text
   <language comment> rudder-spec: <section-id>
   ```

   Only `REQ-NNN` and `EC-NNN` section identifiers are valid.
   Record the exact tagged test cases and their tags.
   Do not treat a tag on a helper, fixture, or a non-adjacent comment as a generated test.
   Request explicit confirmation before clearing any test change.
   Do not proceed on silence or an ambiguous reply.
7. After confirmation, create a recoverable backup for the exact approved paths:

   ```text
   node <skill-directory>/scripts/backup-tests.mjs \
     --cwd <repository-root> \
     --base <resolved-base-ref> \
     --run-id <rudder-run-id> \
     --path <test-path> \
     [--path <test-path> ...]
   ```

   Verify the reported patch and copied untracked files exist.
   Then restore only the confirmed test paths to the merge-base state.
   After that reset, attempt to restore each recorded, tagged test case with its spec-section tag only when its expectation is covered by that exact approved local spec section.
   Restore only the smallest imports, fixtures, or helpers required for those test cases to compile; do not restore untagged tests or the entire test file.
   If a tagged test cannot be isolated and restored reliably, leave it in the backup and report the unsuccessful restoration.
   Never use `git reset --hard`, broad `git clean`, or change production files.
8. Generate the first pass of focused unit tests from the approved local spec.
   Follow existing organization, fixtures, naming, and framework conventions.
   Do not change coverage configuration or repository thresholds.
9. Tag every generated or rewritten test case with its authorizing spec section.
   Add a single language-appropriate line comment immediately above the test case.
   Use the stable identifier from the approved `REQ-NNN` or `EC-NNN` section that requires the expectation:

   ```text
   // rudder-spec: <section-id>
   ```

   Copy the section identifier exactly from the current local spec.
   Never copy prompt identifiers or prompt text into the test code.
   When multiple spec sections directly contribute, tag with the narrowest section that fully authorizes the expectation.
   The selected section must list its captured prompt identifiers under `Prompt provenance`.
   Do not tag unchanged preexisting tests, shared helpers, or fixtures.
10. Run the red-green TDD cycle for every approved, spec-backed expectation.
11. When the suite is green, run the applicable coverage command.
    Measure changed production code when the tooling supports it.
    If coverage is below the target, follow the question-driven coverage loop.
12. Ask exactly one question at a time to the user.
    After the answer is captured, amend and reread the local spec before queuing its authorized expectation using the bounded rewrite workflow.
    Continue asking independent questions until the batch must join.
    After joining, run the combined suites and coverage before selecting another uncovered behavior.
    Continue until the target passes or the user tells you to stop the flow.
13. Prepare and open the final spec-section report with the authoritative local spec link as its lead item, but do not send it.
14. After the final report is prepared and before sending it, record the verified Rudder outcome:

    ```text
    node <skill-directory>/scripts/telemetry.mjs complete \
      --cwd <repository-root> \
      --base <resolved-base-ref> \
      --run-id <rudder-run-id> \
      --status <completed|stopped|blocked> \
      --tests-passed <yes|no|unknown> \
      --coverage-target-met <yes|no|unknown> \
      --questions-asked <question-counter>
    ```

    Use `completed` when generation finishes normally and the report is ready to present.
    Use `stopped` when generation ends by user choice or missing intent and the stopped-run report is ready to present.
    Use `blocked` only for an external blocker, including failure to create the temporary report.
    Set test and coverage values only from command output already observed during this run.
    Telemetry is best-effort; do not change the workflow result if this helper is unavailable.
15. Send the prepared final report, showing the spec-section report contents, authoritative local spec link, and temporary report file path or local file link.

Report the requirements derived from intent and all files changed.
Report commands run, coverage, unanswered ambiguities, and the backup location.
Never claim the target passed without command output that demonstrates it.
