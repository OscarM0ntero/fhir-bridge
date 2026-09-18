import type { RunMode } from './cli-args.js';
import { buildPatientTransaction, type PatientTransaction } from './fhir/bundle.js';
import { groupByPatient, type MappingWarning } from './fhir/patient-groups.js';
import { uploadPatient, type FhirApi, type PatientOutcome } from './fhir/uploader.js';
import { parseLegacyCsv } from './legacy/parser.js';
import type { ParseResult } from './legacy/types.js';

export interface PipelineInput {
  /** The legacy export, as read from disk. */
  readonly csv: string | Buffer;
  readonly timezoneOffset: string;
  readonly mode: RunMode;
}

/** Everything a run found and did, for printing and for the report files. */
export interface PipelineReport {
  readonly mode: RunMode;
  readonly parse: ParseResult;
  readonly mappingWarnings: readonly MappingWarning[];
  readonly transactions: readonly PatientTransaction[];
  /** One per patient, in the order they were sent. Empty on an offline run. */
  readonly outcomes: readonly PatientOutcome[];
}

export interface PipelineHooks {
  /** Called as each patient finishes, so a long run can show progress. */
  readonly onPatient?: (transaction: PatientTransaction, outcome: PatientOutcome) => void;
}

/** A run that has been parsed and mapped, but has not touched the network. */
export interface PreparedRun {
  readonly parse: ParseResult;
  readonly mappingWarnings: readonly MappingWarning[];
  readonly transactions: readonly PatientTransaction[];
}

/** Parses and maps the export. Everything here is local and cannot fail on the network. */
export function prepareRun(csv: string | Buffer, timezoneOffset: string): PreparedRun {
  const parse = parseLegacyCsv(csv);
  const { groups, warnings } = groupByPatient(parse.records);
  const transactions = groups.map((group) => buildPatientTransaction(group, { timezoneOffset }));
  const mappingWarnings = [...warnings, ...transactions.flatMap((transaction) => transaction.warnings)];

  return { parse, mappingWarnings, transactions };
}

/**
 * Validates and, unless told otherwise, uploads each prepared patient.
 *
 * Patients are sent one after another rather than in parallel: the target is
 * a public server shared with everyone else, and twenty-two requests do not
 * need the concurrency.
 */
export async function executeRun(
  api: FhirApi,
  prepared: PreparedRun,
  mode: RunMode,
  hooks: PipelineHooks = {},
): Promise<PipelineReport> {
  const outcomes: PatientOutcome[] = [];
  if (mode !== 'offline') {
    for (const transaction of prepared.transactions) {
      const outcome = await uploadPatient(api, transaction, { dryRun: mode === 'dry-run' });
      outcomes.push(outcome);
      hooks.onPatient?.(transaction, outcome);
    }
  }

  return { mode, ...prepared, outcomes };
}

/**
 * Runs the whole pipeline. It prints nothing and touches no files, which is
 * what lets it be tested end to end against a fake server.
 */
export async function runPipeline(
  api: FhirApi,
  input: PipelineInput,
  hooks: PipelineHooks = {},
): Promise<PipelineReport> {
  return executeRun(api, prepareRun(input.csv, input.timezoneOffset), input.mode, hooks);
}

export interface PipelineSummary {
  readonly patients: number;
  readonly resources: number;
  readonly rejectedRows: number;
  readonly invalid: number;
  readonly refused: number;
  readonly uploaded: number;
  readonly created: number;
  readonly updated: number;
}

export function summarize(report: PipelineReport): PipelineSummary {
  const stored = report.outcomes.flatMap((outcome) =>
    outcome.upload.kind === 'committed' ? outcome.upload.entries : [],
  );
  const created = stored.filter((entry) => entry.created).length;

  return {
    patients: report.transactions.length,
    resources: report.transactions.reduce((total, transaction) => total + transaction.sources.length, 0),
    rejectedRows: report.parse.rejected.length,
    invalid: report.outcomes.filter((outcome) => !outcome.validation.valid).length,
    refused: report.outcomes.filter((outcome) => outcome.upload.kind === 'rejected').length,
    uploaded: report.outcomes.filter((outcome) => outcome.upload.kind === 'committed').length,
    created,
    updated: stored.length - created,
  };
}

/**
 * Exit codes, so a scheduler or a CI job can tell the failures apart.
 *
 * Rows the parser rejected do not fail the run: turning them away with a
 * reason is the designed behaviour for a dirty export, and they are reported.
 */
export const EXIT_CODES = {
  ok: 0,
  /** At least one patient failed validation or was refused by the server. */
  patientsFailed: 1,
  /** The command line, the configuration or the export itself was unusable. */
  badInput: 2,
  /** The server could not be reached, or answered in something other than FHIR. */
  serverUnavailable: 3,
} as const;

export function exitCodeFor(report: PipelineReport): number {
  const { invalid, refused } = summarize(report);
  return invalid + refused > 0 ? EXIT_CODES.patientsFailed : EXIT_CODES.ok;
}
