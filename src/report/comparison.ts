import type { FhirResource } from 'fhir/r4.js';

import type { RunMode } from '../cli-args.js';
import type { EntrySource } from '../fhir/bundle.js';
import type { RawLegacyRow } from '../legacy/types.js';
import { summarize, type PipelineReport, type PipelineSummary } from '../pipeline.js';

/** What became of one CSV row. */
export type RowOutcome = 'uploaded' | 'valid' | 'invalid' | 'refused' | 'mapped' | 'rejected';

export interface ComparisonResource {
  readonly resourceType: EntrySource['resourceType'];
  /**
   * The resource as it was built. Once uploaded, its references are shown the
   * way the server stored them: the temporary urn:uuid swapped for the real
   * Patient/{id}, exactly as the transaction response reported.
   */
  readonly resource: FhirResource;
  /** Where the server stored it, such as Patient/28886, once uploaded. */
  readonly serverReference: string | undefined;
  /** Whether the upload created it or updated it. Undefined until uploaded. */
  readonly created: boolean | undefined;
  /** Every row the resource was built from: a Patient can span several. */
  readonly builtFromRows: readonly number[];
}

export interface ComparisonRow {
  readonly sourceRow: number;
  readonly recordId: string | undefined;
  readonly mrn: string | undefined;
  readonly outcome: RowOutcome;
  /** The row exactly as the legacy export wrote it. */
  readonly legacy: RawLegacyRow;
  readonly rejectionReason: string | undefined;
  readonly warnings: readonly string[];
  readonly resources: readonly ComparisonResource[];
}

/** Everything the side-by-side view shows, in one file it can load. */
export interface ComparisonReport {
  readonly generatedAt: string;
  readonly mode: RunMode;
  readonly serverBaseUrl: string;
  readonly summary: PipelineSummary;
  readonly rows: readonly ComparisonRow[];
}

export interface ComparisonContext {
  readonly serverBaseUrl: string;
  readonly generatedAt: string;
}

export function buildComparison(report: PipelineReport, context: ComparisonContext): ComparisonReport {
  const outcomes = new Map(report.outcomes.map((outcome) => [outcome.mrn, outcome]));
  const resourcesByRow = new Map<number, ComparisonResource[]>();
  const outcomeByRow = new Map<number, RowOutcome>();

  for (const transaction of report.transactions) {
    const outcome = outcomes.get(transaction.mrn);
    const upload = outcome?.upload;
    const stored = upload?.kind === 'committed' ? upload.entries : undefined;
    const rowOutcome = rowOutcomeOf(upload, outcome === undefined);

    const serverUrls = new Map<string, string>();
    (transaction.bundle.entry ?? []).forEach((entry, index) => {
      const reference = stored?.[index]?.reference;
      if (entry.fullUrl !== undefined && reference !== undefined) {
        serverUrls.set(entry.fullUrl, reference);
      }
    });

    transaction.sources.forEach((source, index) => {
      const resource = transaction.bundle.entry?.[index]?.resource as FhirResource | undefined;
      if (resource === undefined) {
        return;
      }
      const shown: ComparisonResource = {
        resourceType: source.resourceType,
        resource: resolveReferences(resource, serverUrls),
        serverReference: stored?.[index]?.reference,
        created: stored?.[index]?.created,
        builtFromRows: source.sourceRows,
      };
      for (const row of source.sourceRows) {
        resourcesByRow.set(row, [...(resourcesByRow.get(row) ?? []), shown]);
        outcomeByRow.set(row, rowOutcome);
      }
    });
  }

  const warningsByRow = new Map<number, string[]>();
  const warn = (row: number, message: string): void => {
    warningsByRow.set(row, [...(warningsByRow.get(row) ?? []), message]);
  };
  report.parse.warnings.forEach((warning) => {
    warn(warning.sourceRow, `${warning.column}: ${warning.message}`);
  });
  report.mappingWarnings.forEach((warning) => {
    warn(warning.sourceRow, warning.message);
  });

  const accepted: ComparisonRow[] = report.parse.records.map((record) => ({
    sourceRow: record.sourceRow,
    recordId: record.recordId,
    mrn: record.mrn,
    outcome: outcomeByRow.get(record.sourceRow) ?? 'mapped',
    legacy: record.raw,
    rejectionReason: undefined,
    warnings: warningsByRow.get(record.sourceRow) ?? [],
    resources: resourcesByRow.get(record.sourceRow) ?? [],
  }));

  const rejected: ComparisonRow[] = report.parse.rejected.map((rejection) => ({
    sourceRow: rejection.sourceRow,
    recordId: rejection.recordId,
    mrn: undefined,
    outcome: 'rejected',
    legacy: rejection.raw,
    rejectionReason: rejection.reason,
    warnings: warningsByRow.get(rejection.sourceRow) ?? [],
    resources: [],
  }));

  return {
    generatedAt: context.generatedAt,
    mode: report.mode,
    serverBaseUrl: context.serverBaseUrl,
    summary: summarize(report),
    rows: [...accepted, ...rejected].sort((a, b) => a.sourceRow - b.sourceRow),
  };
}

function rowOutcomeOf(
  upload: PipelineReport['outcomes'][number]['upload'] | undefined,
  notSent: boolean,
): RowOutcome {
  if (notSent || upload === undefined) {
    return 'mapped';
  }
  switch (upload.kind) {
    case 'committed':
      return 'uploaded';
    case 'rejected':
      return 'refused';
    case 'skipped':
      return upload.reason === 'dry-run' ? 'valid' : 'invalid';
  }
}

/**
 * Returns a copy of the resource with every reference found in the map
 * swapped for its server location. The original is left untouched.
 */
export function resolveReferences<T>(resource: T, serverUrls: ReadonlyMap<string, string>): T {
  return JSON.parse(JSON.stringify(resource), (key: string, value: unknown): unknown =>
    key === 'reference' && typeof value === 'string' ? (serverUrls.get(value) ?? value) : value,
  ) as T;
}
