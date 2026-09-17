/**
 * Namespaces for the legacy system's identifiers. In FHIR an identifier is the
 * pair of system and value: MRN-10001 means nothing until you know which
 * organisation issued it. example.org is used because the legacy system only
 * exists inside this project.
 */
export const IDENTIFIER_SYSTEMS = {
  /** The MRN column. Identifies a patient, and is what patients are merged on. */
  medicalRecordNumber: 'http://example.org/fhir/sid/legacy-mrn',
  /** The PAT_ID column, which identifies a diagnosis row. */
  record: 'http://example.org/fhir/sid/legacy-record-id',
  /** The PAT_ID column again, in its own namespace, for the row's lab result. */
  labResult: 'http://example.org/fhir/sid/legacy-lab-result',
} as const;
