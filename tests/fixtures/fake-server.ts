import type { Bundle, Patient } from 'fhir/r4.js';

import { FhirRequestError, type TransactionReport, type ValidationReport } from '../../src/fhir/client.js';
import type { FhirApi } from '../../src/fhir/uploader.js';

export interface FakeServer {
  readonly api: FhirApi;
  readonly validated: string[];
  readonly sent: string[];
}

export interface FakeServerOptions {
  readonly invalid?: readonly string[];
  readonly refused?: readonly string[];
  readonly unreachableAt?: string;
}

function mrnOf(bundle: Bundle): string {
  return (bundle.entry?.[0]?.resource as Patient | undefined)?.identifier?.[0]?.value ?? '';
}

/**
 * A server double. It answers every request successfully unless told that a
 * patient, named by MRN, is invalid, gets refused, or makes it fall over.
 */
export function fakeServer(options: FakeServerOptions = {}): FakeServer {
  const validated: string[] = [];
  const sent: string[] = [];

  const api: FhirApi = {
    validate: (resource) => {
      const mrn = mrnOf(resource as Bundle);
      validated.push(mrn);
      if (mrn === options.unreachableAt) {
        return Promise.reject(new FhirRequestError('the server went away'));
      }
      const valid = !(options.invalid ?? []).includes(mrn);
      const report: ValidationReport = {
        valid,
        httpStatus: 200,
        issues: valid ? [] : [{ severity: 'error', code: 'invariant', location: 'Bundle.entry[1]', message: 'broken' }],
      };
      return Promise.resolve(report);
    },
    transaction: (bundle) => {
      const mrn = mrnOf(bundle);
      sent.push(mrn);
      const report: TransactionReport = (options.refused ?? []).includes(mrn)
        ? { committed: false, httpStatus: 412, issues: [] }
        : {
            committed: true,
            httpStatus: 200,
            entries: (bundle.entry ?? []).map((_entry, index) => ({
              status: '201 Created',
              created: true,
              reference: `Resource/${mrn}-${String(index)}`,
              version: '1',
            })),
          };
      return Promise.resolve(report);
    },
  };

  return { api, validated, sent };
}
