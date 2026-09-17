import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FhirClient, FhirRequestError, type FetchLike } from '../src/fhir/client.js';

const PATIENT = { resourceType: 'Patient', gender: 'female' } as const;

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/hapi/${name}.json`, import.meta.url), 'utf8');
}

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

/** A fetch that answers whatever the test wants and records how it was called. */
function stubFetch(answer: Response | Error): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer.clone());
  };
  return { fetch, calls };
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/fhir+json' } });
}

function clientWith(answer: Response | Error, authToken?: string): { client: FhirClient; calls: Call[] } {
  const { fetch, calls } = stubFetch(answer);
  const client = new FhirClient({
    baseUrl: 'https://example.org/fhir',
    authToken,
    timeoutMs: 5000,
    fetch,
  });
  return { client, calls };
}

describe('FhirClient.validate, the request', () => {
  it('posts the resource to the $validate operation of its own type', async () => {
    const { client, calls } = clientWith(jsonResponse(fixture('validate-bundle-ok')));
    await client.validate(PATIENT);

    expect(calls[0]?.url).toBe('https://example.org/fhir/Patient/$validate');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.body).toBe(JSON.stringify(PATIENT));
  });

  it('asks for and sends FHIR JSON', async () => {
    const { client, calls } = clientWith(jsonResponse(fixture('validate-bundle-ok')));
    await client.validate(PATIENT);

    expect(calls[0]?.init.headers).toMatchObject({
      'Content-Type': 'application/fhir+json',
      Accept: 'application/fhir+json',
    });
  });

  it('sends no authorisation header when there is no token', async () => {
    const { client, calls } = clientWith(jsonResponse(fixture('validate-bundle-ok')));
    await client.validate(PATIENT);

    expect(calls[0]?.init.headers).not.toHaveProperty('Authorization');
  });

  it('sends a bearer token when one is configured', async () => {
    const { client, calls } = clientWith(jsonResponse(fixture('validate-bundle-ok')), 'secret-token');
    await client.validate(PATIENT);

    expect(calls[0]?.init.headers).toMatchObject({ Authorization: 'Bearer secret-token' });
  });

  it('gives every request a deadline', async () => {
    const { client, calls } = clientWith(jsonResponse(fixture('validate-bundle-ok')));
    await client.validate(PATIENT);

    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('FhirClient.validate, the answer', () => {
  it('accepts a resource the server only had warnings about', async () => {
    const { client } = clientWith(jsonResponse(fixture('validate-bundle-ok')));
    const report = await client.validate(PATIENT);

    expect(report.valid).toBe(true);
    expect(report.httpStatus).toBe(200);
    expect(report.issues).toHaveLength(16);
  });

  it('rejects a resource the server found an error in', async () => {
    const { client } = clientWith(jsonResponse(fixture('validate-bundle-error')));
    const report = await client.validate(PATIENT);

    expect(report.valid).toBe(false);
    expect(report.issues.filter((issue) => issue.severity === 'error')).toHaveLength(1);
  });

  it('treats a rejected request as a failed validation, not a broken server', async () => {
    // HAPI answers 400 with an OperationOutcome when it cannot even parse the
    // resource. That is still the server telling us what is wrong.
    const { client } = clientWith(jsonResponse(fixture('validate-parse-error'), 400));
    const report = await client.validate(PATIENT);

    expect(report.valid).toBe(false);
    expect(report.httpStatus).toBe(400);
    expect(report.issues[0]?.message).toContain('Failed to parse request body');
  });

  it('never calls a resource valid when the request itself failed', async () => {
    const outcome = JSON.stringify({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'warning', code: 'processing', diagnostics: 'server is unwell' }],
    });
    const { client } = clientWith(jsonResponse(outcome, 500));

    expect((await client.validate(PATIENT)).valid).toBe(false);
  });
});

describe('FhirClient.validate, when the server cannot be understood', () => {
  it('throws when the answer is not an OperationOutcome', async () => {
    const { client } = clientWith(jsonResponse(JSON.stringify({ resourceType: 'Patient' })));

    await expect(client.validate(PATIENT)).rejects.toThrow(FhirRequestError);
  });

  it('throws when the answer is not JSON at all', async () => {
    const { client } = clientWith(new Response('<html>502 Bad Gateway</html>', { status: 502 }));

    await expect(client.validate(PATIENT)).rejects.toThrow(/not JSON/);
  });

  it('reports the status it got with the failure', async () => {
    const { client } = clientWith(new Response('nope', { status: 503 }));
    const error = await client.validate(PATIENT).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FhirRequestError);
    expect((error as FhirRequestError).status).toBe(503);
  });

  it('throws when the server cannot be reached, keeping the original cause', async () => {
    const cause = new TypeError('fetch failed');
    const { client } = clientWith(cause);
    const error = await client.validate(PATIENT).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FhirRequestError);
    expect((error as FhirRequestError).message).toContain('could not be reached');
    expect((error as FhirRequestError).cause).toBe(cause);
  });

  it('says how long it waited when the server did not answer in time', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    const { client } = clientWith(timeout);

    await expect(client.validate(PATIENT)).rejects.toThrow(/no answer within 5000 ms/);
  });
});
