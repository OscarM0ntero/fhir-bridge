import { config as readDotenvFile } from 'dotenv';

/** Runtime configuration of the pipeline, resolved from the environment. */
export interface AppConfig {
  /** Base URL of the FHIR R4 server, without a trailing slash. */
  readonly fhirBaseUrl: string;
  /** Bearer token sent to the FHIR server, or undefined when it needs none. */
  readonly fhirAuthToken: string | undefined;
  /** Path to the CSV exported from the legacy clinical system. */
  readonly legacyCsvPath: string;
  /** Directory the pipeline writes its report to. */
  readonly outputDir: string;
  /** Timeout applied to every HTTP request against the FHIR server. */
  readonly requestTimeoutMs: number;
  /** When true, resources are mapped and validated but never uploaded. */
  readonly dryRun: boolean;
}

/** Thrown when an environment variable is present but cannot be used. */
export class ConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const DEFAULTS = {
  fhirBaseUrl: 'https://hapi.fhir.org/baseR4',
  legacyCsvPath: 'data/legacy-export.csv',
  outputDir: 'out',
  requestTimeoutMs: 30_000,
  dryRun: false,
} as const;

const TRUE_VALUES = ['true', '1', 'yes'];
const FALSE_VALUES = ['false', '0', 'no'];

/**
 * Loads the .env file into process.env. Kept separate from loadConfig so that
 * configuration can be resolved in tests without touching the file system.
 */
export function loadEnvFile(): void {
  readDotenvFile({ quiet: true });
}

/** Resolves the configuration, applying defaults and rejecting invalid values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    fhirBaseUrl: readUrl(env, 'FHIR_BASE_URL', DEFAULTS.fhirBaseUrl),
    fhirAuthToken: readValue(env, 'FHIR_AUTH_TOKEN'),
    legacyCsvPath: readValue(env, 'LEGACY_CSV_PATH') ?? DEFAULTS.legacyCsvPath,
    outputDir: readValue(env, 'OUTPUT_DIR') ?? DEFAULTS.outputDir,
    requestTimeoutMs: readPositiveInteger(env, 'REQUEST_TIMEOUT_MS', DEFAULTS.requestTimeoutMs),
    dryRun: readBoolean(env, 'DRY_RUN', DEFAULTS.dryRun),
  };
}

/** Reads a variable, treating blank values as absent. */
function readValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function readUrl(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = readValue(env, key) ?? fallback;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError(`${key} must be an absolute URL, received "${value}".`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConfigError(`${key} must use http or https, received "${value}".`);
  }

  // A trailing slash would produce double slashes when building endpoint paths.
  return value.replace(/\/+$/, '');
}

function readPositiveInteger(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = readValue(env, key);
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`${key} must be a positive integer, received "${value}".`);
  }

  return parsed;
}

function readBoolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const value = readValue(env, key)?.toLowerCase();
  if (value === undefined) {
    return fallback;
  }

  if (TRUE_VALUES.includes(value)) {
    return true;
  }
  if (FALSE_VALUES.includes(value)) {
    return false;
  }

  throw new ConfigError(
    `${key} must be one of ${[...TRUE_VALUES, ...FALSE_VALUES].join(', ')}, received "${value}".`,
  );
}
