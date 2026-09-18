import { parseArgs } from 'node:util';

/** The command line could not be understood. */
export class UsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface CliArgs {
  readonly offline: boolean;
  readonly dryRun: boolean;
  readonly help: boolean;
}

/** How far a run goes: map only, validate, or validate and upload. */
export type RunMode = 'offline' | 'dry-run' | 'upload';

export const USAGE = `Usage: npm start -- [options]

Reads the legacy export, maps it to FHIR R4, validates every patient against
the server and uploads the ones that pass. Uploading twice does not duplicate
anything: every resource is a conditional update on its legacy identifier.

Options:
  --dry-run   validate against the server but store nothing (same as DRY_RUN=true)
  --offline   map and write the bundles without contacting the server at all
  --help      show this message

Configuration is read from .env: see .env.example.`;

/**
 * Reads the command line strictly. An unknown option is an error rather than
 * something to skip: a mistyped --offline that was quietly ignored would turn
 * a run meant to stay local into one that uploads.
 */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  let values: { offline: boolean; 'dry-run': boolean; help: boolean };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        offline: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    const detail = error instanceof Error ? (error.message.split('. ')[0] ?? error.message) : String(error);
    throw new UsageError(detail);
  }

  if (values.offline && values['dry-run']) {
    throw new UsageError('--offline and --dry-run cannot be combined: an offline run never reaches the server.');
  }

  return { offline: values.offline, dryRun: values['dry-run'], help: values.help };
}

/** The command line wins over the environment, and offline wins over both. */
export function resolveMode(args: CliArgs, dryRunFromConfig: boolean): RunMode {
  if (args.offline) {
    return 'offline';
  }
  return args.dryRun || dryRunFromConfig ? 'dry-run' : 'upload';
}
