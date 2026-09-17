import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  bundleEntryIndex,
  isBlocking,
  readOutcomeIssues,
  type OutcomeIssue,
} from '../src/fhir/operation-outcome.js';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/hapi/${name}.json`, import.meta.url), 'utf8')) as unknown;
}

function issue(overrides: Partial<OutcomeIssue> = {}): OutcomeIssue {
  return { severity: 'error', code: 'processing', location: undefined, message: 'something', ...overrides };
}

describe('readOutcomeIssues', () => {
  it('reads the warnings HAPI returned for a valid bundle', () => {
    const issues = readOutcomeIssues(fixture('validate-bundle-ok'));

    expect(issues).toHaveLength(16);
    expect(issues?.every((entry) => entry.severity === 'warning')).toBe(true);
  });

  it('reads the error HAPI returned for a bundle with a broken entry', () => {
    const issues = readOutcomeIssues(fixture('validate-bundle-error')) ?? [];
    const blocking = issues.filter(isBlocking);

    expect(blocking).toHaveLength(1);
    expect(blocking[0]?.message).toContain('Observation.status: minimum required = 1');
  });

  it('reads the error HAPI returned for a resource it could not parse', () => {
    const issues = readOutcomeIssues(fixture('validate-parse-error')) ?? [];

    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('error');
  });

  it.each([
    ['a searchset bundle', { resourceType: 'Bundle', type: 'searchset' }],
    ['a resource of another kind', { resourceType: 'Patient' }],
    ['an object with no resourceType', { issue: [] }],
    ['a string', 'OperationOutcome'],
    ['null', null],
  ])('returns nothing for %s', (_label, body) => {
    expect(readOutcomeIssues(body)).toBeUndefined();
  });

  it('accepts an outcome that carries no issues', () => {
    expect(readOutcomeIssues({ resourceType: 'OperationOutcome' })).toEqual([]);
  });

  it('prefers the expression over the location, which is the older form', () => {
    const issues = readOutcomeIssues({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'invalid', expression: ['Patient.gender'], location: ['Patient.sex'] }],
    });

    expect(issues?.[0]?.location).toBe('Patient.gender');
  });

  it('falls back through diagnostics, details and the code for a message', () => {
    const issues = readOutcomeIssues({
      resourceType: 'OperationOutcome',
      issue: [
        { severity: 'error', code: 'invalid', diagnostics: 'spelled out' },
        { severity: 'error', code: 'invalid', details: { text: 'from details' } },
        { severity: 'error', code: 'not-found' },
      ],
    });

    expect(issues?.map((entry) => entry.message)).toEqual(['spelled out', 'from details', 'not-found']);
  });
});

describe('isBlocking', () => {
  it.each([
    ['fatal', true],
    ['error', true],
    ['warning', false],
    ['information', false],
  ] as const)('treats %s as blocking: %s', (severity, expected) => {
    expect(isBlocking(issue({ severity }))).toBe(expected);
  });
});

describe('bundleEntryIndex', () => {
  it('finds which entry of a bundle an issue is about', () => {
    expect(bundleEntryIndex(issue({ location: 'Bundle.entry[3].resource/*Observation/null*/' }))).toBe(3);
  });

  it('finds the entry in the error HAPI returned for the broken bundle', () => {
    const issues = readOutcomeIssues(fixture('validate-bundle-error')) ?? [];
    const blocking = issues.find(isBlocking);

    // The recorded fixture had the status removed from the third entry.
    expect(blocking === undefined ? undefined : bundleEntryIndex(blocking)).toBe(2);
  });

  it.each([
    ['an issue about a plain resource', 'Condition.code'],
    ['an issue with no location', undefined],
    ['a location that only looks like one', 'Bundle.entry[x].resource'],
  ])('returns nothing for %s', (_label, location) => {
    expect(bundleEntryIndex(issue({ location }))).toBeUndefined();
  });
});
