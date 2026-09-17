import type { LegacyRecord, LegacySex } from '../legacy/types.js';

/** Something the mapper had to decide on its own, reported against its row. */
export interface MappingWarning {
  readonly sourceRow: number;
  readonly message: string;
}

/** Everything the export says about one patient, gathered from all their rows. */
export interface PatientGroup {
  readonly mrn: string;
  readonly lastName: string | undefined;
  readonly firstName: string | undefined;
  readonly birthDate: string | undefined;
  readonly sex: LegacySex;
  /** The rows that belong to this patient, in file order. */
  readonly records: readonly LegacyRecord[];
}

export interface GroupingResult {
  readonly groups: readonly PatientGroup[];
  readonly warnings: readonly MappingWarning[];
}

/**
 * Gathers the rows of each patient, identified by MRN, into a single set of
 * demographics. Uploading one Patient per row would let the last row silently
 * overwrite what earlier rows said, so the rows are merged first.
 *
 * The rule is to keep as much information as the rows hold between them: a
 * value fills a gap, a more precise date replaces a less precise one that it
 * agrees with, and when two rows truly contradict each other the earlier row
 * wins and the contradiction is reported.
 */
export function groupByPatient(records: readonly LegacyRecord[]): GroupingResult {
  const rowsByMrn = new Map<string, LegacyRecord[]>();
  for (const record of records) {
    const rows = rowsByMrn.get(record.mrn);
    if (rows === undefined) {
      rowsByMrn.set(record.mrn, [record]);
    } else {
      rows.push(record);
    }
  }

  const warnings: MappingWarning[] = [];
  const groups = [...rowsByMrn.entries()].map(([mrn, rows]) => mergeRows(mrn, rows, warnings));

  return { groups, warnings };
}

function mergeRows(mrn: string, rows: readonly LegacyRecord[], warnings: MappingWarning[]): PatientGroup {
  let lastName: string | undefined;
  let firstName: string | undefined;
  let birthDate: string | undefined;
  let sex: LegacySex = 'unknown';

  for (const row of rows) {
    const report = (column: string, kept: string, discarded: string): void => {
      warnings.push({
        sourceRow: row.sourceRow,
        message: `${mrn}: ${column} "${discarded}" contradicts "${kept}" from an earlier row, so the earlier value is kept.`,
      });
    };

    lastName = mergeText(lastName, row.lastName, (kept, discarded) => {
      report('LAST_NAME', kept, discarded);
    });
    firstName = mergeText(firstName, row.firstName, (kept, discarded) => {
      report('FIRST_NAME', kept, discarded);
    });
    birthDate = mergeDate(birthDate, row.birthDate, (kept, discarded) => {
      report('BIRTH_DT', kept, discarded);
    });
    sex = mergeSex(sex, row.sex, (kept, discarded) => {
      report('SEX', kept, discarded);
    });
  }

  return { mrn, lastName, firstName, birthDate, sex, records: rows };
}

type ConflictHandler = (kept: string, discarded: string) => void;

/** Text is compared exactly: NOVAK and Novak are reported, not guessed at. */
function mergeText(
  current: string | undefined,
  candidate: string | undefined,
  onConflict: ConflictHandler,
): string | undefined {
  if (current === undefined) {
    return candidate;
  }
  if (candidate !== undefined && candidate !== current) {
    onConflict(current, candidate);
  }
  return current;
}

/**
 * FHIR dates only ever lose precision from the right, so 1998 and 1998-03-12
 * agree exactly when one is a prefix of the other. When they agree the more
 * precise one is kept.
 */
export function mergeDate(
  current: string | undefined,
  candidate: string | undefined,
  onConflict: ConflictHandler,
): string | undefined {
  if (current === undefined) {
    return candidate;
  }
  if (candidate === undefined || current.startsWith(candidate)) {
    return current;
  }
  if (candidate.startsWith(current)) {
    return candidate;
  }
  onConflict(current, candidate);
  return current;
}

/** Unknown carries no information, so any known value fills it. */
function mergeSex(current: LegacySex, candidate: LegacySex, onConflict: ConflictHandler): LegacySex {
  if (current === 'unknown') {
    return candidate;
  }
  if (candidate !== 'unknown' && candidate !== current) {
    onConflict(current, candidate);
  }
  return current;
}
