/** What the server did with one entry of a committed transaction. */
export interface EntryOutcome {
  /** The HTTP status the server gave the entry, such as "201 Created". */
  readonly status: string;
  /**
   * True when the entry created a new resource. A conditional update that
   * found its match answers 200 instead, which is what a rerun should see.
   */
  readonly created: boolean;
  /** Where the resource now lives, such as Patient/28886. */
  readonly reference: string | undefined;
  /** The version the server stored, such as 1. */
  readonly version: string | undefined;
}

interface ResponseEntry {
  readonly response?: { readonly status?: unknown; readonly location?: unknown };
}

interface TransactionResponseBody {
  readonly resourceType: 'Bundle';
  readonly type: 'transaction-response';
  readonly entry?: readonly ResponseEntry[];
}

/** Resource type, id and optionally a version, as found in a location header. */
const LOCATION = /^(?:.*\/)?([A-Z][A-Za-z]+)\/([A-Za-z0-9\-.]{1,64})(?:\/_history\/([A-Za-z0-9\-.]{1,64}))?$/;

/**
 * Reads the bundle a server answers a committed transaction with. Its entries
 * come back in the same order as the entries that were sent, which is what
 * lets each one be matched to the CSV row behind it.
 *
 * Returns undefined for anything that is not a transaction response.
 */
export function readTransactionResponse(body: unknown): readonly EntryOutcome[] | undefined {
  if (!isTransactionResponse(body)) {
    return undefined;
  }

  return (body.entry ?? []).map((entry) => {
    const status = typeof entry.response?.status === 'string' ? entry.response.status : '';
    const location = typeof entry.response?.location === 'string' ? entry.response.location : undefined;
    const match = location === undefined ? null : LOCATION.exec(location);

    return {
      status,
      created: status.startsWith('201'),
      reference: match === null ? undefined : `${match[1] ?? ''}/${match[2] ?? ''}`,
      version: match?.[3],
    };
  });
}

function isTransactionResponse(body: unknown): body is TransactionResponseBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    'resourceType' in body &&
    body.resourceType === 'Bundle' &&
    'type' in body &&
    body.type === 'transaction-response'
  );
}
