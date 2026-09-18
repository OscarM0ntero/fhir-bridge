import { describe, expect, it } from 'vitest';

import { UsageError, parseCliArgs, resolveMode } from '../src/cli-args.js';

describe('parseCliArgs', () => {
  it('reads no options as a plain run', () => {
    expect(parseCliArgs([])).toEqual({ offline: false, dryRun: false, help: false });
  });

  it.each([
    [['--offline'], { offline: true, dryRun: false, help: false }],
    [['--dry-run'], { offline: false, dryRun: true, help: false }],
    [['--help'], { offline: false, dryRun: false, help: true }],
  ])('reads %j', (argv, expected) => {
    expect(parseCliArgs(argv)).toEqual(expected);
  });

  it('refuses a mistyped option instead of running without it', () => {
    // Ignoring --ofline would start a real upload, the opposite of what was meant.
    expect(() => parseCliArgs(['--ofline'])).toThrow(UsageError);
    expect(() => parseCliArgs(['--ofline'])).toThrow(/--ofline/);
  });

  it('refuses arguments that are not options', () => {
    expect(() => parseCliArgs(['data/other.csv'])).toThrow(UsageError);
  });

  it('refuses a value given to a flag', () => {
    expect(() => parseCliArgs(['--dry-run=false'])).toThrow(UsageError);
  });

  it('refuses --offline together with --dry-run, which contradict each other', () => {
    expect(() => parseCliArgs(['--offline', '--dry-run'])).toThrow(/cannot be combined/);
  });
});

describe('resolveMode', () => {
  const none = { offline: false, dryRun: false, help: false };

  it('uploads when nothing says otherwise', () => {
    expect(resolveMode(none, false)).toBe('upload');
  });

  it('runs dry when the flag asks for it', () => {
    expect(resolveMode({ ...none, dryRun: true }, false)).toBe('dry-run');
  });

  it('runs dry when the environment asks for it', () => {
    expect(resolveMode(none, true)).toBe('dry-run');
  });

  it('stays offline even when the environment asks for a dry run', () => {
    expect(resolveMode({ ...none, offline: true }, true)).toBe('offline');
  });
});
