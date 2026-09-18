import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';

import type { ComparisonReport, RunMode } from './comparison.model';
import { RowDetail } from './row-detail/row-detail';
import { RowList } from './row-list/row-list';

/** Where the viewer finds the pipeline's output, copied in by scripts/copy-comparison.mjs. */
export const COMPARISON_URL = 'data/comparison.json';

const MODE_LABELS: Readonly<Record<RunMode, string>> = {
  upload: 'Validated and uploaded',
  'dry-run': 'Validated, not uploaded',
  offline: 'Mapped only',
};

@Component({
  selector: 'app-root',
  imports: [DatePipe, RowDetail, RowList],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly report = httpResource<ComparisonReport>(() => COMPARISON_URL);
  protected readonly modeLabels = MODE_LABELS;

  private readonly chosenRow = signal<number | undefined>(undefined);

  /** The row the user picked, or the first one until they pick. */
  protected readonly selectedRow = computed(() => {
    const rows = this.report.hasValue() ? this.report.value().rows : [];
    return rows.find((row) => row.sourceRow === this.chosenRow()) ?? rows[0];
  });

  protected select(sourceRow: number): void {
    this.chosenRow.set(sourceRow);
  }
}
