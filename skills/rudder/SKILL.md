---
name: rudder
description: Use locally captured coding-session intent to generate focused tests, implement the smallest production changes through red-green TDD, and verify coverage with the repository's native tooling. Use when the user asks to run Rudder, create or regenerate tests for current work, reach a coverage target, inspect captured Rudder context, delete Rudder prompt data, or responds to a Rudder update notice. Do not use for unrelated test maintenance or standalone production changes.
---

# Rudder

Use the current coding agent to derive tests and production changes from intent.
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

## Enforce question-driven coverage

Coverage is loop control, never a source of test intent.

- Generate or expand a test only when a captured user prompt or answer
  explicitly requires its expectation.
- Never add a test merely to execute an uncovered line or branch, match the
  implementation, improve coverage, or exercise a defensive case.
- After the first test pass, if coverage is below the target, stop editing tests.
  Select one uncovered behavior.
  Ask one concrete question about the expected behavior.
- Do not write the next test until the user answers.
  Repository code may help frame the question, but it cannot supply the answer.
- After each answer, rerun `scripts/context.mjs`, require a captured prompt
  record for the answer, and add only the expectation that answer authorizes.
- Complete the red-green cycle before measuring coverage or asking another
  question.
- If the answer is missing, declined, or not captured, stop below the target.
  Report the uncovered behavior.
  Never fill the gap by inference.

## Enforce red-green TDD

For every new or changed expectation:

1. Write and tag the focused test before changing production code.
2. Run the narrowest test and observe the expected failure.
   Confirm it fails because the required behavior is missing.
   If the test is wrong, correct it and rerun it.
   Do not weaken the prompt-backed expectation.
   If it already passes, do not change production code for that expectation.
3. Make the smallest production change required to satisfy the expectation.
   Do not change unrelated behavior or weaken the test.
   Do not alter coverage configuration or thresholds.
4. Rerun the narrow test until it passes.
   Then run the applicable related and full test commands.
5. Measure coverage only after the suite is green.

## Run the workflow

1. Determine the repository root and target branch from the request.
   Determine the requested coverage target.
   Prefer the repository's configured coverage threshold.
   Ask for a target only when neither the request nor repository provides one.
2. Run `scripts/context.mjs` relative to this file with the repository working
   directory:

   ```text
   node <skill-directory>/scripts/context.mjs \
     --cwd <repository-root> \
     [--base <target-ref>]
   ```

3. Inspect the returned merge base, changed paths, and captured prompts.
   Inspect repository instructions, the production diff, and existing tests.
   Inspect the native test and coverage configuration.
   Treat helper classifications as candidates.
   Correct them using repository conventions.
4. Turn only directly expressed, captured user intent into behavioral requirements.
   Every generated expectation must be traceable to a prompt record.
   Otherwise, follow the question-driven coverage rules above.
5. Show the exact tracked and untracked test paths that would be affected.
   Before clearing them, inspect each confirmed path for test cases with an
   immediately preceding Rudder source-intent tag in the required format:

   ```text
   <language comment> <source>/<sessionId>/<promptId>
   ```

   Record the exact tagged test cases and their tags. Do not treat a tag on a
   helper, fixture, or a non-adjacent comment as a generated test.
   Request explicit confirmation before clearing any test change.
   Do not proceed on silence or an ambiguous reply.
6. After confirmation, create a recoverable backup for the exact approved paths:

   ```text
   node <skill-directory>/scripts/backup-tests.mjs \
     --cwd <repository-root> \
     --base <target-ref> \
     --path <test-path> \
     [--path <test-path> ...]
   ```

   Verify the reported patch and copied untracked files exist.
   Then restore only the confirmed test paths to the merge-base state.
   After that reset, attempt to restore each recorded, tagged test case with
   its intent tag. Restore only the smallest imports, fixtures, or helpers
   required for those test cases to compile; do not restore untagged tests or
   the entire test file. If a tagged test cannot be isolated and restored
   reliably, leave it in the backup and report the unsuccessful restoration.
   Never use `git reset --hard`, broad `git clean`, or change production files.
7. Generate the first pass of focused unit tests from already captured intent.
   Follow existing organization, fixtures, naming, and framework conventions.
   Do not change coverage configuration or repository thresholds.
8. Tag every generated or rewritten test case with its source intent.
   Add a single language-appropriate line comment immediately above the test case.
   Use identifiers from the captured prompt record that requires the expectation:

   ```text
   // <source>/<sessionId>/<promptId>
   ```

   Copy each identifier exactly as returned by `scripts/context.mjs`.
   Never copy prompt text into the test code.
   When multiple prompts directly contribute, tag with the most relevant prompt.
   Rerun the context helper after a follow-up answer to get its prompt record.
   Do not tag unchanged preexisting tests, shared helpers, or fixtures.
9. Run the red-green TDD cycle for every prompt-backed expectation.
10. When the suite is green, run the applicable coverage command.
    Measure changed production code when the tooling supports it.
    If coverage is below the target, follow the question-driven coverage loop.
    Ask exactly one question to the user.
11. After the answer is captured, add only its authorized expectation.
    Run the red-green cycle, measure coverage, then ask the next question.
    Continue until the target passes or the user tells you to stop the flow.
    Also stop if the user leaves a question unanswered.

Report the requirements derived from intent and all files changed.
Report commands run, coverage, unanswered ambiguities, and the backup location.
Never claim the target passed without command output that demonstrates it.
