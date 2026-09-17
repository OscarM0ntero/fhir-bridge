import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  mapCondition,
  mapObservation,
  mapPatient,
  toFhirDateTime,
  type MappingContext,
} from '../src/fhir/mapper.js';
import { groupByPatient, type PatientGroup } from '../src/fhir/patient-groups.js';
import { parseLegacyCsv } from '../src/legacy/parser.js';
import { legacyDiagnosis, legacyLabResult, legacyRecord } from './fixtures/records.js';

const CONTEXT: MappingContext = { patientReference: 'Patient/123', timezoneOffset: 'Z' };

const TEST_DATA_META = {
  security: [
    { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'HTEST', display: 'test health data' },
  ],
};

function patientGroup(overrides: Partial<PatientGroup> = {}): PatientGroup {
  return {
    mrn: 'MRN-10001',
    lastName: 'NOVAK',
    firstName: 'Elena',
    birthDate: '1998-03-12',
    sex: 'female',
    records: [legacyRecord()],
    ...overrides,
  };
}

describe('mapPatient', () => {
  it('builds the Patient agreed for row P0001', () => {
    expect(mapPatient(patientGroup())).toEqual({
      resourceType: 'Patient',
      meta: TEST_DATA_META,
      identifier: [
        {
          use: 'usual',
          type: {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
                code: 'MR',
                display: 'Medical record number',
              },
            ],
          },
          system: 'http://example.org/fhir/sid/legacy-mrn',
          value: 'MRN-10001',
        },
      ],
      name: [{ use: 'official', family: 'NOVAK', given: ['Elena'] }],
      gender: 'female',
      birthDate: '1998-03-12',
    });
  });

  it('sets no id, because the server assigns it', () => {
    expect(mapPatient(patientGroup())).not.toHaveProperty('id');
  });

  it('keeps the name exactly as the legacy system wrote it', () => {
    const patient = mapPatient(patientGroup({ lastName: 'van der BERG', firstName: 'DAVID' }));
    expect(patient.name).toEqual([{ use: 'official', family: 'van der BERG', given: ['DAVID'] }]);
  });

  it('writes only the given name when there is no surname', () => {
    const patient = mapPatient(patientGroup({ lastName: undefined, firstName: 'Ahmed' }));
    expect(patient.name).toEqual([{ use: 'official', given: ['Ahmed'] }]);
  });

  it('leaves the name out entirely when the export has none', () => {
    const patient = mapPatient(patientGroup({ lastName: undefined, firstName: undefined }));
    expect(patient).not.toHaveProperty('name');
  });

  it('keeps a partial birth date as a partial date', () => {
    expect(mapPatient(patientGroup({ birthDate: '1998' })).birthDate).toBe('1998');
  });

  it('leaves the birth date out when it is unknown', () => {
    expect(mapPatient(patientGroup({ birthDate: undefined }))).not.toHaveProperty('birthDate');
  });

  it('states an unknown gender explicitly, since unknown is a valid FHIR value', () => {
    expect(mapPatient(patientGroup({ sex: 'unknown' })).gender).toBe('unknown');
  });
});

describe('mapCondition', () => {
  it('builds the Condition agreed for row P0001', () => {
    const { resource, warnings } = mapCondition(legacyRecord(), CONTEXT);

    expect(warnings).toEqual([]);
    expect(resource).toEqual({
      resourceType: 'Condition',
      meta: TEST_DATA_META,
      identifier: [{ system: 'http://example.org/fhir/sid/legacy-record-id', value: 'P0001' }],
      clinicalStatus: {
        coding: [
          { system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active', display: 'Active' },
        ],
      },
      verificationStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
            code: 'confirmed',
            display: 'Confirmed',
          },
        ],
      },
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/condition-category',
              code: 'problem-list-item',
              display: 'Problem List Item',
            },
          ],
        },
      ],
      code: {
        coding: [
          { system: 'https://www.orpha.net', code: '324', display: 'Fabry disease' },
          { system: 'http://hl7.org/fhir/sid/icd-10', code: 'E75.2', display: 'Other sphingolipidosis' },
          {
            system: 'http://example.org/fhir/CodeSystem/legacy-diagnosis-codes',
            code: 'RD-014',
            display: 'Fabry disease',
          },
        ],
        text: 'Fabry disease',
      },
      subject: { reference: 'Patient/123' },
      onsetAge: { value: 21, unit: 'years', system: 'http://unitsofmeasure.org', code: 'a' },
      recordedDate: '2019-06-04',
    });
  });

  it.each([
    ['active', 'active', 'confirmed'],
    ['resolved', 'resolved', 'confirmed'],
    ['suspected', 'active', 'provisional'],
  ] as const)('maps the legacy status %s to %s and %s', (status, clinical, verification) => {
    const { resource } = mapCondition(legacyRecord({ diagnosis: legacyDiagnosis({ status }) }), CONTEXT);

    expect(resource.clinicalStatus?.coding?.[0]?.code).toBe(clinical);
    expect(resource.verificationStatus?.coding?.[0]?.code).toBe(verification);
  });

  it('leaves both statuses out when the legacy status is unknown, and says so', () => {
    const record = legacyRecord({ diagnosis: legacyDiagnosis({ status: 'unknown' }) });
    const { resource, warnings } = mapCondition(record, CONTEXT);

    expect(resource).not.toHaveProperty('clinicalStatus');
    expect(resource).not.toHaveProperty('verificationStatus');
    expect(warnings.map((warning) => warning.message)).toEqual([
      'DX_STATUS was not recognised, so clinicalStatus and verificationStatus are left out.',
    ]);
  });

  it('keeps a diagnosis with no code as free text, with no coding', () => {
    const record = legacyRecord({
      sourceRow: 3,
      diagnosis: legacyDiagnosis({
        localCode: undefined,
        text: 'Suspected mitochondrial myopathy, pending genetics',
      }),
    });
    const { resource, warnings } = mapCondition(record, CONTEXT);

    expect(resource.code).toEqual({ text: 'Suspected mitochondrial myopathy, pending genetics' });
    expect(warnings).toEqual([
      { sourceRow: 3, message: 'DX_CODE is empty, so the diagnosis is kept as free text with no coding.' },
    ]);
  });

  it('codes an unmapped diagnosis with its local code, using the row text as display', () => {
    const record = legacyRecord({
      diagnosis: legacyDiagnosis({ localCode: 'RD-410', text: 'Hereditary angioedema type I' }),
    });
    const { resource, warnings } = mapCondition(record, CONTEXT);

    expect(resource.code).toEqual({
      coding: [
        {
          system: 'http://example.org/fhir/CodeSystem/legacy-diagnosis-codes',
          code: 'RD-410',
          display: 'Hereditary angioedema type I',
        },
      ],
      text: 'Hereditary angioedema type I',
    });
    expect(warnings[0]?.message).toContain('RD-410 has no standard mapping');
  });

  it('writes no display for an unmapped code that came with no text', () => {
    const record = legacyRecord({ diagnosis: legacyDiagnosis({ localCode: 'RD-410', text: undefined }) });

    expect(mapCondition(record, CONTEXT).resource.code).toEqual({
      coding: [{ system: 'http://example.org/fhir/CodeSystem/legacy-diagnosis-codes', code: 'RD-410' }],
    });
  });

  it('prefers the text the clinician wrote over the catalogue name', () => {
    const record = legacyRecord({ diagnosis: legacyDiagnosis({ localCode: 'RD-207', text: 'Pompe disease (late onset)' }) });
    expect(mapCondition(record, CONTEXT).resource.code?.text).toBe('Pompe disease (late onset)');
  });

  it('falls back to the catalogue name when the row has no text', () => {
    const record = legacyRecord({ diagnosis: legacyDiagnosis({ localCode: 'RD-207', text: undefined }) });
    expect(mapCondition(record, CONTEXT).resource.code?.text).toBe('Pompe disease');
  });

  it('references the patient it is given', () => {
    const context = { ...CONTEXT, patientReference: 'Patient/abc-789' };
    expect(mapCondition(legacyRecord(), context).resource.subject).toEqual({ reference: 'Patient/abc-789' });
  });

  it('keeps an age of onset of zero, which is a value and not an absence', () => {
    const record = legacyRecord({ diagnosis: legacyDiagnosis({ onsetAgeYears: 0 }) });
    expect(mapCondition(record, CONTEXT).resource.onsetAge?.value).toBe(0);
  });

  it('leaves out the age of onset and the recorded date when the row has neither', () => {
    const record = legacyRecord({ diagnosis: legacyDiagnosis({ onsetAgeYears: undefined, recordedDate: undefined }) });
    const { resource } = mapCondition(record, CONTEXT);

    expect(resource).not.toHaveProperty('onsetAge');
    expect(resource).not.toHaveProperty('recordedDate');
  });

  it('adds the timezone offset to a recorded date that has a time', () => {
    const record = legacyRecord({
      diagnosis: legacyDiagnosis({ recordedDate: { date: '2019-06-04', time: '10:30:00' } }),
    });
    const context = { ...CONTEXT, timezoneOffset: '+02:00' };

    expect(mapCondition(record, context).resource.recordedDate).toBe('2019-06-04T10:30:00+02:00');
  });

  it('carries the row notes as a note on the condition', () => {
    const record = legacyRecord({ notes: 'family history: father, paternal aunt; genetics confirmed' });
    expect(mapCondition(record, CONTEXT).resource.note).toEqual([
      { text: 'family history: father, paternal aunt; genetics confirmed' },
    ]);
  });

  it('does not let two conditions share a coding object', () => {
    const first = mapCondition(legacyRecord(), CONTEXT).resource;
    const second = mapCondition(legacyRecord(), CONTEXT).resource;

    const firstCoding = first.clinicalStatus?.coding?.[0];
    if (firstCoding !== undefined) {
      firstCoding.code = 'tampered';
    }

    expect(second.clinicalStatus?.coding?.[0]?.code).toBe('active');
  });
});

describe('mapObservation', () => {
  it('builds the Observation agreed for row P0001', () => {
    const mapped = mapObservation(legacyRecord(), CONTEXT);

    expect(mapped?.warnings).toEqual([]);
    expect(mapped?.resource).toEqual({
      resourceType: 'Observation',
      meta: TEST_DATA_META,
      identifier: [{ system: 'http://example.org/fhir/sid/legacy-lab-result', value: 'P0001' }],
      status: 'final',
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'laboratory',
              display: 'Laboratory',
            },
          ],
        },
      ],
      code: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '24049-9',
            display: 'Alpha galactosidase A [Enzymatic activity/mass] in Leukocytes',
          },
          {
            system: 'http://example.org/fhir/CodeSystem/legacy-lab-codes',
            code: 'LB-AGAL',
            display: 'Alpha-galactosidase A activity',
          },
        ],
        text: 'Alpha-galactosidase A activity',
      },
      subject: { reference: 'Patient/123' },
      effectiveDateTime: '2019-06-02T09:15:00Z',
      valueQuantity: {
        value: 1.25,
        unit: 'nmol/h/mg',
        system: 'http://unitsofmeasure.org',
        code: 'nmol/h/mg',
      },
    });
  });

  it('returns nothing for a row with no laboratory result', () => {
    expect(mapObservation(legacyRecord({ labResult: undefined }), CONTEXT)).toBeUndefined();
  });

  it('writes a result below the detection limit as a comparator', () => {
    const record = legacyRecord({
      labResult: legacyLabResult({ measurement: { value: 0.5, comparator: '<', unit: 'nmol/h/mg' } }),
    });

    expect(mapObservation(record, CONTEXT)?.resource.valueQuantity).toEqual({
      value: 0.5,
      comparator: '<',
      unit: 'nmol/h/mg',
      system: 'http://unitsofmeasure.org',
      code: 'nmol/h/mg',
    });
  });

  it('repairs the case of a unit so it becomes valid UCUM', () => {
    const record = legacyRecord({
      labResult: legacyLabResult({
        localCode: 'LB-CERU',
        measurement: { value: 8, comparator: undefined, unit: 'mg/dl' },
      }),
    });
    const quantity = mapObservation(record, CONTEXT)?.resource.valueQuantity;

    expect(quantity?.code).toBe('mg/dL');
    expect(quantity?.unit).toBe('mg/dL');
  });

  it('keeps an unknown unit as readable text only, and says so', () => {
    const record = legacyRecord({
      labResult: legacyLabResult({ measurement: { value: 3, comparator: undefined, unit: 'spoons' } }),
    });
    const mapped = mapObservation(record, CONTEXT);

    expect(mapped?.resource.valueQuantity).toEqual({ value: 3, unit: 'spoons' });
    expect(mapped?.warnings[0]?.message).toBe(
      'LAB_UNIT "spoons" is not a known UCUM unit, so the quantity keeps it as text only.',
    );
  });

  it('writes only the value when the export gave no unit', () => {
    const record = legacyRecord({
      labResult: legacyLabResult({ measurement: { value: 3, comparator: undefined, unit: undefined } }),
    });

    expect(mapObservation(record, CONTEXT)?.resource.valueQuantity).toEqual({ value: 3 });
  });

  it('leaves out the effective time when the export gave none', () => {
    const record = legacyRecord({ labResult: legacyLabResult({ effective: undefined }) });
    expect(mapObservation(record, CONTEXT)?.resource).not.toHaveProperty('effectiveDateTime');
  });

  it('writes a date-only effective time without an offset', () => {
    const record = legacyRecord({
      labResult: legacyLabResult({ effective: { date: '2017-07-07', time: undefined } }),
    });
    expect(mapObservation(record, CONTEXT)?.resource.effectiveDateTime).toBe('2017-07-07');
  });

  it('codes a test with no LOINC equivalent locally, and says so', () => {
    const record = legacyRecord({ labResult: legacyLabResult({ localCode: 'LB-GBA' }) });
    const mapped = mapObservation(record, CONTEXT);

    expect(mapped?.resource.code.coding).toEqual([
      {
        system: 'http://example.org/fhir/CodeSystem/legacy-lab-codes',
        code: 'LB-GBA',
        display: 'Beta-glucosidase activity',
      },
    ]);
    expect(mapped?.warnings[0]?.message).toContain('LB-GBA has no LOINC equivalent');
  });

  it('codes a test missing from the table with its bare local code, and says so', () => {
    const record = legacyRecord({ labResult: legacyLabResult({ localCode: 'LB-NEW' }) });
    const mapped = mapObservation(record, CONTEXT);

    expect(mapped?.resource.code).toEqual({
      coding: [{ system: 'http://example.org/fhir/CodeSystem/legacy-lab-codes', code: 'LB-NEW' }],
    });
    expect(mapped?.warnings[0]?.message).toContain('LB-NEW is not in the terminology table');
  });
});

describe('toFhirDateTime', () => {
  it('leaves a date without a time untouched', () => {
    expect(toFhirDateTime({ date: '2019-06-04', time: undefined }, '+02:00')).toBe('2019-06-04');
  });

  it.each([
    ['Z', '2019-06-02T09:15:00Z'],
    ['+02:00', '2019-06-02T09:15:00+02:00'],
    ['-05:00', '2019-06-02T09:15:00-05:00'],
  ])('appends the offset %s to a date with a time', (offset, expected) => {
    expect(toFhirDateTime({ date: '2019-06-02', time: '09:15:00' }, offset)).toBe(expected);
  });
});

describe('mapping the shipped export', () => {
  const { records } = parseLegacyCsv(readFileSync(new URL('../data/legacy-export.csv', import.meta.url)));
  const { groups } = groupByPatient(records);

  const patients = groups.map((group) => mapPatient(group));
  const mapped = groups.flatMap((group) =>
    group.records.map((record) => {
      const context = { patientReference: `Patient/${group.mrn}`, timezoneOffset: 'Z' };
      return { condition: mapCondition(record, context), observation: mapObservation(record, context) };
    }),
  );
  const conditions = mapped.map((entry) => entry.condition);
  const observations = mapped.flatMap((entry) => (entry.observation === undefined ? [] : [entry.observation]));
  const resources = [...patients, ...conditions.map((c) => c.resource), ...observations.map((o) => o.resource)];

  it('produces 22 patients, 23 conditions and 15 observations', () => {
    expect(patients).toHaveLength(22);
    expect(conditions).toHaveLength(23);
    expect(observations).toHaveLength(15);
  });

  it('warns only about the rows that were built to need a decision', () => {
    // Rows 3 and 15 have no diagnosis code, row 14 has an unmapped one, and
    // rows 4 and 22 are beta-glucosidase results, which LOINC does not cover.
    const rows = [...conditions, ...observations].flatMap((entry) => entry.warnings.map((w) => w.sourceRow));
    expect(rows.sort((a, b) => a - b)).toEqual([3, 4, 14, 15, 22]);
  });

  it('points every condition and observation at the patient its row belongs to', () => {
    const novakConditions = conditions.filter((c) => c.resource.subject.reference === 'Patient/MRN-10001');
    expect(novakConditions.map((c) => c.resource.identifier?.[0]?.value)).toEqual(['P0001', 'P0003']);
  });

  it('never leaves a property set to undefined, which would not survive serialisation', () => {
    for (const resource of resources) {
      expect(pathsHoldingUndefined(resource)).toEqual([]);
    }
  });

  it('gives every coding a system, a code and a display', () => {
    const codings = resources.flatMap((resource) => codingsIn(resource));

    // Guards against the walker finding nothing, which would pass vacuously.
    // Patients alone carry 44: a security label and an MRN type each.
    expect(codings.length).toBeGreaterThan(44);
    for (const coding of codings) {
      expect(coding).toEqual({
        system: expect.any(String) as string,
        code: expect.any(String) as string,
        display: expect.any(String) as string,
      });
    }
  });

  it('writes every time of day with an offset', () => {
    const dateTimes = [
      ...conditions.map((c) => c.resource.recordedDate),
      ...observations.map((o) => o.resource.effectiveDateTime),
    ].filter((value): value is string => value?.includes('T') === true);

    expect(dateTimes.length).toBeGreaterThan(0);
    for (const value of dateTimes) {
      expect(value).toMatch(/T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/);
    }
  });
});

/** Walks a resource and lists the paths of any property holding undefined. */
function pathsHoldingUndefined(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => pathsHoldingUndefined(item, `${path}[${String(index)}]`));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) =>
      child === undefined ? [`${path}.${key}`] : pathsHoldingUndefined(child, `${path}.${key}`),
    );
  }
  return [];
}

/** Finds every Coding in a resource: under any coding array, and in meta.security. */
function codingsIn(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) => codingsIn(item));
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, child]: [string, unknown]) =>
    (key === 'coding' || key === 'security') && Array.isArray(child)
      ? child.map((item: unknown) => item)
      : codingsIn(child),
  );
}
