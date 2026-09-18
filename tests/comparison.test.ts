import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { runPipeline, type PipelineInput, type PipelineReport } from '../src/pipeline.js';
import { buildComparison, resolveReferences, type ComparisonReport, type ComparisonRow } from '../src/report/comparison.js';
import { fakeServer, type FakeServerOptions } from './fixtures/fake-server.js';

const CSV = readFileSync(new URL('../data/legacy-export.csv', import.meta.url));
const CONTEXT = { serverBaseUrl: 'https://example.org/fhir', generatedAt: '2026-09-18T12:00:00.000Z' };

async function comparison(mode: PipelineInput['mode'], options: FakeServerOptions = {}): Promise<ComparisonReport> {
  const report: PipelineReport = await runPipeline(fakeServer(options).api, { csv: CSV, timezoneOffset: 'Z', mode });
  return buildComparison(report, CONTEXT);
}

function row(report: ComparisonReport, sourceRow: number): ComparisonRow {
  const found = report.rows.find((candidate) => candidate.sourceRow === sourceRow);
  if (found === undefined) {
    throw new Error(`no row for line ${String(sourceRow)}`);
  }
  return found;
}

describe('buildComparison, rows', () => {
  it('has one row for every line of the export, in file order', async () => {
    const report = await comparison('offline');

    expect(report.rows.map((entry) => entry.sourceRow)).toEqual(Array.from({ length: 25 }, (_, index) => index + 2));
  });

  it('keeps the legacy row exactly as the export wrote it', async () => {
    // Line 2 is P0001, whose surname carries a trailing space in the export.
    expect(row(await comparison('offline'), 2).legacy['LAST_NAME']).toBe('NOVAK ');
  });

  it('shows a rejected row with its reason and its original content', async () => {
    const rejected = row(await comparison('offline'), 24);

    expect(rejected.outcome).toBe('rejected');
    expect(rejected.rejectionReason).toContain('MRN is empty');
    expect(rejected.legacy['PAT_ID']).toBe('P0023');
    expect(rejected.resources).toEqual([]);
  });

  it('attaches to each row the warnings raised about it', async () => {
    const report = await comparison('offline');

    expect(row(report, 16).warnings).toEqual(['LAB_VALUE: test LB-AGAL reported no usable value, the result is dropped.']);
    expect(row(report, 14).warnings[0]).toContain('RD-410 has no standard mapping');
    expect(row(report, 2).warnings).toEqual([]);
  });

  it('carries the summary and the run context', async () => {
    const report = await comparison('offline');

    expect(report).toMatchObject({ mode: 'offline', ...CONTEXT });
    expect(report.summary.patients).toBe(22);
  });
});

describe('buildComparison, resources', () => {
  it('lists the Patient, Condition and Observation a row produced', async () => {
    const resources = row(await comparison('offline'), 2).resources;

    expect(resources.map((resource) => resource.resourceType)).toEqual(['Patient', 'Condition', 'Observation']);
  });

  it('shows the same patient on both rows of MRN-10001, built from both', async () => {
    const report = await comparison('offline');
    const first = row(report, 2).resources[0];
    const second = row(report, 4).resources[0];

    expect(first?.builtFromRows).toEqual([2, 4]);
    expect(second?.resource).toEqual(first?.resource);
  });

  it('shows only the condition for a row with no laboratory result', async () => {
    const resources = row(await comparison('offline'), 3).resources;
    expect(resources.map((resource) => resource.resourceType)).toEqual(['Patient', 'Condition']);
  });
});

describe('buildComparison, by mode', () => {
  it('leaves references temporary and server locations empty when offline', async () => {
    const condition = row(await comparison('offline'), 2).resources[1];

    expect(row(await comparison('offline'), 2).outcome).toBe('mapped');
    expect(condition?.serverReference).toBeUndefined();
    expect(condition?.resource).toMatchObject({ subject: { reference: expect.stringMatching(/^urn:uuid:/) as string } });
  });

  it('shows references the way the server stored them after an upload', async () => {
    const [patient, condition] = row(await comparison('upload'), 2).resources;

    expect(patient?.serverReference).toBe('Resource/MRN-10001-0');
    expect(condition?.resource).toMatchObject({ subject: { reference: 'Resource/MRN-10001-0' } });
    expect(condition?.created).toBe(true);
  });

  it('marks the rows of a dry run as valid', async () => {
    expect(row(await comparison('dry-run'), 2).outcome).toBe('valid');
  });

  it('marks the rows of an invalid patient as invalid', async () => {
    const report = await comparison('upload', { invalid: ['MRN-10001'] });

    expect(row(report, 2).outcome).toBe('invalid');
    expect(row(report, 4).outcome).toBe('invalid');
    expect(row(report, 3).outcome).toBe('uploaded');
  });

  it('marks the rows of a refused patient as refused', async () => {
    expect(row(await comparison('upload', { refused: ['MRN-10002'] }), 3).outcome).toBe('refused');
  });
});

describe('resolveReferences', () => {
  const condition = { resourceType: 'Condition', subject: { reference: 'urn:uuid:a' }, note: [{ text: 'urn:uuid:a' }] };

  it('swaps a known temporary reference for its server location', () => {
    const resolved = resolveReferences(condition, new Map([['urn:uuid:a', 'Patient/7']]));
    expect(resolved.subject.reference).toBe('Patient/7');
  });

  it('only touches references, not text that happens to look like one', () => {
    const resolved = resolveReferences(condition, new Map([['urn:uuid:a', 'Patient/7']]));
    expect(resolved.note[0]?.text).toBe('urn:uuid:a');
  });

  it('leaves a reference it does not know alone', () => {
    expect(resolveReferences(condition, new Map()).subject.reference).toBe('urn:uuid:a');
  });

  it('does not change the resource it was given', () => {
    resolveReferences(condition, new Map([['urn:uuid:a', 'Patient/7']]));
    expect(condition.subject.reference).toBe('urn:uuid:a');
  });
});
