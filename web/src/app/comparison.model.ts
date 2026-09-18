/**
 * The shape of out/comparison.json, as written by the pipeline in
 * src/report/comparison.ts. The viewer only reads it, so resources are kept as
 * plain JSON objects rather than typed FHIR resources.
 */

export type RowOutcome = 'uploaded' | 'valid' | 'invalid' | 'refused' | 'mapped' | 'rejected';

export type RunMode = 'offline' | 'dry-run' | 'upload';

export interface ComparisonResource {
  readonly resourceType: 'Patient' | 'Condition' | 'Observation';
  readonly resource: Readonly<Record<string, unknown>>;
  /** Absent until the resource has been uploaded. */
  readonly serverReference?: string;
  readonly created?: boolean;
  readonly builtFromRows: readonly number[];
}

export interface ComparisonRow {
  readonly sourceRow: number;
  readonly recordId?: string;
  readonly mrn?: string;
  readonly outcome: RowOutcome;
  readonly legacy: Readonly<Record<string, string>>;
  readonly rejectionReason?: string;
  readonly warnings: readonly string[];
  readonly resources: readonly ComparisonResource[];
}

export interface ComparisonSummary {
  readonly patients: number;
  readonly resources: number;
  readonly rejectedRows: number;
  readonly invalid: number;
  readonly refused: number;
  readonly uploaded: number;
  readonly created: number;
  readonly updated: number;
}

export interface ComparisonReport {
  readonly generatedAt: string;
  readonly mode: RunMode;
  readonly serverBaseUrl: string;
  readonly summary: ComparisonSummary;
  readonly rows: readonly ComparisonRow[];
}
