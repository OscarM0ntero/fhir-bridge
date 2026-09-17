import { parse } from 'csv-parse/sync';

import {
  normalizeAgeYears,
  normalizeDate,
  normalizeDiagnosisStatus,
  normalizeMeasurement,
  normalizeSex,
  normalizeText,
  normalizeTimestamp,
  type Normalized,
} from './normalizers.js';
import {
  LEGACY_COLUMNS,
  type LegacyColumn,
  type LegacyLabResult,
  type LegacyRecord,
  type LegacyTimestamp,
  type ParseResult,
  type RawLegacyRow,
  type RejectedRow,
  type RowWarning,
} from './types.js';

/** Thrown when the file as a whole cannot be read, as opposed to a single row. */
export class LegacyParseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'LegacyParseError';
  }
}

const DELIMITER = ';';

interface ParsedRow {
  readonly record: RawLegacyRow;
  readonly info: { readonly lines: number };
}

type RowOutcome =
  | { readonly ok: true; readonly record: LegacyRecord }
  | { readonly ok: false; readonly reason: string };

/**
 * Reads the legacy export. A row that cannot be interpreted is reported as
 * rejected instead of aborting the run, because a single bad row in a hospital
 * export should not stop the other twenty-four from being migrated.
 */
export function parseLegacyCsv(content: string | Buffer): ParseResult {
  const rows = readRows(content);

  const records: LegacyRecord[] = [];
  const rejected: RejectedRow[] = [];
  const warnings: RowWarning[] = [];

  for (const { record, info } of rows) {
    const sourceRow = info.lines;
    const addWarning = (column: LegacyColumn, message: string): void => {
      warnings.push({ sourceRow, column, message });
    };

    const outcome = parseRow(record, sourceRow, addWarning);
    if (outcome.ok) {
      records.push(outcome.record);
    } else {
      rejected.push({
        sourceRow,
        recordId: normalizeText(read(record, 'PAT_ID')),
        reason: outcome.reason,
      });
    }
  }

  return { records, rejected, warnings };
}

function readRows(content: string | Buffer): readonly ParsedRow[] {
  // An export with no header at all would otherwise be reported as a run that
  // simply migrated nothing, which is the worst way for this to fail.
  if (isBlank(content)) {
    throw new LegacyParseError('The legacy export is empty: it has no header row.');
  }

  try {
    const rows: readonly ParsedRow[] = parse(content, {
      delimiter: DELIMITER,
      columns: (header: unknown): string[] => assertHeader(header),
      // The export is written by a Windows system and starts with a BOM.
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
      info: true,
    });

    return rows;
  } catch (error) {
    if (error instanceof LegacyParseError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new LegacyParseError(`The legacy export could not be read: ${detail}`);
  }
}

/** Refuses a file whose columns are not the ones the mapping was written for. */
function assertHeader(header: unknown): string[] {
  if (!Array.isArray(header) || !header.every((column): column is string => typeof column === 'string')) {
    throw new LegacyParseError('The legacy export has no readable header row.');
  }

  const found = header.map((column) => column.trim());
  const expected = [...LEGACY_COLUMNS];
  if (found.length !== expected.length || found.some((column, index) => column !== expected[index])) {
    throw new LegacyParseError(
      `The legacy export does not have the expected columns.\n  expected: ${expected.join(DELIMITER)}\n  found:    ${found.join(DELIMITER)}`,
    );
  }

  return found;
}

function parseRow(
  row: RawLegacyRow,
  sourceRow: number,
  addWarning: (column: LegacyColumn, message: string) => void,
): RowOutcome {
  const recordId = normalizeText(read(row, 'PAT_ID'));
  if (recordId === undefined) {
    return { ok: false, reason: 'PAT_ID is empty, the row cannot be traced back to its source.' };
  }

  const mrn = normalizeText(read(row, 'MRN'));
  if (mrn === undefined) {
    return { ok: false, reason: 'MRN is empty, the row cannot be tied to a patient.' };
  }

  const birthDate = optional(read(row, 'BIRTH_DT'), normalizeDate);
  if (!birthDate.ok) {
    return { ok: false, reason: `BIRTH_DT is unusable: ${birthDate.error}` };
  }

  const localCode = normalizeText(read(row, 'DX_CODE'));
  const diagnosisText = normalizeText(read(row, 'DX_TEXT'));
  if (localCode === undefined && diagnosisText === undefined) {
    return { ok: false, reason: 'the row carries neither DX_CODE nor DX_TEXT, so there is no diagnosis to map.' };
  }

  const recordedDate = optional(read(row, 'DX_DATE'), normalizeTimestamp);
  if (!recordedDate.ok) {
    return { ok: false, reason: `DX_DATE is unusable: ${recordedDate.error}` };
  }

  return {
    ok: true,
    record: {
      sourceRow,
      recordId,
      mrn,
      lastName: normalizeText(read(row, 'LAST_NAME')),
      firstName: normalizeText(read(row, 'FIRST_NAME')),
      birthDate: birthDate.value,
      sex: normalizeSex(read(row, 'SEX')),
      diagnosis: {
        localCode,
        text: diagnosisText,
        recordedDate: recordedDate.value,
        status: normalizeDiagnosisStatus(read(row, 'DX_STATUS')),
        onsetAgeYears: parseOnsetAge(row, addWarning),
      },
      labResult: parseLabResult(row, addWarning),
      notes: normalizeText(read(row, 'NOTES')),
      raw: row,
    },
  };
}

/**
 * The laboratory block is secondary information: when it cannot be read the
 * row still describes a patient and a diagnosis, so the result is dropped with
 * a warning instead of the whole row being rejected.
 */
function parseLabResult(
  row: RawLegacyRow,
  addWarning: (column: LegacyColumn, message: string) => void,
): LegacyLabResult | undefined {
  const localCode = normalizeText(read(row, 'LAB_CODE'));
  const rawValue = normalizeText(read(row, 'LAB_VALUE'));

  if (localCode === undefined) {
    if (rawValue !== undefined) {
      addWarning('LAB_CODE', 'a laboratory value was reported without a test code, the result is dropped.');
    }
    return undefined;
  }

  if (rawValue === undefined) {
    addWarning('LAB_VALUE', `test ${localCode} reported no usable value, the result is dropped.`);
    return undefined;
  }

  const measurement = normalizeMeasurement(rawValue, read(row, 'LAB_UNIT'));
  if (!measurement.ok) {
    addWarning('LAB_VALUE', `${measurement.error} The result is dropped.`);
    return undefined;
  }

  return {
    localCode,
    measurement: measurement.value,
    effective: parseLabDate(row, addWarning),
  };
}

function parseLabDate(
  row: RawLegacyRow,
  addWarning: (column: LegacyColumn, message: string) => void,
): LegacyTimestamp | undefined {
  const effective = optional(read(row, 'LAB_DT'), normalizeTimestamp);
  if (!effective.ok) {
    addWarning('LAB_DT', `${effective.error} The result is kept without an effective time.`);
    return undefined;
  }
  return effective.value;
}

function parseOnsetAge(
  row: RawLegacyRow,
  addWarning: (column: LegacyColumn, message: string) => void,
): number | undefined {
  const onsetAge = optional(read(row, 'ONSET_AGE'), normalizeAgeYears);
  if (!onsetAge.ok) {
    addWarning('ONSET_AGE', `${onsetAge.error} The age of onset is dropped.`);
    return undefined;
  }
  return onsetAge.value;
}

/** Applies a normaliser only when the field holds something. */
function optional<T>(raw: string, normalize: (value: string) => Normalized<T>): Normalized<T | undefined> {
  if (normalizeText(raw) === undefined) {
    return { ok: true, value: undefined };
  }
  return normalize(raw);
}

function read(row: RawLegacyRow, column: LegacyColumn): string {
  return row[column] ?? '';
}

/** True for a file that holds nothing but whitespace, or nothing at all. */
function isBlank(content: string | Buffer): boolean {
  // Only the start of the file is inspected: a header, if there is one, is there.
  const head = typeof content === 'string' ? content.slice(0, 512) : content.toString('utf8', 0, 512);
  const withoutBom = head.charCodeAt(0) === 0xfeff ? head.slice(1) : head;
  return withoutBom.trim() === '';
}
