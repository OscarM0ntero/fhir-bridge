import { readFileSync } from 'node:fs';

import type { BundleEntry } from 'fhir/r4.js';
import { describe, expect, it } from 'vitest';

import { buildPatientTransaction, conditionalUrl, type PatientTransaction } from '../src/fhir/bundle.js';
import { groupByPatient, type PatientGroup } from '../src/fhir/patient-groups.js';
import { parseLegacyCsv } from '../src/legacy/parser.js';
import { legacyRecord } from './fixtures/records.js';

/** BundleEntry.resource is typed as the base Resource, which has no resourceType. */
function typeOf(entry: BundleEntry): string | undefined {
  return (entry.resource as { resourceType?: string } | undefined)?.resourceType;
}

/** Predictable ids, so a bundle can be compared field by field. */
function countingIds(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `id-${String(next)}`;
  };
}

function group(overrides: Partial<PatientGroup> = {}): PatientGroup {
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

function build(patientGroup: PatientGroup = group()): PatientTransaction {
  return buildPatientTransaction(patientGroup, { timezoneOffset: 'Z', newId: countingIds() });
}

describe('buildPatientTransaction', () => {
  it('builds a transaction bundle', () => {
    const { bundle } = build();

    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('transaction');
  });

  it('puts the patient first, then the condition and the observation of each row', () => {
    const { bundle, sources } = build();

    expect(bundle.entry?.map(typeOf)).toEqual([
      'Patient',
      'Condition',
      'Observation',
    ]);
    expect(sources.map((source) => source.resourceType)).toEqual(['Patient', 'Condition', 'Observation']);
  });

  it('describes every entry, so an error about one can name its CSV row', () => {
    const { bundle, sources } = build();

    expect(sources).toHaveLength(bundle.entry?.length ?? 0);
    expect(sources[1]).toEqual({ resourceType: 'Condition', sourceRows: [2], recordId: 'P0001' });
  });

  it('builds the Patient entry from every row of the patient', () => {
    const patientGroup = group({
      records: [legacyRecord({ sourceRow: 2 }), legacyRecord({ sourceRow: 4, recordId: 'P0003' })],
    });

    expect(build(patientGroup).sources[0]).toEqual({
      resourceType: 'Patient',
      sourceRows: [2, 4],
      recordId: undefined,
    });
  });

  it('points the condition and the observation at the patient entry of the bundle', () => {
    const { bundle } = build();
    const [patient, condition, observation] = bundle.entry ?? [];

    expect(patient?.fullUrl).toBe('urn:uuid:id-1');
    expect(condition?.resource).toMatchObject({ subject: { reference: 'urn:uuid:id-1' } });
    expect(observation?.resource).toMatchObject({ subject: { reference: 'urn:uuid:id-1' } });
  });

  it('gives every entry its own temporary url', () => {
    const urls = build().bundle.entry?.map((entry) => entry.fullUrl);

    expect(urls).toEqual(['urn:uuid:id-1', 'urn:uuid:id-2', 'urn:uuid:id-3']);
    expect(new Set(urls).size).toBe(3);
  });

  it('asks for a conditional update on each identifier, so a rerun updates', () => {
    expect(build().bundle.entry?.map((entry) => entry.request)).toEqual([
      {
        method: 'PUT',
        url: 'Patient?identifier=http%3A%2F%2Fexample.org%2Ffhir%2Fsid%2Flegacy-mrn|MRN-10001',
      },
      {
        method: 'PUT',
        url: 'Condition?identifier=http%3A%2F%2Fexample.org%2Ffhir%2Fsid%2Flegacy-record-id|P0001',
      },
      {
        method: 'PUT',
        url: 'Observation?identifier=http%3A%2F%2Fexample.org%2Ffhir%2Fsid%2Flegacy-lab-result|P0001',
      },
    ]);
  });

  it('leaves out the observation for a row with no laboratory result', () => {
    const { bundle, sources } = build(group({ records: [legacyRecord({ labResult: undefined })] }));

    expect(bundle.entry?.map(typeOf)).toEqual(['Patient', 'Condition']);
    expect(sources.map((source) => source.resourceType)).toEqual(['Patient', 'Condition']);
  });

  it('collects the warnings the mapper raised for its rows', () => {
    const record = legacyRecord({
      diagnosis: { localCode: undefined, text: 'Something else', recordedDate: undefined, status: 'active', onsetAgeYears: undefined },
      labResult: undefined,
    });

    expect(build(group({ records: [record] })).warnings).toHaveLength(1);
  });

  it('uses a real random id when none is injected', () => {
    const { bundle } = buildPatientTransaction(group(), { timezoneOffset: 'Z' });

    expect(bundle.entry?.[0]?.fullUrl).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
  });
});

describe('conditionalUrl', () => {
  it('encodes the system and the value, since both end up in a query', () => {
    expect(conditionalUrl('Patient', 'http://example.org/ids', 'A,B&C')).toBe(
      'Patient?identifier=http%3A%2F%2Fexample.org%2Fids|A%2CB%26C',
    );
  });
});

describe('buildPatientTransaction, the shipped export', () => {
  const { records } = parseLegacyCsv(readFileSync(new URL('../data/legacy-export.csv', import.meta.url)));
  const transactions = groupByPatient(records).groups.map((patientGroup) =>
    buildPatientTransaction(patientGroup, { timezoneOffset: 'Z' }),
  );

  it('builds one transaction per patient, holding 60 resources in total', () => {
    const entries = transactions.flatMap((transaction) => transaction.bundle.entry ?? []);

    expect(transactions).toHaveLength(22);
    expect(entries).toHaveLength(60);
  });

  it('never leaves a resource pointing outside its own bundle', () => {
    for (const transaction of transactions) {
      const patientUrl = transaction.bundle.entry?.[0]?.fullUrl;
      const references = (transaction.bundle.entry ?? [])
        .slice(1)
        .map((entry) => (entry.resource as { subject?: { reference?: string } } | undefined)?.subject?.reference);

      expect(references.length).toBeGreaterThan(0);
      expect(references.every((reference) => reference === patientUrl)).toBe(true);
    }
  });

  it('makes every entry a conditional update', () => {
    for (const transaction of transactions) {
      for (const entry of transaction.bundle.entry ?? []) {
        expect(entry.request?.method).toBe('PUT');
        expect(entry.request?.url).toContain('?identifier=');
      }
    }
  });
});
