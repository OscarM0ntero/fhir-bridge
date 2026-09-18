import type { ComparisonRow } from './comparison.model';

export type RowFilter = 'all' | 'attention' | 'rejected';

export const ROW_FILTERS: readonly { readonly value: RowFilter; readonly label: string }[] = [
  { value: 'all', label: 'All rows' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'rejected', label: 'Rejected' },
];

/**
 * "Needs attention" is every row where the pipeline had to decide something
 * on its own or could not finish: a warning, a rejection, or a patient the
 * server did not accept.
 */
export function filterRows(rows: readonly ComparisonRow[], filter: RowFilter): readonly ComparisonRow[] {
  switch (filter) {
    case 'all':
      return rows;
    case 'rejected':
      return rows.filter((row) => row.outcome === 'rejected');
    case 'attention':
      return rows.filter((row) => row.warnings.length > 0 || ['rejected', 'invalid', 'refused'].includes(row.outcome));
  }
}

export const OUTCOME_LABELS: Readonly<Record<ComparisonRow['outcome'], string>> = {
  uploaded: 'Uploaded',
  valid: 'Valid',
  invalid: 'Invalid',
  refused: 'Refused',
  mapped: 'Mapped',
  rejected: 'Rejected',
};
