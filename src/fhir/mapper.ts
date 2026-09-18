import type {
  Age,
  CodeableConcept,
  Coding,
  Condition,
  HumanName,
  Identifier,
  Meta,
  Observation,
  Patient,
  Quantity,
} from 'fhir/r4.js';

import type { LegacyMeasurement, LegacyRecord, LegacyTimestamp } from '../legacy/types.js';
import {
  SYSTEMS,
  findConditionTerminology,
  findObservationTerminology,
  findUcumUnit,
} from '../terminology/terminology.js';
import {
  CONDITION_STATUSES,
  LABORATORY,
  MEDICAL_RECORD_NUMBER_TYPE,
  PROBLEM_LIST_ITEM,
  TEST_DATA_LABEL,
} from './codes.js';
import { IDENTIFIER_SYSTEMS } from './identifiers.js';
import type { MappingWarning, PatientGroup } from './patient-groups.js';

/** What the mapper needs to know that the legacy row cannot tell it. */
export interface MappingContext {
  /** Where the patient lives on the server, such as Patient/123. */
  readonly patientReference: string;
  /** Offset for legacy timestamps that carry a time of day but no zone. */
  readonly timezoneOffset: string;
}

export interface Mapped<T> {
  readonly resource: T;
  readonly warnings: readonly MappingWarning[];
}

/**
 * Builds the Patient for a group of rows. No id is set: the server assigns it,
 * and the MRN identifier is what finds the same patient again on a re-run.
 */
export function mapPatient(group: PatientGroup): Patient {
  const name: HumanName = {
    use: 'official',
    ...(group.lastName === undefined ? {} : { family: group.lastName }),
    ...(group.firstName === undefined ? {} : { given: [group.firstName] }),
  };
  const hasName = group.lastName !== undefined || group.firstName !== undefined;

  return {
    resourceType: 'Patient',
    meta: testDataMeta(),
    identifier: [
      {
        use: 'usual',
        type: { coding: [{ ...MEDICAL_RECORD_NUMBER_TYPE }] },
        system: IDENTIFIER_SYSTEMS.medicalRecordNumber,
        value: group.mrn,
      },
    ],
    ...(hasName ? { name: [name] } : {}),
    gender: group.sex,
    ...(group.birthDate === undefined ? {} : { birthDate: group.birthDate }),
  };
}

export function mapCondition(record: LegacyRecord, context: MappingContext): Mapped<Condition> {
  const warnings: MappingWarning[] = [];
  const warn = (message: string): void => {
    warnings.push({ sourceRow: record.sourceRow, message });
  };

  const { diagnosis } = record;
  const status = diagnosis.status === 'unknown' ? undefined : CONDITION_STATUSES[diagnosis.status];
  if (status === undefined) {
    warn('DX_STATUS was not recognised, so clinicalStatus and verificationStatus are left out.');
  }

  const resource: Condition = {
    resourceType: 'Condition',
    meta: testDataMeta(),
    identifier: [rowIdentifier(IDENTIFIER_SYSTEMS.record, record)],
    ...(status === undefined
      ? {}
      : { clinicalStatus: concept(status.clinical), verificationStatus: concept(status.verification) }),
    category: [concept(PROBLEM_LIST_ITEM)],
    code: diagnosisCode(record, warn),
    subject: { reference: context.patientReference },
    ...onset(diagnosis.onsetAgeYears, warn),
    ...(diagnosis.recordedDate === undefined
      ? {}
      : { recordedDate: toFhirDateTime(diagnosis.recordedDate, context.timezoneOffset) }),
    ...(record.notes === undefined ? {} : { note: [{ text: record.notes }] }),
  };

  return { resource, warnings };
}

/** Returns undefined for a row that carries no laboratory result. */
export function mapObservation(record: LegacyRecord, context: MappingContext): Mapped<Observation> | undefined {
  const { labResult } = record;
  if (labResult === undefined) {
    return undefined;
  }

  const warnings: MappingWarning[] = [];
  const warn = (message: string): void => {
    warnings.push({ sourceRow: record.sourceRow, message });
  };

  const resource: Observation = {
    resourceType: 'Observation',
    meta: testDataMeta(),
    identifier: [rowIdentifier(IDENTIFIER_SYSTEMS.labResult, record)],
    // The export has no result status. A result that made it into an export
    // of the patient record is taken to be a finished one.
    status: 'final',
    category: [concept(LABORATORY)],
    code: labCode(labResult.localCode, warn),
    subject: { reference: context.patientReference },
    ...(labResult.effective === undefined
      ? {}
      : { effectiveDateTime: toFhirDateTime(labResult.effective, context.timezoneOffset) }),
    valueQuantity: quantity(labResult.measurement, warn),
  };

  return { resource, warnings };
}

/**
 * A FHIR dateTime that states a time of day must also state its offset. A
 * date on its own is already a valid dateTime and is left as it is.
 */
export function toFhirDateTime(timestamp: LegacyTimestamp, timezoneOffset: string): string {
  if (timestamp.time === undefined) {
    return timestamp.date;
  }
  return `${timestamp.date}T${timestamp.time}${timezoneOffset}`;
}

function diagnosisCode(record: LegacyRecord, warn: (message: string) => void): CodeableConcept {
  const { localCode, text } = record.diagnosis;
  const textPart = text === undefined ? {} : { text };

  if (localCode === undefined) {
    warn('DX_CODE is empty, so the diagnosis is kept as free text with no coding.');
    return textPart;
  }

  const entry = findConditionTerminology(localCode);
  if (entry === undefined) {
    warn(`DX_CODE ${localCode} has no standard mapping, so the diagnosis carries the local code only.`);
    // The legacy system owns this code, so its own description is the display.
    const local: Coding = {
      system: SYSTEMS.legacyDiagnosis,
      code: localCode,
      ...(text === undefined ? {} : { display: text }),
    };
    return { coding: [local], ...textPart };
  }

  // The text is what the clinician wrote, which the catalogue name only replaces
  // when the row wrote nothing.
  return { coding: entry.codings.map((coding) => ({ ...coding })), text: text ?? entry.display };
}

function labCode(localCode: string, warn: (message: string) => void): CodeableConcept {
  const entry = findObservationTerminology(localCode);

  if (entry === undefined) {
    warn(`LAB_CODE ${localCode} is not in the terminology table, so the result carries the local code only.`);
    return { coding: [{ system: SYSTEMS.legacyLab, code: localCode }] };
  }

  if (entry.localOnly) {
    warn(`LAB_CODE ${localCode} has no LOINC equivalent, so the result carries the local code only.`);
  }

  return { coding: entry.codings.map((coding) => ({ ...coding })), text: entry.display };
}

/**
 * The unit is written twice on purpose: unit is for people to read, while
 * system and code are what a machine compares. When the legacy unit cannot be
 * translated into UCUM only the readable half is kept.
 */
function quantity(measurement: LegacyMeasurement, warn: (message: string) => void): Quantity {
  const { value, comparator, unit } = measurement;
  const base: Quantity = {
    value,
    ...(comparator === undefined ? {} : { comparator }),
  };

  if (unit === undefined) {
    return base;
  }

  const ucum = findUcumUnit(unit);
  if (ucum === undefined) {
    warn(`LAB_UNIT "${unit}" is not a known UCUM unit, so the quantity keeps it as text only.`);
    return { ...base, unit };
  }

  return { ...base, unit: ucum, system: SYSTEMS.ucum, code: ucum };
}

/**
 * The age of onset, as an Age when FHIR allows it. An Age must be positive
 * (invariant age-1), and the export writes 0 for conditions found in the first
 * year of life, usually by newborn screening. Those are kept as onsetString,
 * the text form FHIR offers for onsets that do not fit a structured one,
 * rather than dropped or turned into a range the export never stated.
 */
function onset(
  years: number | undefined,
  warn: (message: string) => void,
): { onsetAge: Age } | { onsetString: string } | Record<string, never> {
  if (years === undefined) {
    return {};
  }
  if (years === 0) {
    warn('ONSET_AGE is 0, which a FHIR Age cannot hold, so the onset is kept as text.');
    return { onsetString: '0 years' };
  }
  return { onsetAge: { value: years, unit: 'years', system: SYSTEMS.ucum, code: 'a' } };
}

function rowIdentifier(system: string, record: LegacyRecord): Identifier {
  return { system, value: record.recordId };
}

/** Copies the coding so that no two resources share a mutable object. */
function concept(coding: Readonly<Coding>): CodeableConcept {
  return { coding: [{ ...coding }] };
}

function testDataMeta(): Meta {
  return { security: [{ ...TEST_DATA_LABEL }] };
}
