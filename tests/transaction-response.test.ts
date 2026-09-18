import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { readTransactionResponse } from '../src/fhir/transaction-response.js';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/hapi/${name}.json`, import.meta.url), 'utf8')) as unknown;
}

function responseWith(location: unknown, status: unknown = '201 Created'): unknown {
  return { resourceType: 'Bundle', type: 'transaction-response', entry: [{ response: { status, location } }] };
}

describe('readTransactionResponse, recorded from HAPI', () => {
  it('reads a first run as five created resources', () => {
    const entries = readTransactionResponse(fixture('transaction-first-run'));

    expect(entries).toHaveLength(5);
    expect(entries?.every((entry) => entry.created)).toBe(true);
    expect(entries?.[0]).toEqual({
      status: '201 Created',
      created: true,
      reference: 'Patient/28886',
      version: '1',
    });
  });

  it('reads a rerun as the same five resources, updated rather than created', () => {
    const first = readTransactionResponse(fixture('transaction-first-run'));
    const second = readTransactionResponse(fixture('transaction-second-run'));

    expect(second?.every((entry) => !entry.created)).toBe(true);
    expect(second?.map((entry) => entry.reference)).toEqual(first?.map((entry) => entry.reference));
  });

  it('shows that the rerun did not even create a new version', () => {
    const second = readTransactionResponse(fixture('transaction-second-run'));
    expect(second?.every((entry) => entry.version === '1')).toBe(true);
  });

  it('does not mistake a refused transaction for a response', () => {
    expect(readTransactionResponse(fixture('transaction-rejected'))).toBeUndefined();
  });
});

describe('readTransactionResponse, locations', () => {
  it.each([
    ['a relative location with a version', 'Condition/28887/_history/3', 'Condition/28887', '3'],
    ['a relative location without a version', 'Condition/28887', 'Condition/28887', undefined],
    ['an absolute location', 'https://hapi.fhir.org/baseR4/Observation/abc-1/_history/2', 'Observation/abc-1', '2'],
  ])('reads %s', (_label, location, reference, version) => {
    expect(readTransactionResponse(responseWith(location))?.[0]).toMatchObject({ reference, version });
  });

  it.each([
    ['no location', undefined],
    ['a location that is not a string', 42],
    ['a location that names no resource', 'somewhere/else'],
  ])('leaves the reference empty for %s', (_label, location) => {
    expect(readTransactionResponse(responseWith(location))?.[0]?.reference).toBeUndefined();
  });

  it('treats an entry with no readable status as not created', () => {
    // null rather than undefined: undefined would pick up the helper's default.
    expect(readTransactionResponse(responseWith('Patient/1', null))?.[0]).toMatchObject({
      status: '',
      created: false,
    });
  });
});

describe('readTransactionResponse, other bodies', () => {
  it.each([
    ['a transaction that was never sent', { resourceType: 'Bundle', type: 'transaction' }],
    ['a search result', { resourceType: 'Bundle', type: 'searchset' }],
    ['an OperationOutcome', { resourceType: 'OperationOutcome', issue: [] }],
    ['null', null],
  ])('returns nothing for %s', (_label, body) => {
    expect(readTransactionResponse(body)).toBeUndefined();
  });

  it('accepts a response with no entries', () => {
    expect(readTransactionResponse({ resourceType: 'Bundle', type: 'transaction-response' })).toEqual([]);
  });
});
