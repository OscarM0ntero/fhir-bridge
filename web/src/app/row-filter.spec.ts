import { filterRows } from './row-filter';
import { SAMPLE_REPORT } from './testing/sample-report';

describe('filterRows', () => {
  const lines = (filter: Parameters<typeof filterRows>[1]): number[] =>
    filterRows(SAMPLE_REPORT.rows, filter).map((row) => row.sourceRow);

  it('keeps every row for "all"', () => {
    expect(lines('all')).toEqual([2, 3, 24]);
  });

  it('keeps only rejected rows for "rejected"', () => {
    expect(lines('rejected')).toEqual([24]);
  });

  it('keeps rows with warnings and rows that did not get through for "attention"', () => {
    expect(lines('attention')).toEqual([3, 24]);
  });
});
