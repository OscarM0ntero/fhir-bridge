import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildPatientTransaction, type PatientTransaction } from './fhir/bundle.js';
import { FhirClient, FhirRequestError } from './fhir/client.js';
import { bundleEntryIndex, isBlocking, type OutcomeIssue } from './fhir/operation-outcome.js';
import { groupByPatient } from './fhir/patient-groups.js';
import { uploadPatient, type PatientOutcome } from './fhir/uploader.js';
import { loadConfig, loadEnvFile } from './config.js';
import { LegacyParseError, parseLegacyCsv } from './legacy/parser.js';
import type { ParseResult } from './legacy/types.js';

/**
 * Runs the pipeline: read the export, map it, validate each patient against
 * the server and upload the ones that pass.
 *
 *   --offline   map only and write the bundles, without contacting the server
 *   --dry-run   validate against the server but store nothing (or DRY_RUN=true)
 */
async function main(): Promise<void> {
  const offline = process.argv.includes('--offline');
  loadEnvFile();
  const config = loadConfig();
  const dryRun = config.dryRun || process.argv.includes('--dry-run');
  const outputDir = config.outputDir;

  console.log('FHIR Bridge');
  console.log(`  source    ${config.legacyCsvPath}`);
  console.log(`  server    ${offline ? 'not contacted (--offline)' : config.fhirBaseUrl}`);
  console.log(`  mode      ${offline ? 'offline' : dryRun ? 'dry run, nothing is stored' : 'validate and upload'}`);
  console.log(`  timezone  ${config.sourceTimezoneOffset} for timestamps that carry no zone`);

  const parsed = parseLegacyCsv(readFileSync(config.legacyCsvPath));
  printParsing(parsed);

  const { groups, warnings: mergeWarnings } = groupByPatient(parsed.records);
  const transactions = groups.map((group) =>
    buildPatientTransaction(group, { timezoneOffset: config.sourceTimezoneOffset }),
  );
  const mappingWarnings = [...mergeWarnings, ...transactions.flatMap((transaction) => transaction.warnings)];
  const resourceCount = transactions.reduce((total, transaction) => total + transaction.sources.length, 0);

  console.log('\nMapping');
  console.log(`  ${String(groups.length)} patients, ${String(resourceCount)} resources`);
  for (const warning of mappingWarnings) {
    console.log(`  warning   line ${String(warning.sourceRow)}  ${warning.message}`);
  }

  writeBundles(outputDir, transactions, parsed);
  if (offline) {
    console.log(`\nWrote the bundles to ${join(outputDir, 'bundles')}. The server was not contacted.`);
    return;
  }

  console.log(dryRun ? '\nValidating (dry run)' : '\nValidating and uploading');
  const client = new FhirClient({
    baseUrl: config.fhirBaseUrl,
    authToken: config.fhirAuthToken,
    timeoutMs: config.requestTimeoutMs,
  });

  const outcomes: PatientOutcome[] = [];
  for (const transaction of transactions) {
    const outcome = await uploadPatient(client, transaction, { dryRun });
    outcomes.push(outcome);
    printOutcome(transaction, outcome);
  }

  writeFileSync(join(outputDir, 'results.json'), `${JSON.stringify(outcomes, null, 2)}\n`);
  printSummary(outcomes, dryRun, outputDir);

  if (outcomes.some((outcome) => outcome.upload.kind === 'rejected' || !outcome.validation.valid)) {
    process.exitCode = 1;
  }
}

function printParsing(parsed: ParseResult): void {
  console.log('\nParsing');
  console.log(
    `  ${String(parsed.records.length)} rows accepted, ${String(parsed.rejected.length)} rejected, ${String(parsed.warnings.length)} warnings`,
  );
  for (const rejection of parsed.rejected) {
    console.log(`  rejected  line ${String(rejection.sourceRow)}  ${rejection.recordId ?? '-'}  ${rejection.reason}`);
  }
  for (const warning of parsed.warnings) {
    console.log(`  warning   line ${String(warning.sourceRow)}  ${warning.column}  ${warning.message}`);
  }
}

function printOutcome(transaction: PatientTransaction, outcome: PatientOutcome): void {
  const warnings = outcome.validation.issues.length - outcome.validation.issues.filter(isBlocking).length;
  const label = transaction.mrn.padEnd(12);
  const { upload } = outcome;

  switch (upload.kind) {
    case 'committed': {
      const created = upload.entries.filter((entry) => entry.created).length;
      const updated = upload.entries.length - created;
      console.log(
        `  ${label} uploaded  ${String(created)} created, ${String(updated)} updated  (${String(warnings)} warnings)`,
      );
      break;
    }
    case 'skipped':
      if (upload.reason === 'dry-run') {
        console.log(`  ${label} valid     not stored, dry run  (${String(warnings)} warnings)`);
      } else {
        console.log(`  ${label} INVALID   not sent`);
        printErrors(transaction, outcome.validation.issues);
      }
      break;
    case 'rejected':
      console.log(`  ${label} REFUSED   HTTP ${String(upload.httpStatus)}, nothing stored`);
      printErrors(transaction, upload.issues);
      break;
  }
}

function printErrors(transaction: PatientTransaction, issues: readonly OutcomeIssue[]): void {
  for (const issue of issues.filter(isBlocking)) {
    console.log(`    error  ${where(transaction, issue)}  ${issue.message}`);
  }
}

/** Turns Bundle.entry[3] back into the CSV row that produced that entry. */
function where(transaction: PatientTransaction, issue: OutcomeIssue): string {
  const index = bundleEntryIndex(issue);
  const source = index === undefined ? undefined : transaction.sources[index];
  if (source === undefined) {
    return issue.location ?? 'bundle';
  }
  return `${source.resourceType} from line ${source.sourceRows.join(', ')}`;
}

function printSummary(outcomes: readonly PatientOutcome[], dryRun: boolean, outputDir: string): void {
  const refused = outcomes.filter((outcome) => outcome.upload.kind === 'rejected').length;
  const uploaded = outcomes.filter((outcome) => outcome.upload.kind === 'committed').length;
  const invalid = outcomes.filter((outcome) => !outcome.validation.valid).length;
  const entries = outcomes.flatMap((outcome) => (outcome.upload.kind === 'committed' ? outcome.upload.entries : []));
  const created = entries.filter((entry) => entry.created).length;

  console.log('\nSummary');
  if (dryRun) {
    console.log(`  ${String(outcomes.length)} patients validated, ${String(invalid)} invalid. Nothing was stored.`);
  } else {
    console.log(
      `  ${String(outcomes.length)} patients: ${String(uploaded)} uploaded, ${String(invalid)} invalid, ${String(refused)} refused`,
    );
    console.log(
      `  ${String(entries.length)} resources: ${String(created)} created, ${String(entries.length - created)} updated`,
    );
  }
  console.log(`  results written to ${join(outputDir, 'results.json')}`);
}

function writeBundles(outputDir: string, transactions: readonly PatientTransaction[], parsed: ParseResult): void {
  rmSync(join(outputDir, 'bundles'), { recursive: true, force: true });
  mkdirSync(join(outputDir, 'bundles'), { recursive: true });

  for (const transaction of transactions) {
    writeFileSync(
      join(outputDir, 'bundles', `${transaction.mrn}.json`),
      `${JSON.stringify(transaction.bundle, null, 2)}\n`,
    );
  }

  writeFileSync(
    join(outputDir, 'parse-report.json'),
    `${JSON.stringify({ rejected: parsed.rejected, warnings: parsed.warnings }, null, 2)}\n`,
  );
}

try {
  await main();
} catch (error) {
  if (error instanceof LegacyParseError) {
    console.error(`\n${error.name}: ${error.message}`);
    process.exitCode = 1;
  } else if (error instanceof FhirRequestError) {
    console.error(`\n${error.name}: ${error.message}`);
    console.error('Every upload is a conditional update, so the run can simply be started again.');
    process.exitCode = 1;
  } else {
    throw error;
  }
}
