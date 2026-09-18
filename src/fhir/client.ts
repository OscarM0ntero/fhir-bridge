import type { Bundle, FhirResource } from 'fhir/r4.js';

import { isBlocking, readOutcomeIssues, type OutcomeIssue } from './operation-outcome.js';
import { readTransactionResponse, type EntryOutcome } from './transaction-response.js';

/** The part of fetch this client uses. Injected so tests stay off the network. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface FhirClientOptions {
  /** Base URL of the server, without a trailing slash. */
  readonly baseUrl: string;
  readonly authToken: string | undefined;
  readonly timeoutMs: number;
  readonly fetch?: FetchLike;
}

/** What the server made of a resource. */
export interface ValidationReport {
  /** True when the server reported nothing that would stop an upload. */
  readonly valid: boolean;
  readonly httpStatus: number;
  readonly issues: readonly OutcomeIssue[];
}

/**
 * What happened to a transaction. It either went through as a whole, or the
 * server refused it as a whole and stored nothing: that is the point of
 * sending a patient's resources as one transaction.
 */
export type TransactionReport =
  | { readonly committed: true; readonly httpStatus: number; readonly entries: readonly EntryOutcome[] }
  | { readonly committed: false; readonly httpStatus: number; readonly issues: readonly OutcomeIssue[] };

/** The server could not be reached, or answered something unusable. */
export class FhirRequestError extends Error {
  public readonly status: number | undefined;

  public constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? {} : { cause: options.cause });
    this.name = 'FhirRequestError';
    this.status = options.status;
  }
}

const FHIR_JSON = 'application/fhir+json';

export class FhirClient {
  private readonly baseUrl: string;
  private readonly authToken: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  public constructor(options: FhirClientOptions) {
    this.baseUrl = options.baseUrl;
    this.authToken = options.authToken;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Asks the server to check a resource without storing it. A validation that
   * fails is a normal answer, not an error: the server says what is wrong in an
   * OperationOutcome, and only an unreachable or unintelligible server throws.
   */
  public async validate(resource: FhirResource): Promise<ValidationReport> {
    const url = `${this.baseUrl}/${resource.resourceType}/$validate`;
    const response = await this.send(url, JSON.stringify(resource));
    const body = await readJson(response, url);

    const issues = readOutcomeIssues(body);
    if (issues === undefined) {
      throw new FhirRequestError(
        `${url} answered HTTP ${String(response.status)} with something that is not an OperationOutcome.`,
        { status: response.status },
      );
    }

    return {
      valid: response.ok && !issues.some(isBlocking),
      httpStatus: response.status,
      issues,
    };
  }

  /**
   * Sends a transaction bundle. A refusal is a normal answer, carried in the
   * report; only an unreachable or unintelligible server throws.
   */
  public async transaction(bundle: Bundle): Promise<TransactionReport> {
    const url = this.baseUrl;
    const response = await this.send(url, JSON.stringify(bundle));
    const body = await readJson(response, url);

    const entries = response.ok ? readTransactionResponse(body) : undefined;
    if (entries !== undefined) {
      return { committed: true, httpStatus: response.status, entries };
    }

    const issues = readOutcomeIssues(body);
    if (issues !== undefined && !response.ok) {
      return { committed: false, httpStatus: response.status, issues };
    }

    throw new FhirRequestError(
      `${url} answered a transaction with HTTP ${String(response.status)} and neither a transaction response nor an OperationOutcome.`,
      { status: response.status },
    );
  }

  private async send(url: string, body: string): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': FHIR_JSON,
          Accept: FHIR_JSON,
          ...(this.authToken === undefined ? {} : { Authorization: `Bearer ${this.authToken}` }),
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      const detail = timedOut
        ? `gave no answer within ${String(this.timeoutMs)} ms`
        : `could not be reached: ${error instanceof Error ? error.message : String(error)}`;
      throw new FhirRequestError(`${url} ${detail}.`, { cause: error });
    }
  }
}

async function readJson(response: Response, url: string): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new FhirRequestError(
      `${url} answered HTTP ${String(response.status)} with a body that is not JSON.`,
      { status: response.status, cause: error },
    );
  }
}
