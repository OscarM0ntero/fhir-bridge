import type { ComparisonReport } from '../comparison.model';

/** A small report with one uploaded row, one row with a warning and one rejected row. */
export const SAMPLE_REPORT: ComparisonReport = {
  generatedAt: '2026-09-18T12:00:00.000Z',
  mode: 'upload',
  serverBaseUrl: 'https://example.org/fhir',
  summary: { patients: 2, resources: 4, rejectedRows: 1, invalid: 0, refused: 0, uploaded: 2, created: 4, updated: 0 },
  rows: [
    {
      sourceRow: 2,
      recordId: 'P0001',
      mrn: 'MRN-10001',
      outcome: 'uploaded',
      legacy: { PAT_ID: 'P0001', MRN: 'MRN-10001', LAST_NAME: 'NOVAK ', LAB_VALUE: '1,25', NOTES: '' },
      warnings: [],
      resources: [
        {
          resourceType: 'Patient',
          resource: { resourceType: 'Patient', gender: 'female' },
          serverReference: 'Patient/28886',
          created: true,
          builtFromRows: [2],
        },
        {
          resourceType: 'Condition',
          resource: { resourceType: 'Condition', subject: { reference: 'Patient/28886' } },
          serverReference: 'Condition/28887',
          created: true,
          builtFromRows: [2],
        },
      ],
    },
    {
      sourceRow: 3,
      recordId: 'P0002',
      mrn: 'MRN-10002',
      outcome: 'uploaded',
      legacy: { PAT_ID: 'P0002', DX_CODE: '' },
      warnings: ['DX_CODE is empty, so the diagnosis is kept as free text with no coding.'],
      resources: [
        {
          resourceType: 'Patient',
          resource: { resourceType: 'Patient' },
          serverReference: 'Patient/28900',
          created: true,
          builtFromRows: [3],
        },
      ],
    },
    {
      sourceRow: 24,
      recordId: 'P0023',
      outcome: 'rejected',
      legacy: { PAT_ID: 'P0023', MRN: '' },
      rejectionReason: 'MRN is empty, the row cannot be tied to a patient.',
      warnings: [],
      resources: [],
    },
  ],
};
