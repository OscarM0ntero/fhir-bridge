import codeMap from './code-map.json' with { type: 'json' };

/**
 * One coded meaning: which code system, which code in it, and what that code
 * is called. A FHIR CodeableConcept carries a list of these, all saying the
 * same thing in different vocabularies.
 */
export interface Coding {
  readonly system: string;
  readonly code: string;
  readonly display: string;
}

/** Canonical URIs of every code system this project writes into resources. */
export const SYSTEMS = codeMap.systems;

export interface TerminologyEntry {
  /** The code as the legacy system wrote it, such as RD-014. */
  readonly localCode: string;
  /** The name the legacy catalogue gives the concept. */
  readonly display: string;
  /**
   * Standard codings first, the local code last. The local code is kept on
   * purpose: it is what lets a reviewer trace a resource back to the row it
   * came from, and it costs nothing to carry.
   */
  readonly codings: readonly Coding[];
  /** True when no standard code system covers this concept. */
  readonly localOnly: boolean;
}

const conditions = new Map<string, TerminologyEntry>(
  Object.entries(codeMap.conditions).map(([localCode, entry]) => [
    localCode,
    {
      localCode,
      display: entry.display,
      // Orphanet first: it names the disease itself, while ICD-10 often only
      // offers the family it belongs to.
      codings: [
        { system: SYSTEMS.orphanet, code: entry.orphanet.code, display: entry.orphanet.display },
        { system: SYSTEMS.icd10, code: entry.icd10.code, display: entry.icd10.display },
        { system: SYSTEMS.legacyDiagnosis, code: localCode, display: entry.display },
      ],
      localOnly: false,
    },
  ]),
);

const observations = new Map<string, TerminologyEntry>(
  Object.entries(codeMap.observations).map(([localCode, entry]) => {
    const local: Coding = {
      system: SYSTEMS.legacyLab,
      code: localCode,
      display: entry.display,
    };

    return [
      localCode,
      {
        localCode,
        display: entry.display,
        codings:
          entry.loinc === null
            ? [local]
            : [{ system: SYSTEMS.loinc, code: entry.loinc.code, display: entry.loinc.display }, local],
        localOnly: entry.loinc === null,
      },
    ];
  }),
);

const units = new Map<string, string>(Object.entries(codeMap.units));

/** Looks up a diagnosis code from the legacy catalogue. */
export function findConditionTerminology(localCode: string): TerminologyEntry | undefined {
  return conditions.get(normalizeKey(localCode));
}

/** Looks up a laboratory test code from the legacy catalogue. */
export function findObservationTerminology(localCode: string): TerminologyEntry | undefined {
  return observations.get(normalizeKey(localCode));
}

/**
 * Translates a unit as the legacy system spelled it into UCUM. UCUM is case
 * sensitive, so mg/dl and mg/dL are not the same string to a FHIR validator
 * even though they are the same unit to a clinician.
 */
export function findUcumUnit(unitText: string): string | undefined {
  return units.get(unitText.trim().toLowerCase());
}

/** The local codes this table knows about, for tests and reporting. */
export function knownConditionCodes(): readonly string[] {
  return [...conditions.keys()];
}

export function knownObservationCodes(): readonly string[] {
  return [...observations.keys()];
}

function normalizeKey(localCode: string): string {
  return localCode.trim().toUpperCase();
}
