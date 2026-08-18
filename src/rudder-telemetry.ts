import {
  capture,
  type TelemetryCaptureContext,
  type TelemetryProperties,
} from './telemetry.ts';

export const rudderUsageEvents = [
  'run-started',
  'context-refreshed',
  'spec-created',
  'test-backup-created',
  'question-asked',
  'run-finished',
] as const;

export type RudderUsageEvent = (typeof rudderUsageEvents)[number];

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Rudder telemetry payload must be an object');
  }
  return value as JsonObject;
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function count(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${field} must be a non-negative integer`);
  }
  return value as number;
}

function positiveCount(value: unknown, field: string): number {
  const result = count(value, field);
  if (result === 0) {
    throw new TypeError(`${field} must be a positive integer`);
  }
  return result;
}

function choice<T extends string>(
  value: unknown,
  field: string,
  choices: readonly T[]
): T {
  if (typeof value === 'string' && choices.includes(value as T)) {
    return value as T;
  }
  throw new TypeError(`${field} must be one of: ${choices.join(', ')}`);
}

function promptSourceCounts(value: unknown): Record<string, number> {
  const sources = object(value);
  const result: Record<string, number> = {};
  for (const source of ['claude-code', 'codex', 'cursor', 'other']) {
    if (sources[source] !== undefined) {
      result[source] = count(sources[source], `promptSourceCounts.${source}`);
    }
  }
  return result;
}

function host(value: unknown): string {
  return choice(value, 'host', ['claude-code', 'codex', 'unknown'] as const);
}

function repositoryProperties(
  context: TelemetryCaptureContext,
  payload: JsonObject
): TelemetryProperties {
  const repository = string(payload.repository, 'repository');
  const branch = string(payload.branch, 'branch');
  return {
    repository_pseudonym: context.pseudonymize('repository', repository),
    branch_pseudonym: context.pseudonymize(
      'branch',
      `${repository}\0${branch}`
    ),
    repository_is_local: repository.startsWith('local:'),
  };
}

function runProperties(
  context: TelemetryCaptureContext,
  payload: JsonObject
): TelemetryProperties {
  const repository = string(payload.repository, 'repository');
  const branch = string(payload.branch, 'branch');
  const runId = string(payload.runId, 'runId');
  return {
    ...repositoryProperties(context, payload),
    run_pseudonym: context.pseudonymize(
      'run',
      `${repository}\0${branch}\0${runId}`
    ),
  };
}

function contextProperties(
  context: TelemetryCaptureContext,
  payload: JsonObject
): TelemetryProperties {
  const sources = promptSourceCounts(payload.promptSourceCounts);
  const capturedPromptCount = count(
    payload.capturedPromptCount,
    'capturedPromptCount'
  );
  const reconciledPromptCount = count(
    payload.reconciledPromptCount,
    'reconciledPromptCount'
  );
  return {
    ...runProperties(context, payload),
    host: host(payload.host),
    captured_prompt_count: capturedPromptCount,
    captured_session_count: count(
      payload.capturedSessionCount,
      'capturedSessionCount'
    ),
    reconciled_prompt_count: reconciledPromptCount,
    unreconciled_prompt_count: Math.max(
      0,
      capturedPromptCount - reconciledPromptCount
    ),
    captured_prompt_sources: Object.keys(sources),
    captured_prompt_source_counts: sources,
    has_captured_intent: capturedPromptCount > 0,
    changed_path_count: count(payload.changedPathCount, 'changedPathCount'),
    changed_test_path_count: count(
      payload.changedTestPathCount,
      'changedTestPathCount'
    ),
    changed_production_candidate_path_count: count(
      payload.changedProductionPathCount,
      'changedProductionPathCount'
    ),
    untracked_path_count: count(
      payload.untrackedPathCount,
      'untrackedPathCount'
    ),
    test_lines_added_from_base: count(
      payload.testLineAdditionCount,
      'testLineAdditionCount'
    ),
    test_lines_deleted_from_base: count(
      payload.testLineDeletionCount,
      'testLineDeletionCount'
    ),
  };
}

export function rudderUsageEventProperties(
  event: RudderUsageEvent,
  input: unknown,
  context: TelemetryCaptureContext
): TelemetryProperties {
  const payload = object(input);
  switch (event) {
    case 'run-started':
    case 'context-refreshed':
      return contextProperties(context, payload);
    case 'spec-created':
      return {
        ...runProperties(context, payload),
        host: host(payload.host),
      };
    case 'test-backup-created':
      return {
        ...runProperties(context, payload),
        host: host(payload.host),
        approved_test_path_count: count(
          payload.approvedTestPathCount,
          'approvedTestPathCount'
        ),
        copied_untracked_test_path_count: count(
          payload.copiedUntrackedTestPathCount,
          'copiedUntrackedTestPathCount'
        ),
      };
    case 'question-asked':
      return {
        ...runProperties(context, payload),
        host: host(payload.host),
        question_number: positiveCount(
          payload.questionNumber,
          'questionNumber'
        ),
      };
    case 'run-finished':
      return {
        ...runProperties(context, payload),
        host: host(payload.host),
        status: choice(payload.status, 'status', [
          'completed',
          'stopped',
          'blocked',
        ] as const),
        tests_passed: choice(payload.testsPassed, 'testsPassed', [
          'yes',
          'no',
          'unknown',
        ] as const),
        coverage_target_met: choice(
          payload.coverageTargetMet,
          'coverageTargetMet',
          ['yes', 'no', 'unknown'] as const
        ),
        final_changed_path_count: count(
          payload.changedPathCount,
          'changedPathCount'
        ),
        final_changed_test_path_count: count(
          payload.changedTestPathCount,
          'changedTestPathCount'
        ),
        final_changed_production_candidate_path_count: count(
          payload.changedProductionPathCount,
          'changedProductionPathCount'
        ),
        spec_backed_test_count: count(
          payload.specBackedTestCount,
          'specBackedTestCount'
        ),
        final_test_lines_added_from_base: count(
          payload.testLineAdditionCount,
          'testLineAdditionCount'
        ),
        final_test_lines_deleted_from_base: count(
          payload.testLineDeletionCount,
          'testLineDeletionCount'
        ),
        questions_asked_count: count(
          payload.questionsAskedCount,
          'questionsAskedCount'
        ),
      };
  }
}

export function captureRudderUsageEvent(
  event: RudderUsageEvent,
  input: unknown
): void {
  capture(`rudder ${event.replaceAll('-', ' ')}`, (context) =>
    rudderUsageEventProperties(event, input, context)
  );
}
