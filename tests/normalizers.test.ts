import { describe, expect, it } from 'vitest';

import {
  normalizeAgeYears,
  normalizeDate,
  normalizeDiagnosisStatus,
  normalizeMeasurement,
  normalizeSex,
  normalizeText,
  normalizeTime,
  normalizeTimestamp,
  type Normalized,
} from '../src/legacy/normalizers.js';

/** Unwraps a successful normalisation, failing the test when it went wrong. */
function value<T>(result: Normalized<T>): T {
  if (!result.ok) {
    throw new Error(`expected a normalised value but got the error: ${result.error}`);
  }
  return result.value;
}

describe('normalizeText', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeText('  NOVAK ')).toBe('NOVAK');
  });

  it('keeps whitespace inside the value', () => {
    expect(normalizeText(' Fabry disease ')).toBe('Fabry disease');
  });

  it.each(['', '   ', 'N/A', 'n/a', 'NULL', '-', 'unknown'])('reports %s as absent', (raw) => {
    expect(normalizeText(raw)).toBeUndefined();
  });
});

describe('normalizeDate', () => {
  it.each([
    ['1998-03-12', '1998-03-12'],
    ['12/03/1998', '1998-03-12'],
    ['12-03-1998', '1998-03-12'],
    ['19980312', '1998-03-12'],
    ['  1998-03-12  ', '1998-03-12'],
  ])('reads %s as %s', (raw, expected) => {
    expect(value(normalizeDate(raw))).toBe(expected);
  });

  it('reads slash dates day first, not month first', () => {
    // 05-09-2003 is the 5th of September, not the 9th of May.
    expect(value(normalizeDate('05-09-2003'))).toBe('2003-09-05');
  });

  it.each([
    ['1998', '1998'],
    ['2001-12', '2001-12'],
  ])('keeps the partial date %s as %s', (raw, expected) => {
    // FHIR dates may be partial, so a year-only birth date stays a year
    // instead of being padded to an invented first of January.
    expect(value(normalizeDate(raw))).toBe(expected);
  });

  it.each(['2000-02-29', '29/02/2000', '2024-02-29'])('accepts the leap day %s', (raw) => {
    expect(normalizeDate(raw).ok).toBe(true);
  });

  it.each(['2001-02-29', '31/02/2001', '2001-13-01', '1998-00-10', '00/01/2020', '32/01/2020', '2001-13'])(
    'rejects the impossible date %s',
    (raw) => {
      expect(normalizeDate(raw).ok).toBe(false);
    },
  );

  it.each(['', 'March 1998', '12/03/98', '1998/03/12', '198-03-12'])('rejects %s as unreadable', (raw) => {
    expect(normalizeDate(raw).ok).toBe(false);
  });
});

describe('normalizeTime', () => {
  it.each([
    ['09:15', '09:15:00'],
    ['09:15:30', '09:15:30'],
    ['00:00', '00:00:00'],
    ['23:59:59', '23:59:59'],
  ])('reads %s as %s', (raw, expected) => {
    expect(value(normalizeTime(raw))).toBe(expected);
  });

  it.each(['24:00', '09:60', '09:15:60', '9:15', '0915', 'noon'])('rejects the time %s', (raw) => {
    expect(normalizeTime(raw).ok).toBe(false);
  });
});

describe('normalizeTimestamp', () => {
  it('reads a date with no time of day', () => {
    expect(value(normalizeTimestamp('2019-06-04'))).toEqual({ date: '2019-06-04', time: undefined });
  });

  it('reads a date followed by a time', () => {
    expect(value(normalizeTimestamp('2019-06-02 09:15'))).toEqual({
      date: '2019-06-02',
      time: '09:15:00',
    });
  });

  it('reads a day-first date followed by a time', () => {
    expect(value(normalizeTimestamp('22/05/2013 14:30'))).toEqual({
      date: '2013-05-22',
      time: '14:30:00',
    });
  });

  it('accepts T as the separator', () => {
    expect(value(normalizeTimestamp('2019-06-02T09:15'))).toEqual({
      date: '2019-06-02',
      time: '09:15:00',
    });
  });

  it('rejects a time of day on a partial date', () => {
    // A time needs a place on the calendar, and a year alone does not give one.
    expect(normalizeTimestamp('1998 09:15').ok).toBe(false);
  });

  it.each(['2019-06-02 25:00', '2019-06-02 09:15 extra', '31/02/2001 09:15'])('rejects %s', (raw) => {
    expect(normalizeTimestamp(raw).ok).toBe(false);
  });
});

describe('normalizeSex', () => {
  it.each([
    ['M', 'male'],
    ['m', 'male'],
    ['MALE', 'male'],
    ['F', 'female'],
    ['f', 'female'],
    ['FEMALE', 'female'],
    ['1', 'male'],
    ['2', 'female'],
  ])('reads %s as %s', (raw, expected) => {
    // 1 and 2 are the ISO 5218 codes the legacy system uses.
    expect(normalizeSex(raw)).toBe(expected);
  });

  it.each(['U', '9', '', '   ', 'X', 'other'])('reads %s as unknown', (raw) => {
    expect(normalizeSex(raw)).toBe('unknown');
  });
});

describe('normalizeDiagnosisStatus', () => {
  it.each([
    ['ACT', 'active'],
    ['act', 'active'],
    ['ACTIVE', 'active'],
    ['RES', 'resolved'],
    ['SUSP', 'suspected'],
  ])('reads %s as %s', (raw, expected) => {
    expect(normalizeDiagnosisStatus(raw)).toBe(expected);
  });

  it.each(['', 'PEND', 'whatever'])('reads %s as unknown', (raw) => {
    expect(normalizeDiagnosisStatus(raw)).toBe('unknown');
  });
});

describe('normalizeMeasurement', () => {
  it('reads a decimal written with a comma', () => {
    expect(value(normalizeMeasurement('1,25'))).toEqual({
      value: 1.25,
      comparator: undefined,
      unit: undefined,
    });
  });

  it('reads a result below the detection limit as a comparator', () => {
    // FHIR models "<0.5" as a quantity with a comparator, never as free text.
    expect(value(normalizeMeasurement('<0.5'))).toEqual({
      value: 0.5,
      comparator: '<',
      unit: undefined,
    });
  });

  it.each([
    ['<=10', '<=', 10],
    ['>=10', '>=', 10],
    ['> 10', '>', 10],
  ])('reads %s as %s %d', (raw, comparator, expected) => {
    const measurement = value(normalizeMeasurement(raw));
    expect(measurement.comparator).toBe(comparator);
    expect(measurement.value).toBe(expected);
  });

  it('keeps the unit as the legacy system wrote it', () => {
    // Translating mg/dl to UCUM is the terminology step's job, not this one's.
    expect(value(normalizeMeasurement('8', ' mg/dl ')).unit).toBe('mg/dl');
  });

  it('reports a placeholder unit as absent', () => {
    expect(value(normalizeMeasurement('8', 'N/A')).unit).toBeUndefined();
  });

  it.each(['abc', '1.2.3', '', '<', '1,2,3', '12 500'])('rejects %s', (raw) => {
    expect(normalizeMeasurement(raw).ok).toBe(false);
  });
});

describe('normalizeAgeYears', () => {
  it.each([
    ['0', 0],
    ['21', 21],
    [' 60 ', 60],
  ])('reads %s as %d', (raw, expected) => {
    expect(value(normalizeAgeYears(raw))).toBe(expected);
  });

  it.each(['-1', '1.5', 'abc', ''])('rejects %s', (raw) => {
    expect(normalizeAgeYears(raw).ok).toBe(false);
  });
});
