import { readFileSync } from 'node:fs';

import type { Bundle, Patient } from 'fhir/r4.js';
import { describe, expect, it } from 'vitest';

import { FhirRequestError, type TransactionReport, type ValidationReport } from '../src/fhir/client.js';
import type { FhirApi } from '../src/fhir/uploader.js';
import { LegacyParseError } from '../src/legacy/parser.js';
import { EXIT_CODES, exitCodeFor, runPipeline, summarize, type PipelineInput } from '../src/pipeline.js';

const CSV = readFileSync(new URL('../data/legacy-export.csv', import.meta.url));

function input(mode: PipelineInput['mode']): PipelineInput {
  return { csv: CSV, timezoneOffset: 'Z', mode };
}

interface FakeServer {
  readonly api: FhirApi;
  readonly validated: string[];
  readonly sent: string[];
}

interface FakeServerOptions {
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
function fakeServer(options: FakeServerOptions = {}): FakeServer {
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

describe('runPipeline, by mode', () => {
  it('maps everything but contacts no server when offline', async () => {
    const server = fakeServer();
    const report = await runPipeline(server.api, input('offline'));

    expect(server.validated).toEqual([]);
    expect(server.sent).toEqual([]);
    expect(report.transactions).toHaveLength(22);
    expect(report.outcomes).toEqual([]);
  });

  it('validates every patient but sends nothing on a dry run', async () => {
    const server = fakeServer();
    const report = await runPipeline(server.api, input('dry-run'));

    expect(server.validated).toHaveLength(22);
    expect(server.sent).toEqual([]);
    expect(summarize(report).uploaded).toBe(0);
  });

  it('validates and uploads every patient on a normal run', async () => {
    const server = fakeServer();
    const report = await runPipeline(server.api, input('upload'));

    expect(server.sent).toHaveLength(22);
    expect(summarize(report)).toMatchObject({ uploaded: 22, created: 60, updated: 0 });
  });

  it('handles the patients in the order they first appear in the export', async () => {
    const server = fakeServer();
    await runPipeline(server.api, input('dry-run'));

    expect(server.validated.slice(0, 3)).toEqual(['MRN-10001', 'MRN-10002', 'MRN-10004']);
  });

  it('reports each patient as it finishes', async () => {
    const seen: string[] = [];
    await runPipeline(fakeServer().api, input('dry-run'), {
      onPatient: (transaction) => seen.push(transaction.mrn),
    });

    expect(seen).toHaveLength(22);
    expect(seen[0]).toBe('MRN-10001');
  });
});

describe('runPipeline, when patients fail', () => {
  it('does not send an invalid patient, and carries on with the rest', async () => {
    const server = fakeServer({ invalid: ['MRN-10006'] });
    const report = await runPipeline(server.api, input('upload'));

    expect(server.sent).not.toContain('MRN-10006');
    expect(server.sent).toHaveLength(21);
    expect(summarize(report)).toMatchObject({ invalid: 1, uploaded: 21 });
  });

  it('carries on after the server refuses a patient', async () => {
    const server = fakeServer({ refused: ['MRN-10006'] });
    const report = await runPipeline(server.api, input('upload'));

    expect(server.sent).toHaveLength(22);
    expect(summarize(report)).toMatchObject({ refused: 1, uploaded: 21 });
  });

  it('stops when the server cannot be reached, since every later patient would fail too', async () => {
    const server = fakeServer({ unreachableAt: 'MRN-10004' });

    await expect(runPipeline(server.api, input('upload'))).rejects.toThrow(FhirRequestError);
    expect(server.sent).toEqual(['MRN-10001', 'MRN-10002']);
  });

  it('refuses an export it cannot read before contacting the server', async () => {
    const server = fakeServer();
    const unreadable = { ...input('upload'), csv: 'not;the;right;header' };

    await expect(runPipeline(server.api, unreadable)).rejects.toThrow(LegacyParseError);
    expect(server.validated).toEqual([]);
  });
});

describe('summarize', () => {
  it('counts what the shipped export produces', async () => {
    const report = await runPipeline(fakeServer().api, input('offline'));

    expect(summarize(report)).toEqual({
      patients: 22,
      resources: 60,
      rejectedRows: 2,
      invalid: 0,
      refused: 0,
      uploaded: 0,
      created: 0,
      updated: 0,
    });
  });

  it('collects the decisions the mapper made along the way', async () => {
    const report = await runPipeline(fakeServer().api, input('offline'));
    const rows = report.mappingWarnings.map((warning) => warning.sourceRow).sort((a, b) => a - b);

    expect(rows).toEqual([3, 4, 7, 13, 14, 15, 22]);
  });
});

describe('exitCodeFor', () => {
  it('succeeds when every patient got through, even with rejected rows', async () => {
    // The two rejected rows are the export being dirty, not the run failing.
    const report = await runPipeline(fakeServer().api, input('upload'));
    expect(exitCodeFor(report)).toBe(EXIT_CODES.ok);
  });

  it('fails when a patient was invalid', async () => {
    const report = await runPipeline(fakeServer({ invalid: ['MRN-10006'] }).api, input('upload'));
    expect(exitCodeFor(report)).toBe(EXIT_CODES.patientsFailed);
  });

  it('fails when a patient was refused', async () => {
    const report = await runPipeline(fakeServer({ refused: ['MRN-10006'] }).api, input('upload'));
    expect(exitCodeFor(report)).toBe(EXIT_CODES.patientsFailed);
  });

  it('fails a dry run that found an invalid patient', async () => {
    const report = await runPipeline(fakeServer({ invalid: ['MRN-10006'] }).api, input('dry-run'));
    expect(exitCodeFor(report)).toBe(EXIT_CODES.patientsFailed);
  });
});
