import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults when the environment is empty', () => {
    const config = loadConfig({});

    expect(config).toEqual({
      fhirBaseUrl: 'https://hapi.fhir.org/baseR4',
      fhirAuthToken: undefined,
      legacyCsvPath: 'data/legacy-export.csv',
      outputDir: 'out',
      requestTimeoutMs: 30_000,
      dryRun: false,
      sourceTimezoneOffset: 'Z',
    });
  });

  it('reads every value from the environment', () => {
    const config = loadConfig({
      FHIR_BASE_URL: 'http://localhost:8080/fhir',
      FHIR_AUTH_TOKEN: 'token-value',
      LEGACY_CSV_PATH: 'fixtures/export.csv',
      OUTPUT_DIR: 'build/report',
      REQUEST_TIMEOUT_MS: '5000',
      DRY_RUN: 'true',
      SOURCE_TIMEZONE_OFFSET: '+02:00',
    });

    expect(config).toEqual({
      fhirBaseUrl: 'http://localhost:8080/fhir',
      fhirAuthToken: 'token-value',
      legacyCsvPath: 'fixtures/export.csv',
      outputDir: 'build/report',
      requestTimeoutMs: 5000,
      dryRun: true,
      sourceTimezoneOffset: '+02:00',
    });
  });

  it('treats blank and whitespace-only values as absent', () => {
    const config = loadConfig({ FHIR_AUTH_TOKEN: '   ', OUTPUT_DIR: '' });

    expect(config.fhirAuthToken).toBeUndefined();
    expect(config.outputDir).toBe('out');
  });

  it('trims surrounding whitespace', () => {
    const config = loadConfig({ FHIR_BASE_URL: '  https://example.org/fhir  ' });

    expect(config.fhirBaseUrl).toBe('https://example.org/fhir');
  });

  it('strips trailing slashes from the base URL', () => {
    const config = loadConfig({ FHIR_BASE_URL: 'https://example.org/fhir//' });

    expect(config.fhirBaseUrl).toBe('https://example.org/fhir');
  });

  it('rejects a base URL that is not absolute', () => {
    expect(() => loadConfig({ FHIR_BASE_URL: '/baseR4' })).toThrow(ConfigError);
  });

  it('rejects a base URL that does not use http or https', () => {
    expect(() => loadConfig({ FHIR_BASE_URL: 'ftp://example.org/fhir' })).toThrow(ConfigError);
  });

  it.each(['0', '-1', '1.5', 'soon'])('rejects the timeout value %s', (timeout) => {
    expect(() => loadConfig({ REQUEST_TIMEOUT_MS: timeout })).toThrow(ConfigError);
  });

  it.each([
    ['true', true],
    ['TRUE', true],
    ['1', true],
    ['yes', true],
    ['false', false],
    ['0', false],
    ['no', false],
  ])('reads DRY_RUN=%s as %s', (value, expected) => {
    expect(loadConfig({ DRY_RUN: value }).dryRun).toBe(expected);
  });

  it('rejects a DRY_RUN value that is not a boolean', () => {
    expect(() => loadConfig({ DRY_RUN: 'maybe' })).toThrow(ConfigError);
  });

  it.each(['Z', '+02:00', '-05:00', '+14:00', '-00:30'])(
    'accepts the timezone offset %s',
    (offset) => {
      expect(loadConfig({ SOURCE_TIMEZONE_OFFSET: offset }).sourceTimezoneOffset).toBe(offset);
    },
  );

  it.each(['+2:00', '+02', '0200', '+14:30', '+15:00', '+02:60', 'CET', 'UTC'])(
    'rejects the timezone offset %s',
    (offset) => {
      expect(() => loadConfig({ SOURCE_TIMEZONE_OFFSET: offset })).toThrow(ConfigError);
    },
  );
});
