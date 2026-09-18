import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { USAGE, UsageError, parseCliArgs, resolveMode, type RunMode } from './cli-args.js';
import { ConfigError, loadConfig, loadEnvFile, type AppConfig } from './config.js';
import type { PatientTransaction } from './fhir/bundle.js';
import { FhirClient, FhirRequestError } from './fhir/client.js';
import { bundleEntryIndex, isBlocking, type OutcomeIssue } from './fhir/operation-outcome.js';
import type { PatientOutcome } from './fhir/uploader.js';
import { LegacyParseError } from './legacy/parser.js';
import {
  EXIT_CODES,
  executeRun,
  exitCodeFor,
  prepareRun,
  summarize,
  type PipelineReport,
  type PreparedRun,
} from './pipeline.js';
import { OUTPUT_FILES, writeRunOutput } from './report/writer.js';

/** The export file could not be read at all. */
class InputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

/**
 * The command line front end. It reads arguments and prints; the work itself
 * happens in the pipeline, which is where the tests are.
 */
async function main(argv: readonly string[]): Promise<number> {
  const args = parseCliArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return EXIT_CODES.ok;
  }

  loadEnvFile();
  const config = loadConfig();
  const mode = resolveMode(args, config.dryRun);
  printHeader(config, mode);

  const prepared = prepareRun(readExport(config.legacyCsvPath), config.sourceTimezoneOffset);
  printPrepared(prepared);

  if (mode !== 'offline') {
    console.log(mode === 'dry-run' ? '\nValidating (dry run, nothing is stored)' : '\nValidating and uploading');
  }

  const client = new FhirClient({
    baseUrl: config.fhirBaseUrl,
    authToken: config.fhirAuthToken,
    timeoutMs: config.requestTimeoutMs,
  });
  const report = await executeRun(client, prepared, mode, { onPatient: printOutcome });

  writeRunOutput(config.outputDir, report, {
    serverBaseUrl: config.fhirBaseUrl,
    generatedAt: new Date().toISOString(),
  });
  printSummary(report, config.outputDir);
  return exitCodeFor(report);
}

function readExport(path: string): Buffer {
  try {
    return readFileSync(path);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    const reason = code === 'ENOENT' ? 'the file does not exist' : error instanceof Error ? error.message : String(error);
    throw new InputError(`Cannot read the legacy export at ${path}: ${reason}. Check LEGACY_CSV_PATH in .env.`);
  }
}

function printHeader(config: AppConfig, mode: RunMode): void {
  const modes: Record<RunMode, string> = {
    offline: 'offline, the server is not contacted',
    'dry-run': 'dry run, validate only',
    upload: 'validate and upload',
  };

  console.log('FHIR Bridge');
  console.log(`  source    ${config.legacyCsvPath}`);
  console.log(`  server    ${config.fhirBaseUrl}`);
  console.log(`  mode      ${modes[mode]}`);
  console.log(`  timezone  ${config.sourceTimezoneOffset}, assumed for timestamps that carry none`);
}

function printPrepared({ parse, mappingWarnings, transactions }: PreparedRun): void {
  console.log('\nParsing');
  console.log(
    `  ${String(parse.records.length)} rows accepted, ${String(parse.rejected.length)} rejected, ${String(parse.warnings.length)} warnings`,
  );
  for (const rejection of parse.rejected) {
    console.log(`  rejected  line ${String(rejection.sourceRow)}  ${rejection.recordId ?? '-'}  ${rejection.reason}`);
  }
  for (const warning of parse.warnings) {
    console.log(`  warning   line ${String(warning.sourceRow)}  ${warning.column}  ${warning.message}`);
  }

  const resources = transactions.reduce((total, transaction) => total + transaction.sources.length, 0);
  console.log('\nMapping');
  console.log(`  ${String(transactions.length)} patients, ${String(resources)} resources`);
  for (const warning of [...mappingWarnings].sort((a, b) => a.sourceRow - b.sourceRow)) {
    console.log(`  warning   line ${String(warning.sourceRow)}  ${warning.message}`);
  }
}

function printOutcome(transaction: PatientTransaction, outcome: PatientOutcome): void {
  const warnings = outcome.validation.issues.filter((issue) => !isBlocking(issue)).length;
  const label = transaction.mrn.padEnd(12);
  const { upload } = outcome;

  switch (upload.kind) {
    case 'committed': {
      const created = upload.entries.filter((entry) => entry.created).length;
      const updated = upload.entries.length - created;
      console.log(`  ${label} uploaded  ${String(created)} created, ${String(updated)} updated  (${String(warnings)} warnings)`);
      break;
    }
    case 'skipped':
      if (upload.reason === 'dry-run') {
        console.log(`  ${label} valid     (${String(warnings)} warnings)`);
      } else {
        console.log(`  ${label} INVALID   not sent`);
        printErrors(transaction, outcome.validation.issues);
      }
      break;
    case 'rejected':
      console.log(`  ${label} REFUSED   HTTP ${String(upload.httpStatus)}, nothing was stored`);
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

function printSummary(report: PipelineReport, outputDir: string): void {
  const summary = summarize(report);

  console.log('\nSummary');
  switch (report.mode) {
    case 'offline':
      console.log(`  ${String(summary.patients)} patients mapped. The server was not contacted.`);
      break;
    case 'dry-run':
      console.log(
        `  ${String(summary.patients)} patients validated, ${String(summary.invalid)} invalid. Nothing was stored.`,
      );
      break;
    case 'upload':
      console.log(
        `  ${String(summary.patients)} patients: ${String(summary.uploaded)} uploaded, ${String(summary.invalid)} invalid, ${String(summary.refused)} refused`,
      );
      console.log(
        `  ${String(summary.created + summary.updated)} resources: ${String(summary.created)} created, ${String(summary.updated)} updated`,
      );
      break;
  }
  console.log(`  ${String(summary.rejectedRows)} rows of the export were rejected, see ${join(outputDir, OUTPUT_FILES.parseReport)}`);
  console.log(`  bundles written to ${join(outputDir, OUTPUT_FILES.bundles)}`);
  console.log(`  side-by-side data written to ${join(outputDir, OUTPUT_FILES.comparison)}`);
  if (report.mode !== 'offline') {
    console.log(`  results written to ${join(outputDir, OUTPUT_FILES.results)}`);
  }
}

function exitWith(code: number, message: string): void {
  console.error(message);
  process.exitCode = code;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    exitWith(EXIT_CODES.badInput, `${error.message}\n\n${USAGE}`);
  } else if (error instanceof ConfigError || error instanceof InputError || error instanceof LegacyParseError) {
    exitWith(EXIT_CODES.badInput, `\n${error.message}`);
  } else if (error instanceof FhirRequestError) {
    exitWith(
      EXIT_CODES.serverUnavailable,
      `\n${error.message}\nEvery upload is a conditional update, so the run can simply be started again.`,
    );
  } else {
    throw error;
  }
}
