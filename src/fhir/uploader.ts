import type { EntrySource, PatientTransaction } from './bundle.js';
import { FhirRequestError, type FhirClient, type ValidationReport } from './client.js';
import type { OutcomeIssue } from './operation-outcome.js';

/** The two calls the uploader needs. FhirClient provides them; tests fake them. */
export type FhirApi = Pick<FhirClient, 'validate' | 'transaction'>;

/** One stored resource, together with the CSV rows it came from. */
export interface UploadedEntry extends EntrySource {
  /** Where the resource now lives, such as Patient/28886. */
  readonly reference: string | undefined;
  /** False on a rerun: the conditional update found the resource and updated it. */
  readonly created: boolean;
}

export type UploadOutcome =
  | { readonly kind: 'skipped'; readonly reason: 'dry-run' | 'invalid' }
  | { readonly kind: 'committed'; readonly entries: readonly UploadedEntry[] }
  | { readonly kind: 'rejected'; readonly httpStatus: number; readonly issues: readonly OutcomeIssue[] };

export interface PatientOutcome {
  readonly mrn: string;
  readonly validation: ValidationReport;
  readonly upload: UploadOutcome;
}

export interface UploadOptions {
  /** Validate but do not store anything. */
  readonly dryRun: boolean;
}

/**
 * Validates one patient's transaction and, if the server found nothing wrong
 * with it, sends it. Nothing is ever sent that failed validation.
 *
 * Because every entry is a conditional update on its legacy identifier,
 * sending the same patient again updates what is there instead of adding a
 * copy. That also makes an interrupted run safe to simply start again.
 */
export async function uploadPatient(
  api: FhirApi,
  transaction: PatientTransaction,
  options: UploadOptions,
): Promise<PatientOutcome> {
  const { mrn } = transaction;
  const validation = await api.validate(transaction.bundle);

  if (!validation.valid) {
    return { mrn, validation, upload: { kind: 'skipped', reason: 'invalid' } };
  }
  if (options.dryRun) {
    return { mrn, validation, upload: { kind: 'skipped', reason: 'dry-run' } };
  }

  const report = await api.transaction(transaction.bundle);
  if (!report.committed) {
    return { mrn, validation, upload: { kind: 'rejected', httpStatus: report.httpStatus, issues: report.issues } };
  }

  // The response lists its entries in the order they were sent. If the counts
  // differ, pairing them up would attach ids to the wrong rows.
  if (report.entries.length !== transaction.sources.length) {
    throw new FhirRequestError(
      `The server answered ${String(report.entries.length)} entries for a transaction of ${String(transaction.sources.length)} for ${mrn}.`,
      { status: report.httpStatus },
    );
  }

  const entries = transaction.sources.map((source, index) => {
    const outcome = report.entries[index];
    return { ...source, reference: outcome?.reference, created: outcome?.created ?? false };
  });

  return { mrn, validation, upload: { kind: 'committed', entries } };
}
