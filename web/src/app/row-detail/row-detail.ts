import { JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';

import type { ComparisonRow } from '../comparison.model';
import { LEGACY_FIELDS, showRawValue } from '../legacy-fields';

/** One CSV row next to the FHIR resources it became. */
@Component({
  selector: 'app-row-detail',
  imports: [JsonPipe],
  templateUrl: './row-detail.html',
  styleUrl: './row-detail.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RowDetail {
  readonly row = input.required<ComparisonRow>();
  readonly serverBaseUrl = input.required<string>();

  protected readonly fields = LEGACY_FIELDS;
  protected readonly showRawValue = showRawValue;

  /** Goes back to the first resource whenever another row is selected. */
  protected readonly activeTab = linkedSignal({ source: this.row, computation: () => 0 });
  protected readonly activeResource = computed(() => this.row().resources[this.activeTab()]);
}
