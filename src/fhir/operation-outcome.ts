import type { OperationOutcomeIssue } from 'fhir/r4.js';

/** How serious an issue is. Only fatal and error make a resource unusable. */
export type IssueSeverity = OperationOutcomeIssue['severity'];

/** One finding from the server, flattened into something worth printing. */
export interface OutcomeIssue {
  readonly severity: IssueSeverity;
  readonly code: string;
  /** The element the issue is about, such as Bundle.entry[3].resource. */
  readonly location: string | undefined;
  readonly message: string;
}

const BUNDLE_ENTRY = /^Bundle\.entry\[(\d+)\]/;

/**
 * Reads an OperationOutcome, the resource a FHIR server answers with when it
 * has something to say about a request. Returns undefined when the body is
 * anything else, so the caller can tell "the server disagreed" apart from
 * "the server did not answer in FHIR at all".
 */
export function readOutcomeIssues(body: unknown): readonly OutcomeIssue[] | undefined {
  if (!isOperationOutcome(body)) {
    return undefined;
  }

  return (body.issue ?? []).map((issue) => ({
    severity: issue.severity,
    code: issue.code,
    location: issue.expression?.[0] ?? issue.location?.[0],
    message: issue.diagnostics ?? issue.details?.text ?? issue.code,
  }));
}

/** Only these stop a resource from being uploaded. Warnings are reported. */
export function isBlocking(issue: OutcomeIssue): boolean {
  return issue.severity === 'fatal' || issue.severity === 'error';
}

/**
 * Finds which bundle entry an issue is about, so a complaint about
 * Bundle.entry[3] can be traced back to the CSV row that produced it.
 */
export function bundleEntryIndex(issue: OutcomeIssue): number | undefined {
  const match = issue.location === undefined ? null : BUNDLE_ENTRY.exec(issue.location);
  if (match === null) {
    return undefined;
  }

  const index = Number(match[1]);
  return Number.isInteger(index) ? index : undefined;
}

/** An OperationOutcome as it arrives over the wire, where issue may be absent. */
interface OutcomeBody {
  readonly resourceType: 'OperationOutcome';
  readonly issue?: readonly OperationOutcomeIssue[];
}

function isOperationOutcome(body: unknown): body is OutcomeBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    'resourceType' in body &&
    body.resourceType === 'OperationOutcome'
  );
}
