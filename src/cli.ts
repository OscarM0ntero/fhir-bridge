import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildPatientTransaction, type PatientTransaction } from './fhir/bundle.js';
import { FhirClient, FhirRequestError, type ValidationReport } from './fhir/client.js';
import { bundleEntryIndex, isBlocking } from './fhir/operation-outcome.js';
import { groupByPatient } from './fhir/patient-groups.js';
import { loadConfig, loadEnvFile } from './config.js';
import { LegacyParseError, parseLegacyCsv } from './legacy/parser.js';

/**
 * Runs the pipeline as far as it goes today: read the export, map it, and ask
 * the server to check the result. Uploading is not built yet.
 */
async function main(): Promise<void> {
  const offline = process.argv.includes('--offline');
  loadEnvFile();
  const config = loadConfig();
  const outputDir = config.outputDir;

  console.log('FHIR Bridge');
  console.log(`  source    ${config.legacyCsvPath}`);
  console.log(`  server    ${offline ? 'not contacted (--offline)' : config.fhirBaseUrl}`);
  console.log(`  timezone  ${config.sourceTimezoneOffset} for timestamps that carry no zone`);

  const parsed = parseLegacyCsv(readFileSync(config.legacyCsvPath));
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

  const { groups, warnings: mergeWarnings } = groupByPatient(parsed.records);
  const transactions = groups.map((group) =>
    buildPatientTransaction(group, { timezoneOffset: config.sourceTimezoneOffset }),
  );
  const mappingWarnings = [...mergeWarnings, ...transactions.flatMap((transaction) => transaction.warnings)];
  const resourceCount = transactions.reduce((total, transaction) => total + (transaction.bundle.entry?.length ?? 0), 0);

  console.log('\nMapping');
  console.log(`  ${String(groups.length)} patients, ${String(resourceCount)} resources`);
  for (const warning of mappingWarnings) {
    console.log(`  warning   line ${String(warning.sourceRow)}  ${warning.message}`);
  }

  writeOutput(outputDir, transactions, parsed);

  if (offline) {
    console.log(`\nWrote the bundles to ${join(outputDir, 'bundles')}. The server was not contacted.`);
    return;
  }

  console.log('\nValidating against the server');
  const client = new FhirClient({
    baseUrl: config.fhirBaseUrl,
    authToken: config.fhirAuthToken,
    timeoutMs: config.requestTimeoutMs,
  });

  const reports: Record<string, ValidationReport> = {};
  let invalid = 0;

  for (const transaction of transactions) {
    const report = await client.validate(transaction.bundle);
    reports[transaction.mrn] = report;
    if (!report.valid) {
      invalid += 1;
    }
    console.log(`  ${transaction.mrn.padEnd(12)} ${report.valid ? 'ok    ' : 'FAILED'}  ${describe(report)}`);
    for (const issue of report.issues.filter(isBlocking)) {
      console.log(`    error  ${where(transaction, issue.location)}  ${issue.message}`);
    }
  }

  writeFileSync(join(outputDir, 'validation.json'), `${JSON.stringify(reports, null, 2)}\n`);

  console.log('\nSummary');
  console.log(`  ${String(transactions.length)} bundles validated, ${String(invalid)} with errors`);
  console.log(`  bundles written to ${join(outputDir, 'bundles')}`);
  console.log(`  validation written to ${join(outputDir, 'validation.json')}`);
  console.log('  uploading is not implemented yet, so nothing was stored on the server');

  if (invalid > 0) {
    process.exitCode = 1;
  }
}

function describe(report: ValidationReport): string {
  const errors = report.issues.filter(isBlocking).length;
  const warnings = report.issues.length - errors;
  return `${String(errors)} errors, ${String(warnings)} warnings`;
}

/** Turns Bundle.entry[3] back into the CSV row that produced that entry. */
function where(transaction: PatientTransaction, location: string | undefined): string {
  const index = location === undefined ? undefined : bundleEntryIndex({ severity: 'error', code: '', location, message: '' });
  const source = index === undefined ? undefined : transaction.sources[index];
  if (source === undefined) {
    return location ?? 'unknown';
  }
  return `${source.resourceType} from line ${source.sourceRows.join(', ')}`;
}

function writeOutput(
  outputDir: string,
  transactions: readonly PatientTransaction[],
  parsed: ReturnType<typeof parseLegacyCsv>,
): void {
  rmSync(join(outputDir, 'bundles'), { recursive: true, force: true });
  mkdirSync(join(outputDir, 'bundles'), { recursive: true });

  for (const transaction of transactions) {
    const file = join(outputDir, 'bundles', `${transaction.mrn}.json`);
    writeFileSync(file, `${JSON.stringify(transaction.bundle, null, 2)}\n`);
  }

  writeFileSync(
    join(outputDir, 'parse-report.json'),
    `${JSON.stringify({ rejected: parsed.rejected, warnings: parsed.warnings }, null, 2)}\n`,
  );
}

try {
  await main();
} catch (error) {
  if (error instanceof LegacyParseError || error instanceof FhirRequestError) {
    console.error(`\n${error.name}: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
