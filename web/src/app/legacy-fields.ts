/** The legacy columns, in the order the export writes them, and where each one ends up. */
export const LEGACY_FIELDS: readonly { readonly column: string; readonly mapsTo: string }[] = [
  { column: 'PAT_ID', mapsTo: 'Condition.identifier, Observation.identifier' },
  { column: 'MRN', mapsTo: 'Patient.identifier (type MR)' },
  { column: 'LAST_NAME', mapsTo: 'Patient.name.family' },
  { column: 'FIRST_NAME', mapsTo: 'Patient.name.given' },
  { column: 'BIRTH_DT', mapsTo: 'Patient.birthDate' },
  { column: 'SEX', mapsTo: 'Patient.gender' },
  { column: 'DX_CODE', mapsTo: 'Condition.code.coding (Orphanet, ICD-10, local)' },
  { column: 'DX_TEXT', mapsTo: 'Condition.code.text' },
  { column: 'DX_DATE', mapsTo: 'Condition.recordedDate' },
  { column: 'DX_STATUS', mapsTo: 'Condition.clinicalStatus, Condition.verificationStatus' },
  { column: 'ONSET_AGE', mapsTo: 'Condition.onsetAge, or onsetString for 0' },
  { column: 'LAB_CODE', mapsTo: 'Observation.code.coding (LOINC, local)' },
  { column: 'LAB_VALUE', mapsTo: 'Observation.valueQuantity.value, comparator' },
  { column: 'LAB_UNIT', mapsTo: 'Observation.valueQuantity.unit, code (UCUM)' },
  { column: 'LAB_DT', mapsTo: 'Observation.effectiveDateTime' },
  { column: 'NOTES', mapsTo: 'Condition.note' },
];

const EDGE_SPACES = /^ +| +$/g;

/**
 * Shows a raw legacy value so that what is invisible in a table becomes
 * visible: an empty field says so, and stray spaces at either end are drawn,
 * since those are exactly what the parser had to clean up.
 */
export function showRawValue(value: string | undefined): string {
  if (value === undefined || value === '') {
    return '(empty)';
  }
  return value.replace(EDGE_SPACES, (spaces) => '␣'.repeat(spaces.length));
}
