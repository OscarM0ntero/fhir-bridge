import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LegacyParseError, parseLegacyCsv } from '../src/legacy/parser.js';
import { LEGACY_COLUMNS, type LegacyRecord, type RejectedRow } from '../src/legacy/types.js';

const COMPLETE_ROW =
  'P0001;MRN-10001;Novak;Elena;12/03/1998;F;RD-014;Fabry disease;2019-06-04;ACT;21;LB-AGAL;1,25;nmol/h/mg;2019-06-02 09:15;first visit';

/** Builds a one-off export with the real header and the given rows. */
function csv(...rows: readonly string[]): string {
  return [LEGACY_COLUMNS.join(';'), ...rows].join('\n');
}

/** Parses a single row that is expected to be accepted. */
function accepted(row: string): LegacyRecord {
  const result = parseLegacyCsv(csv(row));
  expect(result.rejected).toEqual([]);

  const [record] = result.records;
  if (record === undefined) {
    throw new Error('expected the row to be accepted');
  }
  return record;
}

/** Parses a single row that is expected to be rejected. */
function rejected(row: string): RejectedRow {
  const result = parseLegacyCsv(csv(row));
  expect(result.records).toEqual([]);

  const [rejection] = result.rejected;
  if (rejection === undefined) {
    throw new Error('expected the row to be rejected');
  }
  return rejection;
}

describe('parseLegacyCsv, complete row', () => {
  it('reads the patient', () => {
    const record = accepted(COMPLETE_ROW);

    expect(record.patientId).toBe('P0001');
    expect(record.mrn).toBe('MRN-10001');
    expect(record.lastName).toBe('Novak');
    expect(record.firstName).toBe('Elena');
    expect(record.birthDate).toBe('1998-03-12');
    expect(record.sex).toBe('female');
    expect(record.notes).toBe('first visit');
  });

  it('reads the diagnosis', () => {
    expect(accepted(COMPLETE_ROW).diagnosis).toEqual({
      localCode: 'RD-014',
      text: 'Fabry disease',
      recordedDate: { date: '2019-06-04', time: undefined },
      status: 'active',
      onsetAgeYears: 21,
    });
  });

  it('reads the laboratory result', () => {
    expect(accepted(COMPLETE_ROW).labResult).toEqual({
      localCode: 'LB-AGAL',
      measurement: { value: 1.25, comparator: undefined, unit: 'nmol/h/mg' },
      effective: { date: '2019-06-02', time: '09:15:00' },
    });
  });

  it('records the line the row came from', () => {
    // Line 1 is the header, so the first record sits on line 2.
    expect(accepted(COMPLETE_ROW).sourceRow).toBe(2);
  });

  it('keeps the untouched row for the side-by-side report', () => {
    expect(accepted(COMPLETE_ROW).raw['LAB_VALUE']).toBe('1,25');
  });
});

describe('parseLegacyCsv, rejected rows', () => {
  it('rejects a row with no MRN, because nothing can be tied to a patient', () => {
    const row = 'P0023;;Moreau;Theo;18/03/2008;M;RD-160;Marfan syndrome;2019-02-20;ACT;10;;;;;';
    expect(rejected(row).reason).toContain('MRN is empty');
  });

  it('reports which source row was rejected', () => {
    const row = 'P0023;;Moreau;Theo;18/03/2008;M;RD-160;Marfan syndrome;2019-02-20;ACT;10;;;;;';
    expect(rejected(row)).toMatchObject({ sourceRow: 2, patientId: 'P0023' });
  });

  it('rejects a row with no PAT_ID', () => {
    const row = ';MRN-10099;Moreau;Theo;18/03/2008;M;RD-160;Marfan syndrome;2019-02-20;ACT;10;;;;;';
    expect(rejected(row).reason).toContain('PAT_ID is empty');
  });

  it('rejects a birth date that does not exist on the calendar', () => {
    const row = 'P0024;MRN-10024;Jansen;Sanne;31/02/2001;F;RD-062;Phenylketonuria;2003-01-10;ACT;1;;;;;';
    expect(rejected(row).reason).toContain('BIRTH_DT');
  });

  it('rejects a row that carries no diagnosis at all', () => {
    const row = 'P0030;MRN-10030;Doe;Jane;1990-01-01;F;;;2019-02-20;ACT;;;;;;';
    expect(rejected(row).reason).toContain('neither DX_CODE nor DX_TEXT');
  });

  it('rejects an unreadable diagnosis date', () => {
    const row = 'P0031;MRN-10031;Doe;Jane;1990-01-01;F;RD-014;Fabry disease;yesterday;ACT;;;;;;';
    expect(rejected(row).reason).toContain('DX_DATE');
  });

  it('keeps the other rows when one is rejected', () => {
    const badRow = 'P0023;;Moreau;Theo;18/03/2008;M;RD-160;Marfan syndrome;2019-02-20;ACT;10;;;;;';
    const result = parseLegacyCsv(csv(COMPLETE_ROW, badRow, COMPLETE_ROW));

    expect(result.records).toHaveLength(2);
    expect(result.rejected).toHaveLength(1);
  });
});

describe('parseLegacyCsv, missing optional fields', () => {
  it('accepts a row with no birth date', () => {
    const row = 'P0018;MRN-10018;Garcia;Mateo;   ;M;RD-118;Duchenne muscular dystrophy;2014-06-01;ACT;5;;;;;';
    expect(accepted(row).birthDate).toBeUndefined();
  });

  it('keeps a partial birth date as recorded', () => {
    const row = 'P0003;MRN-10001;Novak;Elena;1998;F;RD-101;Gaucher disease type 1;2022-01-17;ACT;24;;;;;';
    expect(accepted(row).birthDate).toBe('1998');
  });

  it('accepts a diagnosis with free text and no local code', () => {
    const row = 'P0014;MRN-10014;Silva;Ana;17/09/1999;F;;Ehlers-Danlos syndrome, hypermobile type;2021-03-12;ACT;;;;;;';
    const diagnosis = accepted(row).diagnosis;

    expect(diagnosis.localCode).toBeUndefined();
    expect(diagnosis.text).toBe('Ehlers-Danlos syndrome, hypermobile type');
  });

  it('accepts a row with no laboratory block', () => {
    const row = 'P0011;MRN-10011;Dubois;Camille;03/05/2015;2;RD-341;Rett syndrome;2018-10-02;ACT;2;;;;;';
    expect(accepted(row).labResult).toBeUndefined();
  });

  it('does not treat two rows sharing an MRN as one', () => {
    // Merging them into a single patient is the mapper's job, not the parser's.
    const second = 'P0003;MRN-10001;Novak;Elena;1998;F;RD-101;Gaucher disease type 1;2022-01-17;ACT;24;;;;;';
    const result = parseLegacyCsv(csv(COMPLETE_ROW, second));

    expect(result.records).toHaveLength(2);
    expect(result.records.map((record) => record.mrn)).toEqual(['MRN-10001', 'MRN-10001']);
  });
});

describe('parseLegacyCsv, warnings', () => {
  it('drops a laboratory result that reports no usable value', () => {
    const row = 'P0015;MRN-10015;Nakamura;Yuki;11-11-1988;F;RD-014;Fabry disease;2017-07-07;RES;29;LB-AGAL;N/A;nmol/h/mg;07/07/2017;';
    const result = parseLegacyCsv(csv(row));

    expect(result.records[0]?.labResult).toBeUndefined();
    expect(result.warnings).toEqual([
      {
        sourceRow: 2,
        column: 'LAB_VALUE',
        message: 'test LB-AGAL reported no usable value, the result is dropped.',
      },
    ]);
  });

  it('warns when a value arrives without a test code', () => {
    const row = 'P0040;MRN-10040;Doe;Jane;1990-01-01;F;RD-014;Fabry disease;2019-01-01;ACT;;;7,5;mg/dL;2019-01-01;';
    const result = parseLegacyCsv(csv(row));

    expect(result.warnings[0]?.column).toBe('LAB_CODE');
    expect(result.records[0]?.labResult).toBeUndefined();
  });

  it('drops a laboratory value that is not a number', () => {
    const row = 'P0041;MRN-10041;Doe;Jane;1990-01-01;F;RD-014;Fabry disease;2019-01-01;ACT;;LB-AGAL;pending;mg/dL;2019-01-01;';
    const result = parseLegacyCsv(csv(row));

    expect(result.warnings[0]?.message).toContain('is not a number');
    expect(result.records[0]?.labResult).toBeUndefined();
  });

  it('keeps a laboratory result whose date is unreadable, without the date', () => {
    const row = 'P0042;MRN-10042;Doe;Jane;1990-01-01;F;RD-014;Fabry disease;2019-01-01;ACT;;LB-AGAL;1,9;mg/dL;last summer;';
    const result = parseLegacyCsv(csv(row));

    expect(result.warnings[0]?.column).toBe('LAB_DT');
    expect(result.records[0]?.labResult?.measurement.value).toBe(1.9);
    expect(result.records[0]?.labResult?.effective).toBeUndefined();
  });

  it('drops an age of onset that is not a whole number of years', () => {
    const row = 'P0043;MRN-10043;Doe;Jane;1990-01-01;F;RD-014;Fabry disease;2019-01-01;ACT;-4;;;;;';
    const result = parseLegacyCsv(csv(row));

    expect(result.warnings[0]?.column).toBe('ONSET_AGE');
    expect(result.records[0]?.diagnosis.onsetAgeYears).toBeUndefined();
  });

  it('reports no warnings for a clean row', () => {
    expect(parseLegacyCsv(csv(COMPLETE_ROW)).warnings).toEqual([]);
  });
});

describe('parseLegacyCsv, unreadable files', () => {
  it('refuses a file whose columns are not the expected ones', () => {
    const content = ['id;name;diagnosis', '1;Jane;Fabry disease'].join('\n');
    expect(() => parseLegacyCsv(content)).toThrow(LegacyParseError);
  });

  it('refuses an empty file instead of reporting an empty migration', () => {
    expect(() => parseLegacyCsv('')).toThrow(LegacyParseError);
    expect(() => parseLegacyCsv('   \n  ')).toThrow(LegacyParseError);
  });

  it('refuses a row with more fields than the header declares', () => {
    expect(() => parseLegacyCsv(csv(`${COMPLETE_ROW};extra`))).toThrow(LegacyParseError);
  });
});

describe('parseLegacyCsv, the shipped export', () => {
  const content = readFileSync(new URL('../data/legacy-export.csv', import.meta.url));
  const result = parseLegacyCsv(content);

  function byPatientId(patientId: string): LegacyRecord {
    const record = result.records.find((candidate) => candidate.patientId === patientId);
    if (record === undefined) {
      throw new Error(`no record was parsed for ${patientId}`);
    }
    return record;
  }

  it('accepts every row but the two that cannot be interpreted', () => {
    expect(result.records).toHaveLength(23);
    expect(result.rejected.map((rejection) => rejection.patientId)).toEqual(['P0023', 'P0024']);
  });

  it('reads the file despite the byte order mark', () => {
    expect(byPatientId('P0001').mrn).toBe('MRN-10001');
  });

  it('finds 22 distinct patients across 23 rows', () => {
    // P0001 and P0003 are the same person seen twice.
    expect(new Set(result.records.map((record) => record.mrn)).size).toBe(22);
  });

  it('keeps the semicolon inside a quoted field', () => {
    expect(byPatientId('P0005').notes).toBe(
      'family history: father, paternal aunt; genetics confirmed',
    );
  });

  it('keeps accented characters intact', () => {
    expect(byPatientId('P0008').firstName).toBe('Luísa');
    expect(byPatientId('P0009').lastName).toBe('Müller');
  });

  it('reads a result reported below the detection limit', () => {
    expect(byPatientId('P0003').labResult?.measurement).toEqual({
      value: 0.5,
      comparator: '<',
      unit: 'nmol/h/mg',
    });
  });

  it('keeps the local code of a diagnosis that no terminology maps yet', () => {
    expect(byPatientId('P0013').diagnosis.localCode).toBe('RD-410');
  });

  it('accepts a patient with no surname', () => {
    expect(byPatientId('P0020').lastName).toBeUndefined();
    expect(byPatientId('P0020').firstName).toBe('Ahmed');
  });

  it('warns about the two laboratory results it had to drop', () => {
    expect(result.warnings.map((warning) => warning.sourceRow)).toEqual([16, 17]);
    expect(result.warnings.every((warning) => warning.column === 'LAB_VALUE')).toBe(true);
  });
});
