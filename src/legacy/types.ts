/** Columns the legacy export is expected to carry, in the order it writes them. */
export const LEGACY_COLUMNS = [
  'PAT_ID',
  'MRN',
  'LAST_NAME',
  'FIRST_NAME',
  'BIRTH_DT',
  'SEX',
  'DX_CODE',
  'DX_TEXT',
  'DX_DATE',
  'DX_STATUS',
  'ONSET_AGE',
  'LAB_CODE',
  'LAB_VALUE',
  'LAB_UNIT',
  'LAB_DT',
  'NOTES',
] as const;

export type LegacyColumn = (typeof LEGACY_COLUMNS)[number];

/** One row of the export exactly as read, before any interpretation. */
export type RawLegacyRow = Readonly<Record<string, string>>;

/** Sex of the patient, normalised from the several codes the export uses. */
export type LegacySex = 'male' | 'female' | 'unknown';

/** Clinical status of a diagnosis, normalised from the export's own codes. */
export type LegacyDiagnosisStatus = 'active' | 'resolved' | 'suspected' | 'unknown';

/** Comparator used when a result is reported as a limit rather than a value. */
export type LegacyComparator = '<' | '<=' | '>' | '>=';

/**
 * A point in time from the legacy system. The date is always full precision;
 * the time is present only when the export recorded one. The legacy system
 * records no timezone, so the offset is applied later, when mapping to FHIR.
 */
export interface LegacyTimestamp {
  /** Calendar date as YYYY-MM-DD. */
  readonly date: string;
  /** Time of day as HH:MM:SS, or undefined when the export gave none. */
  readonly time: string | undefined;
}

/** A numeric result, possibly reported as being under or over a limit. */
export interface LegacyMeasurement {
  readonly value: number;
  readonly comparator: LegacyComparator | undefined;
  /** Unit as written by the legacy system, not yet translated to UCUM. */
  readonly unit: string | undefined;
}

export interface LegacyDiagnosis {
  /** Code from the legacy system's own catalogue, such as RD-014. */
  readonly localCode: string | undefined;
  /** Free-text description, the only content when there is no local code. */
  readonly text: string | undefined;
  readonly recordedDate: LegacyTimestamp | undefined;
  readonly status: LegacyDiagnosisStatus;
  readonly onsetAgeYears: number | undefined;
}

export interface LegacyLabResult {
  /** Code from the legacy system's own test catalogue, such as LB-AGAL. */
  readonly localCode: string;
  readonly measurement: LegacyMeasurement;
  readonly effective: LegacyTimestamp | undefined;
}

/** A legacy row that carries enough information to be mapped to FHIR. */
export interface LegacyRecord {
  /** Line number in the source file, so findings can be traced back to it. */
  readonly sourceRow: number;
  /**
   * The PAT_ID column. Despite its name it identifies the row, not the
   * patient: the same person appears under two PAT_IDs in the export.
   */
  readonly recordId: string;
  /** Medical record number. Identifies the patient across rows. */
  readonly mrn: string;
  readonly lastName: string | undefined;
  readonly firstName: string | undefined;
  /** FHIR date, which may be a partial date such as 1998 or 1998-03. */
  readonly birthDate: string | undefined;
  readonly sex: LegacySex;
  readonly diagnosis: LegacyDiagnosis;
  readonly labResult: LegacyLabResult | undefined;
  readonly notes: string | undefined;
  /** The untouched row, kept so the report can show it next to the output. */
  readonly raw: RawLegacyRow;
}

/** A row that could not be interpreted and was left out of the pipeline. */
export interface RejectedRow {
  readonly sourceRow: number;
  readonly recordId: string | undefined;
  readonly reason: string;
  /** The untouched row, so a rejection can be shown next to what was wrong with it. */
  readonly raw: RawLegacyRow;
}

/** A recoverable problem: the row is kept, part of its content is not. */
export interface RowWarning {
  readonly sourceRow: number;
  readonly column: LegacyColumn;
  readonly message: string;
}

export interface ParseResult {
  readonly records: readonly LegacyRecord[];
  readonly rejected: readonly RejectedRow[];
  readonly warnings: readonly RowWarning[];
}
