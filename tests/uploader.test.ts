import { describe, expect, it } from 'vitest';

import type { PatientTransaction } from '../src/fhir/bundle.js';
import { FhirRequestError, type TransactionReport, type ValidationReport } from '../src/fhir/client.js';
import { uploadPatient, type FhirApi } from '../src/fhir/uploader.js';

const TRANSACTION: PatientTransaction = {
  mrn: 'MRN-10001',
  bundle: { resourceType: 'Bundle', type: 'transaction', entry: [] },
  sources: [
    { resourceType: 'Patient', sourceRows: [2, 4], recordId: undefined },
    { resourceType: 'Condition', sourceRows: [2], recordId: 'P0001' },
  ],
  warnings: [],
};

const VALID: ValidationReport = { valid: true, httpStatus: 200, issues: [] };
const INVALID: ValidationReport = {
  valid: false,
  httpStatus: 200,
  issues: [{ severity: 'error', code: 'invariant', location: 'Bundle.entry[1]', message: 'broken' }],
};

const COMMITTED: TransactionReport = {
  committed: true,
  httpStatus: 200,
  entries: [
    { status: '201 Created', created: true, reference: 'Patient/1', version: '1' },
    { status: '201 Created', created: true, reference: 'Condition/2', version: '1' },
  ],
};

interface FakeApi {
  readonly api: FhirApi;
  readonly calls: { validate: number; transaction: number };
}

/** A server double that answers as told and counts what it was asked. */
function fakeApi(validation: ValidationReport, transaction: TransactionReport = COMMITTED): FakeApi {
  const calls = { validate: 0, transaction: 0 };
  const api: FhirApi = {
    validate: () => {
      calls.validate += 1;
      return Promise.resolve(validation);
    },
    transaction: () => {
      calls.transaction += 1;
      return Promise.resolve(transaction);
    },
  };
  return { api, calls };
}

describe('uploadPatient', () => {
  it('validates and then sends a valid transaction', async () => {
    const { api, calls } = fakeApi(VALID);
    const outcome = await uploadPatient(api, TRANSACTION, { dryRun: false });

    expect(calls).toEqual({ validate: 1, transaction: 1 });
    expect(outcome.upload.kind).toBe('committed');
  });

  it('pairs every stored resource with the CSV rows it came from', async () => {
    const { api } = fakeApi(VALID);
    const outcome = await uploadPatient(api, TRANSACTION, { dryRun: false });

    expect(outcome.upload).toEqual({
      kind: 'committed',
      entries: [
        { resourceType: 'Patient', sourceRows: [2, 4], recordId: undefined, reference: 'Patient/1', created: true },
        { resourceType: 'Condition', sourceRows: [2], recordId: 'P0001', reference: 'Condition/2', created: true },
      ],
    });
  });

  it('never sends a transaction that failed validation', async () => {
    const { api, calls } = fakeApi(INVALID);
    const outcome = await uploadPatient(api, TRANSACTION, { dryRun: false });

    expect(calls.transaction).toBe(0);
    expect(outcome.upload).toEqual({ kind: 'skipped', reason: 'invalid' });
    expect(outcome.validation).toBe(INVALID);
  });

  it('validates but sends nothing on a dry run', async () => {
    const { api, calls } = fakeApi(VALID);
    const outcome = await uploadPatient(api, TRANSACTION, { dryRun: true });

    expect(calls).toEqual({ validate: 1, transaction: 0 });
    expect(outcome.upload).toEqual({ kind: 'skipped', reason: 'dry-run' });
  });

  it('reports a transaction the server refused, with its reasons', async () => {
    const refusal: TransactionReport = {
      committed: false,
      httpStatus: 412,
      issues: [{ severity: 'error', code: 'multiple-matches', location: undefined, message: 'two patients match' }],
    };
    const { api } = fakeApi(VALID, refusal);
    const outcome = await uploadPatient(api, TRANSACTION, { dryRun: false });

    expect(outcome.upload).toEqual({ kind: 'rejected', httpStatus: 412, issues: refusal.issues });
  });

  it('refuses to guess when the server answers a different number of entries', async () => {
    const short: TransactionReport = { ...COMMITTED, entries: COMMITTED.entries.slice(0, 1) };
    const { api } = fakeApi(VALID, short);

    await expect(uploadPatient(api, TRANSACTION, { dryRun: false })).rejects.toThrow(FhirRequestError);
  });

  it('lets a server failure surface instead of hiding it', async () => {
    const api: FhirApi = {
      validate: () => Promise.reject(new FhirRequestError('unreachable')),
      transaction: () => Promise.resolve(COMMITTED),
    };

    await expect(uploadPatient(api, TRANSACTION, { dryRun: false })).rejects.toThrow('unreachable');
  });
});
