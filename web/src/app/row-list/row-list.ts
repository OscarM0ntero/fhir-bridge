import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import type { ComparisonRow } from '../comparison.model';
import { OUTCOME_LABELS, ROW_FILTERS, filterRows, type RowFilter } from '../row-filter';

/** The list of CSV rows down the side, with a filter for the ones worth a look. */
@Component({
  selector: 'app-row-list',
  templateUrl: './row-list.html',
  styleUrl: './row-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RowList {
  readonly rows = input.required<readonly ComparisonRow[]>();
  readonly selectedRow = input<number | undefined>();
  readonly rowSelected = output<number>();

  protected readonly filters = ROW_FILTERS;
  protected readonly outcomeLabels = OUTCOME_LABELS;
  protected readonly filter = signal<RowFilter>('all');
  protected readonly visibleRows = computed(() => filterRows(this.rows(), this.filter()));
}
