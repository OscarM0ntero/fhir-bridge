import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseLegacyCsv } from '../src/legacy/parser.js';
import type { LegacyRecord } from '../src/legacy/types.js';

import {
  SYSTEMS,
  findConditionTerminology,
  findObservationTerminology,
  findUcumUnit,
  knownConditionCodes,
  knownObservationCodes,
} from '../src/terminology/terminology.js';

describe('canonical system URIs', () => {
  it('uses the FHIR URI for WHO ICD-10, not a national modification', () => {
    expect(SYSTEMS.icd10).toBe('http://hl7.org/fhir/sid/icd-10');
  });

  it('uses the HL7 registered URI for Orphanet, which is https', () => {
    // The registry gives https and the URI is case sensitive, so http would be
    // a different code system as far as a validator is concerned.
    expect(SYSTEMS.orphanet).toBe('https://www.orpha.net');
  });

  it('uses the FHIR URIs for LOINC and UCUM', () => {
    expect(SYSTEMS.loinc).toBe('http://loinc.org');
    expect(SYSTEMS.ucum).toBe('http://unitsofmeasure.org');
  });

  it('keeps the local code systems on a domain reserved for documentation', () => {
    expect(SYSTEMS.legacyDiagnosis).toMatch(/^http:\/\/example\.org\//);
    expect(SYSTEMS.legacyLab).toMatch(/^http:\/\/example\.org\//);
  });
});

describe('findConditionTerminology', () => {
  it('maps a local diagnosis code to Orphanet, ICD-10 and itself', () => {
    expect(findConditionTerminology('RD-014')?.codings).toEqual([
      { system: 'https://www.orpha.net', code: '324', display: 'Fabry disease' },
      { system: 'http://hl7.org/fhir/sid/icd-10', code: 'E75.2', display: 'Other sphingolipidosis' },
      {
        system: 'http://example.org/fhir/CodeSystem/legacy-diagnosis-codes',
        code: 'RD-014',
        display: 'Fabry disease',
      },
    ]);
  });

  it('distinguishes two diseases that share an ICD-10 code', () => {
    // ICD-10 files both Fabry and Gaucher under E75.2, Other sphingolipidosis.
    // Orphanet is what keeps them apart, which is the point of using it.
    const fabry = findConditionTerminology('RD-014');
    const gaucher = findConditionTerminology('RD-101');

    expect(fabry?.codings[1]?.code).toBe('E75.2');
    expect(gaucher?.codings[1]?.code).toBe('E75.2');
    expect(fabry?.codings[0]?.code).toBe('324');
    expect(gaucher?.codings[0]?.code).toBe('77259');
  });

  it('ignores surrounding whitespace and case', () => {
    expect(findConditionTerminology(' rd-014 ')?.localCode).toBe('RD-014');
  });

  it('returns nothing for a code the table does not cover', () => {
    expect(findConditionTerminology('RD-410')).toBeUndefined();
    expect(findConditionTerminology('')).toBeUndefined();
  });
});

describe('findObservationTerminology', () => {
  it('maps a laboratory code to LOINC and itself', () => {
    expect(findObservationTerminology('LB-CK')?.codings).toEqual([
      {
        system: 'http://loinc.org',
        code: '2157-6',
        display: 'Creatine kinase [Enzymatic activity/volume] in Serum or Plasma',
      },
      {
        system: 'http://example.org/fhir/CodeSystem/legacy-lab-codes',
        code: 'LB-CK',
        display: 'Creatine kinase',
      },
    ]);
  });

  it('keeps a test that LOINC has no quantitative code for as local only', () => {
    const entry = findObservationTerminology('LB-GBA');

    expect(entry?.localOnly).toBe(true);
    expect(entry?.codings).toHaveLength(1);
    expect(entry?.codings[0]?.system).toBe('http://example.org/fhir/CodeSystem/legacy-lab-codes');
  });

  it('returns nothing for an unknown test code', () => {
    expect(findObservationTerminology('LB-NOPE')).toBeUndefined();
  });
});

describe('findUcumUnit', () => {
  it.each([
    ['mg/dl', 'mg/dL'],
    ['mg/dL', 'mg/dL'],
    ['mmol/l', 'mmol/L'],
    ['mmol/L', 'mmol/L'],
    ['U/L', 'U/L'],
    ['u/l', 'U/L'],
    ['umol/L', 'umol/L'],
    ['pg/mL', 'pg/mL'],
    ['nmol/h/mg', 'nmol/h/mg'],
  ])('reads the unit %s as the UCUM unit %s', (raw, expected) => {
    // UCUM is case sensitive, so repairing the case is the real work here.
    expect(findUcumUnit(raw)).toBe(expected);
  });

  it('wraps a count in UCUM annotation syntax', () => {
    // A CAG repeat count has no dimension: UCUM writes that as {repeats}.
    expect(findUcumUnit('repeats')).toBe('{repeats}');
  });

  it('ignores surrounding whitespace', () => {
    expect(findUcumUnit('  mg/dl  ')).toBe('mg/dL');
  });

  it('returns nothing for a unit it does not know', () => {
    expect(findUcumUnit('bananas')).toBeUndefined();
  });
});

describe('the table itself', () => {
  const conditionEntries = knownConditionCodes().map((code) => findConditionTerminology(code));
  const observationEntries = knownObservationCodes().map((code) => findObservationTerminology(code));

  it('gives every diagnosis an Orphanet code, an ICD-10 code and its local code', () => {
    for (const entry of conditionEntries) {
      expect(entry?.codings.map((coding) => coding.system)).toEqual([
        SYSTEMS.orphanet,
        SYSTEMS.icd10,
        SYSTEMS.legacyDiagnosis,
      ]);
    }
  });

  it('writes every ORPHAcode as a bare number', () => {
    for (const entry of conditionEntries) {
      expect(entry?.codings[0]?.code).toMatch(/^\d+$/);
    }
  });

  it('writes every ICD-10 code in the shape ICD-10 uses', () => {
    for (const entry of conditionEntries) {
      expect(entry?.codings[1]?.code).toMatch(/^[A-Z]\d{2}(?:\.\d{1,2})?$/);
    }
  });

  it('writes every LOINC code as digits with a check digit', () => {
    for (const entry of observationEntries) {
      const loinc = entry?.codings.find((coding) => coding.system === SYSTEMS.loinc);
      if (loinc !== undefined) {
        expect(loinc.code).toMatch(/^\d{1,6}-\d$/);
      }
    }
  });

  it('never uses a LOINC part code, which names a concept but is not observable', () => {
    for (const entry of observationEntries) {
      const loinc = entry?.codings.find((coding) => coding.system === SYSTEMS.loinc);
      expect(loinc?.code.startsWith('LP')).not.toBe(true);
    }
  });

  it('gives every coding a display, so no resource carries a bare code', () => {
    for (const entry of [...conditionEntries, ...observationEntries]) {
      for (const coding of entry?.codings ?? []) {
        expect(coding.display.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('coverage of the shipped export', () => {
  const result = parseLegacyCsv(readFileSync(new URL('../data/legacy-export.csv', import.meta.url)));

  function localCodes(pick: (record: LegacyRecord) => string | undefined): readonly string[] {
    return [...new Set(result.records.map(pick).filter((code): code is string => code !== undefined))];
  }

  it('maps every diagnosis code in the export but the one meant to be missing', () => {
    const unmapped = localCodes((record) => record.diagnosis.localCode).filter(
      (code) => findConditionTerminology(code) === undefined,
    );

    // RD-410 is in the export on purpose: it is what the unmapped path is for.
    expect(unmapped).toEqual(['RD-410']);
  });

  it('maps every laboratory code in the export', () => {
    const unmapped = localCodes((record) => record.labResult?.localCode).filter(
      (code) => findObservationTerminology(code) === undefined,
    );

    expect(unmapped).toEqual([]);
  });

  it('translates every unit in the export into UCUM', () => {
    const units = [
      ...new Set(
        result.records
          .map((record) => record.labResult?.measurement.unit)
          .filter((unit): unit is string => unit !== undefined),
      ),
    ];
    const untranslated = units.filter((unit) => findUcumUnit(unit) === undefined);

    expect(units.length).toBeGreaterThan(0);
    expect(untranslated).toEqual([]);
  });
});
