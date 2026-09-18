import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PipelineReport } from '../pipeline.js';
import { buildComparison, type ComparisonContext } from './comparison.js';

export const OUTPUT_FILES = {
  bundles: 'bundles',
  parseReport: 'parse-report.json',
  results: 'results.json',
  comparison: 'comparison.json',
} as const;

/**
 * Writes what a run produced:
 *
 *   bundles/<MRN>.json  the transaction bundle built for each patient
 *   parse-report.json   rows the parser rejected, and every warning raised
 *   results.json        what the server said and did for each patient
 *   comparison.json     every CSV row next to the FHIR resources it became
 *
 * Output from an earlier run is removed first, so the directory never mixes
 * two runs. That matters most for results.json: an offline run must not leave
 * the results of an earlier upload lying next to its fresh bundles.
 */
export function writeRunOutput(outputDir: string, report: PipelineReport, context: ComparisonContext): void {
  const bundlesDir = join(outputDir, OUTPUT_FILES.bundles);
  rmSync(bundlesDir, { recursive: true, force: true });
  rmSync(join(outputDir, OUTPUT_FILES.results), { force: true });
  mkdirSync(bundlesDir, { recursive: true });

  for (const transaction of report.transactions) {
    writeJson(join(bundlesDir, `${safeFileName(transaction.mrn)}.json`), transaction.bundle);
  }

  writeJson(join(outputDir, OUTPUT_FILES.parseReport), {
    rejected: report.parse.rejected,
    parseWarnings: report.parse.warnings,
    mappingWarnings: report.mappingWarnings,
  });

  if (report.mode !== 'offline') {
    writeJson(join(outputDir, OUTPUT_FILES.results), report.outcomes);
  }

  writeJson(join(outputDir, OUTPUT_FILES.comparison), buildComparison(report, context));
}

/**
 * The MRN comes from the export, so it is untrusted input. Anything beyond
 * letters, digits, dots, dashes and underscores is replaced, which keeps a
 * value such as ../../etc from writing outside the output directory.
 */
export function safeFileName(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_');
  return cleaned === '' ? '_' : cleaned;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
