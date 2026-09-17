import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { groupByPatient, mergeDate } from '../src/fhir/patient-groups.js';
import { parseLegacyCsv } from '../src/legacy/parser.js';
import { legacyRecord } from './fixtures/records.js';

describe('groupByPatient', () => {
  it('gathers the rows of each MRN, in order of first appearance', () => {
    const { groups } = groupByPatient([
      legacyRecord({ recordId: 'A', mrn: 'MRN-1' }),
      legacyRecord({ recordId: 'B', mrn: 'MRN-2' }),
      legacyRecord({ recordId: 'C', mrn: 'MRN-1' }),
    ]);

    expect(groups.map((group) => group.mrn)).toEqual(['MRN-1', 'MRN-2']);
    expect(groups[0]?.records.map((record) => record.recordId)).toEqual(['A', 'C']);
  });

  it('copies the demographics of a patient seen only once', () => {
    const [group] = groupByPatient([legacyRecord()]).groups;

    expect(group).toMatchObject({
      mrn: 'MRN-10001',
      lastName: 'NOVAK',
      firstName: 'Elena',
      birthDate: '1998-03-12',
      sex: 'female',
    });
  });

  it('returns nothing for an export with no rows', () => {
    expect(groupByPatient([])).toEqual({ groups: [], warnings: [] });
  });

  it.each([
    ['a full date after a year', '1998', '1998-03-12'],
    ['a year after a full date', '1998-03-12', '1998'],
    ['a full date after a year and month', '1998-03', '1998-03-12'],
  ])('keeps the most precise birth date when given %s', (_label, first, second) => {
    const result = groupByPatient([
      legacyRecord({ birthDate: first }),
      legacyRecord({ birthDate: second, sourceRow: 3 }),
    ]);

    expect(result.groups[0]?.birthDate).toBe('1998-03-12');
    expect(result.warnings).toEqual([]);
  });

  it('keeps the earlier birth date and reports a real contradiction', () => {
    const result = groupByPatient([
      legacyRecord({ birthDate: '1998-03-12' }),
      legacyRecord({ birthDate: '1997', sourceRow: 7 }),
    ]);

    expect(result.groups[0]?.birthDate).toBe('1998-03-12');
    expect(result.warnings).toEqual([
      {
        sourceRow: 7,
        message:
          'MRN-10001: BIRTH_DT "1997" contradicts "1998-03-12" from an earlier row, so the earlier value is kept.',
      },
    ]);
  });

  it('fills a missing value from a later row', () => {
    const result = groupByPatient([
      legacyRecord({ lastName: undefined, birthDate: undefined, sex: 'unknown' }),
      legacyRecord({ lastName: 'NOVAK', birthDate: '1998', sex: 'female', sourceRow: 3 }),
    ]);

    expect(result.groups[0]).toMatchObject({ lastName: 'NOVAK', birthDate: '1998', sex: 'female' });
    expect(result.warnings).toEqual([]);
  });

  it('does not treat a later missing value as a contradiction', () => {
    const result = groupByPatient([
      legacyRecord(),
      legacyRecord({ lastName: undefined, firstName: undefined, birthDate: undefined, sex: 'unknown' }),
    ]);

    expect(result.groups[0]).toMatchObject({ lastName: 'NOVAK', birthDate: '1998-03-12', sex: 'female' });
    expect(result.warnings).toEqual([]);
  });

  it('reports names that differ only in case instead of guessing which is right', () => {
    const result = groupByPatient([legacyRecord(), legacyRecord({ lastName: 'Novak', sourceRow: 3 })]);

    expect(result.groups[0]?.lastName).toBe('NOVAK');
    expect(result.warnings.map((warning) => warning.message)).toEqual([
      'MRN-10001: LAST_NAME "Novak" contradicts "NOVAK" from an earlier row, so the earlier value is kept.',
    ]);
  });

  it('reports contradicting first names and sexes', () => {
    const result = groupByPatient([
      legacyRecord(),
      legacyRecord({ firstName: 'Helena', sex: 'male', sourceRow: 3 }),
    ]);

    expect(result.groups[0]).toMatchObject({ firstName: 'Elena', sex: 'female' });
    expect(result.warnings).toHaveLength(2);
  });
});

describe('mergeDate', () => {
  const noConflict = (): void => {
    throw new Error('no conflict was expected');
  };

  it('takes the candidate when there is nothing yet', () => {
    expect(mergeDate(undefined, '1998', noConflict)).toBe('1998');
  });

  it('stays empty when both are empty', () => {
    expect(mergeDate(undefined, undefined, noConflict)).toBeUndefined();
  });

  it('keeps an identical date without reporting it', () => {
    expect(mergeDate('1998-03-12', '1998-03-12', noConflict)).toBe('1998-03-12');
  });

  it('does not mistake a different month for more precision', () => {
    const conflicts: string[] = [];
    const merged = mergeDate('1998-03', '1998-04-01', (_kept, discarded) => conflicts.push(discarded));

    expect(merged).toBe('1998-03');
    expect(conflicts).toEqual(['1998-04-01']);
  });
});

describe('groupByPatient, the shipped export', () => {
  const { records } = parseLegacyCsv(readFileSync(new URL('../data/legacy-export.csv', import.meta.url)));
  const result = groupByPatient(records);

  it('finds 22 patients in 23 rows', () => {
    expect(result.groups).toHaveLength(22);
  });

  it('merges the two rows of MRN-10001 and keeps the full birth date', () => {
    const novak = result.groups.find((group) => group.mrn === 'MRN-10001');

    expect(novak?.records.map((record) => record.recordId)).toEqual(['P0001', 'P0003']);
    expect(novak?.birthDate).toBe('1998-03-12');
  });

  it('finds no contradictions between rows', () => {
    expect(result.warnings).toEqual([]);
  });
});
