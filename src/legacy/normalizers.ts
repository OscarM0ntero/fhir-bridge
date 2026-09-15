import type {
  LegacyComparator,
  LegacyDiagnosisStatus,
  LegacyMeasurement,
  LegacySex,
  LegacyTimestamp,
} from './types.js';

/** Outcome of normalising a value that the legacy system may have mangled. */
export type Normalized<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/**
 * Slash and dash dates are read day first. The legacy system is European and
 * writes 12/03/1998 for the 12th of March. This is an assumption the export
 * itself cannot confirm, so it is stated here, in the README and in the tests.
 */
const DAY_FIRST_DATE = /^\d{2}[/-]\d{2}[/-]\d{4}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const COMPACT_DATE = /^\d{8}$/;
const ISO_YEAR_MONTH = /^\d{4}-\d{2}$/;
const ISO_YEAR = /^\d{4}$/;
const TIME_OF_DAY = /^\d{2}:\d{2}(?::\d{2})?$/;
const DECIMAL = /^-?\d+(?:\.\d+)?$/;

/** Values the legacy system writes to mean "nothing was recorded". */
const NULL_MARKERS = ['n/a', 'na', 'null', '-', 'unknown'];

const COMPARATORS: readonly LegacyComparator[] = ['<=', '>=', '<', '>'];

const SEX_CODES = new Map<string, LegacySex>([
  ['m', 'male'],
  ['male', 'male'],
  ['f', 'female'],
  ['female', 'female'],
  // 1 and 2 are the ISO 5218 codes for male and female.
  ['1', 'male'],
  ['2', 'female'],
  ['u', 'unknown'],
  ['9', 'unknown'],
]);

const STATUS_CODES = new Map<string, LegacyDiagnosisStatus>([
  ['act', 'active'],
  ['active', 'active'],
  ['res', 'resolved'],
  ['resolved', 'resolved'],
  ['susp', 'suspected'],
  ['suspected', 'suspected'],
]);

/** Trims a raw field and reports blank or placeholder content as absent. */
export function normalizeText(raw: string): string | undefined {
  const value = raw.trim();
  if (value === '' || NULL_MARKERS.includes(value.toLowerCase())) {
    return undefined;
  }
  return value;
}

/**
 * Reads the date formats the export mixes and returns a FHIR date. The result
 * keeps the precision of the source: a row that only recorded a year yields a
 * year, because FHIR dates are allowed to be partial and inventing a January
 * 1st would be inventing clinical data.
 */
export function normalizeDate(raw: string): Normalized<string> {
  const value = raw.trim();

  if (ISO_DATE.test(value)) {
    return buildDate(value.slice(0, 4), value.slice(5, 7), value.slice(8, 10), value);
  }
  if (DAY_FIRST_DATE.test(value)) {
    return buildDate(value.slice(6, 10), value.slice(3, 5), value.slice(0, 2), value);
  }
  if (COMPACT_DATE.test(value)) {
    return buildDate(value.slice(0, 4), value.slice(4, 6), value.slice(6, 8), value);
  }
  if (ISO_YEAR_MONTH.test(value)) {
    const month = Number(value.slice(5, 7));
    if (month < 1 || month > 12) {
      return fail(`"${value}" is not a valid year and month.`);
    }
    return { ok: true, value };
  }
  if (ISO_YEAR.test(value)) {
    return { ok: true, value };
  }

  return fail(`"${value}" is not written in any date format this export uses.`);
}

/**
 * Reads a date that may be followed by a time of day. A time without a date
 * makes no sense, and a time on a partial date cannot be placed on a calendar,
 * so both are rejected rather than guessed.
 */
export function normalizeTimestamp(raw: string): Normalized<LegacyTimestamp> {
  const parts = raw.trim().split(/[ T]+/);
  const [datePart, timePart, ...extra] = parts;

  if (datePart === undefined || extra.length > 0) {
    return fail(`"${raw.trim()}" is not a valid date and time.`);
  }

  const date = normalizeDate(datePart);
  if (!date.ok) {
    return date;
  }

  if (timePart === undefined) {
    return { ok: true, value: { date: date.value, time: undefined } };
  }

  if (date.value.length !== 'YYYY-MM-DD'.length) {
    return fail(`"${raw.trim()}" states a time of day on a date that is not a full calendar date.`);
  }

  const time = normalizeTime(timePart);
  if (!time.ok) {
    return time;
  }

  return { ok: true, value: { date: date.value, time: time.value } };
}

/** Normalises a time of day to HH:MM:SS. */
export function normalizeTime(raw: string): Normalized<string> {
  const value = raw.trim();
  if (!TIME_OF_DAY.test(value)) {
    return fail(`"${value}" is not a valid time of day.`);
  }

  const hours = Number(value.slice(0, 2));
  const minutes = Number(value.slice(3, 5));
  const seconds = value.length > 5 ? Number(value.slice(6, 8)) : 0;

  if (hours > 23 || minutes > 59 || seconds > 59) {
    return fail(`"${value}" is not a valid time of day.`);
  }

  return { ok: true, value: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` };
}

/** Maps the several sex codes the export uses onto the three FHIR values. */
export function normalizeSex(raw: string): LegacySex {
  const value = normalizeText(raw)?.toLowerCase();
  if (value === undefined) {
    return 'unknown';
  }
  return SEX_CODES.get(value) ?? 'unknown';
}

/** Maps the export's diagnosis status codes. Anything unexpected is unknown. */
export function normalizeDiagnosisStatus(raw: string): LegacyDiagnosisStatus {
  const value = normalizeText(raw)?.toLowerCase();
  if (value === undefined) {
    return 'unknown';
  }
  return STATUS_CODES.get(value) ?? 'unknown';
}

/**
 * Reads a laboratory result. The export writes decimals with a comma and
 * reports results below the detection limit as "<0.5", which FHIR models as a
 * quantity with a comparator rather than as text.
 */
export function normalizeMeasurement(raw: string, unit?: string): Normalized<LegacyMeasurement> {
  let value = raw.trim();
  let comparator: LegacyComparator | undefined;

  for (const candidate of COMPARATORS) {
    if (value.startsWith(candidate)) {
      comparator = candidate;
      value = value.slice(candidate.length).trim();
      break;
    }
  }

  const decimal = value.replace(',', '.');
  if (!DECIMAL.test(decimal)) {
    return fail(`"${raw.trim()}" is not a number.`);
  }

  return {
    ok: true,
    value: { value: Number(decimal), comparator, unit: unit === undefined ? undefined : normalizeText(unit) },
  };
}

/** Reads an age in whole years. Negative or fractional ages are rejected. */
export function normalizeAgeYears(raw: string): Normalized<number> {
  const value = raw.trim();
  const parsed = Number(value);

  if (!DECIMAL.test(value) || !Number.isInteger(parsed) || parsed < 0) {
    return fail(`"${value}" is not an age in whole years.`);
  }

  return { ok: true, value: parsed };
}

function buildDate(
  year: string,
  month: string,
  day: string,
  original: string,
): Normalized<string> {
  const monthNumber = Number(month);
  const dayNumber = Number(day);

  if (monthNumber < 1 || monthNumber > 12) {
    return fail(`"${original}" states month ${month}, which does not exist.`);
  }
  if (dayNumber < 1 || dayNumber > daysInMonth(Number(year), monthNumber)) {
    return fail(`"${original}" is not a valid calendar date.`);
  }

  return { ok: true, value: `${year}-${month}-${day}` };
}

/** Day 0 of the next month is the last day of this one, leap years included. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function fail(error: string): Normalized<never> {
  return { ok: false, error };
}
