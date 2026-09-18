import { LEGACY_FIELDS, showRawValue } from './legacy-fields';

describe('showRawValue', () => {
  it('shows an ordinary value as it is', () => {
    expect(showRawValue('Elena')).toBe('Elena');
  });

  it('draws the spaces at the edges that the parser had to trim', () => {
    expect(showRawValue('NOVAK ')).toBe('NOVAK␣');
    expect(showRawValue('  x')).toBe('␣␣x');
  });

  it('leaves the spaces inside a value alone', () => {
    expect(showRawValue('Fabry disease')).toBe('Fabry disease');
  });

  it('says so when a field is empty or missing', () => {
    expect(showRawValue('')).toBe('(empty)');
    expect(showRawValue(undefined)).toBe('(empty)');
  });
});

describe('LEGACY_FIELDS', () => {
  it('describes all sixteen columns of the export, once each', () => {
    const columns = LEGACY_FIELDS.map((field) => field.column);

    expect(columns).toHaveLength(16);
    expect(new Set(columns).size).toBe(16);
  });
});
