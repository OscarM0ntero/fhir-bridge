import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FhirApi } from '../src/fhir/uploader.js';
import { runPipeline, type PipelineReport } from '../src/pipeline.js';
import { safeFileName, writeRunOutput } from '../src/report/writer.js';

const CSV = readFileSync(new URL('../data/legacy-export.csv', import.meta.url));

/** An offline run never calls the server, so this double must not be used. */
const UNUSED_API: FhirApi = {
  validate: () => Promise.reject(new Error('an offline run must not validate')),
  transaction: () => Promise.reject(new Error('an offline run must not upload')),
};

async function offlineReport(): Promise<PipelineReport> {
  return runPipeline(UNUSED_API, { csv: CSV, timezoneOffset: 'Z', mode: 'offline' });
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

const CONTEXT = { serverBaseUrl: 'https://example.org/fhir', generatedAt: '2026-09-18T12:00:00.000Z' };

let outputDir = '';

beforeEach(() => {
  outputDir = mkdtempSync(join(tmpdir(), 'fhir-bridge-'));
});

afterEach(() => {
  rmSync(outputDir, { recursive: true, force: true });
});

describe('writeRunOutput', () => {
  it('writes one bundle per patient', async () => {
    writeRunOutput(outputDir, await offlineReport(), CONTEXT);

    const files = readdirSync(join(outputDir, 'bundles'));
    expect(files).toHaveLength(22);
    expect(files).toContain('MRN-10001.json');
  });

  it('writes each bundle as the transaction it is', async () => {
    writeRunOutput(outputDir, await offlineReport(), CONTEXT);

    expect(readJson(join(outputDir, 'bundles', 'MRN-10001.json'))).toMatchObject({
      resourceType: 'Bundle',
      type: 'transaction',
    });
  });

  it('writes the rejected rows and every warning to the parse report', async () => {
    writeRunOutput(outputDir, await offlineReport(), CONTEXT);
    const parseReport = readJson(join(outputDir, 'parse-report.json')) as Record<string, unknown[]>;

    expect(parseReport['rejected']).toHaveLength(2);
    expect(parseReport['parseWarnings']).toHaveLength(2);
    expect(parseReport['mappingWarnings']).toHaveLength(7);
  });

  it('removes bundles left over from an earlier run', async () => {
    mkdirSync(join(outputDir, 'bundles'));
    writeFileSync(join(outputDir, 'bundles', 'MRN-GONE.json'), '{}');

    writeRunOutput(outputDir, await offlineReport(), CONTEXT);

    expect(existsSync(join(outputDir, 'bundles', 'MRN-GONE.json'))).toBe(false);
  });

  it('does not leave the results of an earlier upload next to an offline run', async () => {
    writeFileSync(join(outputDir, 'results.json'), '[]');

    writeRunOutput(outputDir, await offlineReport(), CONTEXT);

    expect(existsSync(join(outputDir, 'results.json'))).toBe(false);
  });

  it('writes the results of a run that reached the server', async () => {
    const report = { ...(await offlineReport()), mode: 'dry-run' as const };

    writeRunOutput(outputDir, report, CONTEXT);

    expect(readJson(join(outputDir, 'results.json'))).toEqual([]);
  });

  it('creates the output directory when it does not exist yet', async () => {
    const nested = join(outputDir, 'not', 'there', 'yet');

    writeRunOutput(nested, await offlineReport(), CONTEXT);

    expect(readdirSync(join(nested, 'bundles'))).toHaveLength(22);
  });
});

describe('safeFileName', () => {
  it('keeps an ordinary MRN as it is', () => {
    expect(safeFileName('MRN-10001')).toBe('MRN-10001');
  });

  it.each([
    ['../../etc/passwd', '__.._etc_passwd'],
    ['..', '_'],
    ['C:\\Windows', 'C__Windows'],
    ['a b/c', 'a_b_c'],
    ['', '_'],
  ])('neutralises %j as %j, which cannot leave the output directory', (value, expected) => {
    expect(safeFileName(value)).toBe(expected);
  });

  it('never returns a name that could leave the directory or hide itself', () => {
    const hostile = ['../x', '..\\x', '/abs/path', '.hidden', '....', 'a/../../b', 'nul' + String.fromCharCode(0)];
    for (const value of hostile) {
      const name = safeFileName(value);
      expect(name.startsWith('.')).toBe(false);
      expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
    }
  });
});
