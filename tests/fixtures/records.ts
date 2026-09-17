import type { LegacyDiagnosis, LegacyLabResult, LegacyRecord } from '../../src/legacy/types.js';

/** The diagnosis of row P0001: Fabry disease, active, recorded without a time. */
export function legacyDiagnosis(overrides: Partial<LegacyDiagnosis> = {}): LegacyDiagnosis {
  return {
    localCode: 'RD-014',
    text: 'Fabry disease',
    recordedDate: { date: '2019-06-04', time: undefined },
    status: 'active',
    onsetAgeYears: 21,
    ...overrides,
  };
}

/** The lab result of row P0001: alpha-galactosidase A, taken at 09:15. */
export function legacyLabResult(overrides: Partial<LegacyLabResult> = {}): LegacyLabResult {
  return {
    localCode: 'LB-AGAL',
    measurement: { value: 1.25, comparator: undefined, unit: 'nmol/h/mg' },
    effective: { date: '2019-06-02', time: '09:15:00' },
    ...overrides,
  };
}

/** Row P0001 of the shipped export, already parsed. */
export function legacyRecord(overrides: Partial<LegacyRecord> = {}): LegacyRecord {
  return {
    sourceRow: 2,
    recordId: 'P0001',
    mrn: 'MRN-10001',
    lastName: 'NOVAK',
    firstName: 'Elena',
    birthDate: '1998-03-12',
    sex: 'female',
    diagnosis: legacyDiagnosis(),
    labResult: legacyLabResult(),
    notes: undefined,
    raw: {},
    ...overrides,
  };
}
