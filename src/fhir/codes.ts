import type { Coding } from 'fhir/r4.js';

import type { LegacyDiagnosisStatus } from '../legacy/types.js';

/**
 * Fixed HL7 codings the mapper writes into every resource of a given kind.
 * Each system, code and display was checked with a $lookup on tx.fhir.org.
 */

const CONDITION_CLINICAL = 'http://terminology.hl7.org/CodeSystem/condition-clinical';
const CONDITION_VERIFICATION = 'http://terminology.hl7.org/CodeSystem/condition-ver-status';

/**
 * Security label for test data. The pipeline uploads to a public server shared
 * with strangers, so every resource says plainly that it is not real.
 */
export const TEST_DATA_LABEL: Readonly<Coding> = {
  system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason',
  code: 'HTEST',
  display: 'test health data',
};

export const MEDICAL_RECORD_NUMBER_TYPE: Readonly<Coding> = {
  system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
  code: 'MR',
  display: 'Medical record number',
};

/** The export is a list of each patient's diagnoses, not tied to a visit. */
export const PROBLEM_LIST_ITEM: Readonly<Coding> = {
  system: 'http://terminology.hl7.org/CodeSystem/condition-category',
  code: 'problem-list-item',
  display: 'Problem List Item',
};

export const LABORATORY: Readonly<Coding> = {
  system: 'http://terminology.hl7.org/CodeSystem/observation-category',
  code: 'laboratory',
  display: 'Laboratory',
};

export interface ConditionStatus {
  readonly clinical: Readonly<Coding>;
  readonly verification: Readonly<Coding>;
}

/**
 * The legacy status answers two questions at once that FHIR keeps apart: is
 * the condition still going on, and how certain is it that the patient has it.
 */
export const CONDITION_STATUSES: Readonly<
  Record<Exclude<LegacyDiagnosisStatus, 'unknown'>, ConditionStatus>
> = {
  active: {
    clinical: { system: CONDITION_CLINICAL, code: 'active', display: 'Active' },
    verification: { system: CONDITION_VERIFICATION, code: 'confirmed', display: 'Confirmed' },
  },
  resolved: {
    clinical: { system: CONDITION_CLINICAL, code: 'resolved', display: 'Resolved' },
    verification: { system: CONDITION_VERIFICATION, code: 'confirmed', display: 'Confirmed' },
  },
  suspected: {
    clinical: { system: CONDITION_CLINICAL, code: 'active', display: 'Active' },
    verification: { system: CONDITION_VERIFICATION, code: 'provisional', display: 'Provisional' },
  },
};
