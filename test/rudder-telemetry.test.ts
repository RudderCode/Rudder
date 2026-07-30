import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  rudderUsageEventProperties,
  type RudderUsageEvent,
} from '../src/rudder-telemetry.ts';
import {
  pseudonymize,
  runtimeTelemetryProperties,
  telemetryDisabled,
  type TelemetryCaptureContext,
} from '../src/telemetry.ts';

const context: TelemetryCaptureContext = {
  pseudonymize: (namespace) => `${namespace}-pseudonym`,
};

function properties(event: RudderUsageEvent, payload: unknown) {
  return rudderUsageEventProperties(event, payload, context);
}

// codex/019fb36f-4dfe-7c91-8674-5caaf68fcced/019fb386-4741-7860-89a9-97f3697fa4f1
test('run telemetry measures Rudder intent and scope without agent usage', () => {
  const result = properties('run-started', {
    host: 'codex',
    repository: 'github.com/private/raw-repository',
    branch: 'raw-branch',
    runId: 'raw-run-id',
    capturedPromptCount: 4,
    capturedSessionCount: 2,
    reconciledPromptCount: 3,
    promptSourceCounts: {
      codex: 3,
      'claude-code': 1,
    },
    changedPathCount: 5,
    changedTestPathCount: 2,
    changedProductionPathCount: 3,
    untrackedPathCount: 1,
    testLineAdditionCount: 18,
    testLineDeletionCount: 6,
    inputTokens: 100,
    model: 'private-model',
    toolUsage: { Read: 2 },
    costUsd: 1.25,
  });

  assert.deepEqual(result, {
    repository_pseudonym: 'repository-pseudonym',
    branch_pseudonym: 'branch-pseudonym',
    run_pseudonym: 'run-pseudonym',
    repository_is_local: false,
    host: 'codex',
    captured_prompt_count: 4,
    captured_session_count: 2,
    reconciled_prompt_count: 3,
    unreconciled_prompt_count: 1,
    captured_prompt_sources: ['claude-code', 'codex'],
    captured_prompt_source_counts: {
      'claude-code': 1,
      codex: 3,
    },
    has_captured_intent: true,
    changed_path_count: 5,
    changed_test_path_count: 2,
    changed_production_candidate_path_count: 3,
    untracked_path_count: 1,
    test_lines_added_from_base: 18,
    test_lines_deleted_from_base: 6,
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /raw-repository|raw-branch|raw-run-id|inputTokens|private-model|toolUsage|costUsd/
  );
});

// codex/019fb36f-4dfe-7c91-8674-5caaf68fcced/019fb39d-12e9-7673-b7d7-04d6c3f27243
test('finished runs report test line snapshots and Rudder question counts', () => {
  const result = properties('run-finished', {
    host: 'claude-code',
    repository: 'github.com/private/raw-repository',
    branch: 'raw-branch',
    runId: 'raw-run-id',
    status: 'completed',
    testsPassed: 'yes',
    coverageTargetMet: 'no',
    changedPathCount: 6,
    changedTestPathCount: 4,
    changedProductionPathCount: 2,
    promptBackedTestCount: 5,
    testLineAdditionCount: 42,
    testLineDeletionCount: 9,
    questionsAskedCount: 3,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.tests_passed, 'yes');
  assert.equal(result.coverage_target_met, 'no');
  assert.equal(result.prompt_backed_test_count, 5);
  assert.equal(result.final_test_lines_added_from_base, 42);
  assert.equal(result.final_test_lines_deleted_from_base, 9);
  assert.equal(result.questions_asked_count, 3);
  assert.doesNotMatch(
    JSON.stringify(result),
    /raw-repository|raw-branch|raw-run-id/
  );
});

// codex/019fb36f-4dfe-7c91-8674-5caaf68fcced/019fb39d-12e9-7673-b7d7-04d6c3f27243
test('question telemetry counts questions without question or answer text', () => {
  const result = properties('question-asked', {
    host: 'codex',
    repository: 'github.com/private/raw-repository',
    branch: 'raw-branch',
    runId: 'raw-run-id',
    questionNumber: 2,
    questionText: 'RAW-QUESTION',
    answerText: 'RAW-ANSWER',
  });

  assert.equal(result.run_pseudonym, 'run-pseudonym');
  assert.equal(result.question_number, 2);
  assert.deepEqual(Object.keys(result).sort(), [
    'branch_pseudonym',
    'host',
    'question_number',
    'repository_is_local',
    'repository_pseudonym',
    'run_pseudonym',
  ]);
  assert.doesNotMatch(
    JSON.stringify(result),
    /raw-repository|raw-branch|raw-run-id|RAW-QUESTION|RAW-ANSWER/
  );
});

// codex/019fb36f-4dfe-7c91-8674-5caaf68fcced/019fb3c0-6a86-7e53-a68a-3721b8c4ed70
test('backup telemetry reports copied paths and rejects impossible counts', () => {
  const payload = {
    host: 'codex',
    repository: 'github.com/private/raw-repository',
    branch: 'raw-branch',
    runId: 'raw-run-id',
    approvedTestPathCount: 3,
    copiedUntrackedTestPathCount: 1,
  };
  const result = properties('test-backup-created', payload);

  assert.equal(result.approved_test_path_count, 3);
  assert.equal(result.copied_untracked_test_path_count, 1);
  assert.equal(result.run_pseudonym, 'run-pseudonym');
  assert.doesNotMatch(
    JSON.stringify(result),
    /raw-repository|raw-branch|raw-run-id/
  );
  for (const field of [
    'approvedTestPathCount',
    'copiedUntrackedTestPathCount',
  ]) {
    assert.throws(
      () =>
        properties('test-backup-created', {
          ...payload,
          [field]: -1,
        }),
      new RegExp(`${field} must be a non-negative integer`)
    );
  }
});

// codex/019fb36f-4dfe-7c91-8674-5caaf68fcced/019fb386-4741-7860-89a9-97f3697fa4f1
test('Rudder telemetry validates product outcomes and question ordinals', () => {
  assert.throws(
    () =>
      properties('run-finished', {
        host: 'codex',
        repository: 'repository',
        branch: 'branch',
        runId: 'run-id',
        status: 'successful-ish',
        testsPassed: 'yes',
        coverageTargetMet: 'yes',
        changedPathCount: 0,
        changedTestPathCount: 0,
        changedProductionPathCount: 0,
        promptBackedTestCount: 0,
        testLineAdditionCount: 0,
        testLineDeletionCount: 0,
        questionsAskedCount: 0,
      }),
    /status must be one of/
  );
  assert.throws(
    () =>
      properties('question-asked', {
        host: 'codex',
        repository: 'repository',
        branch: 'branch',
        runId: 'run-id',
        questionNumber: 0,
      }),
    /questionNumber must be a positive integer/
  );
});

// codex/019fb36f-4dfe-7c91-8674-5caaf68fcced/019fb386-4741-7860-89a9-97f3697fa4f1
test('repository pseudonyms are stable and local-secret scoped', () => {
  const first = pseudonymize(
    'local-secret-a',
    'repository',
    'github.com/private/repository'
  );
  assert.equal(
    first,
    pseudonymize(
      'local-secret-a',
      'repository',
      'github.com/private/repository'
    )
  );
  assert.notEqual(
    first,
    pseudonymize(
      'local-secret-b',
      'repository',
      'github.com/private/repository'
    )
  );
  assert.doesNotMatch(first, /private|repository/);
});

// codex/019fb36f-4dfe-7c91-8674-5caaf68fcced/019fb386-4741-7860-89a9-97f3697fa4f1
test('common telemetry is limited to Rudder schema and version', () => {
  const result = runtimeTelemetryProperties();
  assert.equal(result.telemetry_schema_version, 1);
  assert.equal(typeof result.rudder_version, 'string');
  assert.deepEqual(Object.keys(result).sort(), [
    'rudder_version',
    'telemetry_schema_version',
  ]);
});

// codex/019fb36f-4dfe-7c91-8674-5caaf68fcced/019fb3a8-3fc7-7410-aa52-473842eeab9a
test('the canonical DO_NOT_TRACK value disables Rudder telemetry', () => {
  assert.equal(telemetryDisabled({ DO_NOT_TRACK: '1' }), true);
  assert.equal(telemetryDisabled({ DO_NOT_TRACK: '0' }), false);
  assert.equal(telemetryDisabled({}), false);
});
