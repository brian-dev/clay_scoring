import { describe, expect, it } from 'vitest';
import { displayName } from '../src/names.ts';

describe('displayName', () => {
  it('always shows minors as first name and last initial', () => {
    expect(displayName({ firstName: 'Kaden', lastName: 'Whitfield', isMinor: true })).toBe('Kaden W.');
    expect(displayName({ firstName: 'Kaden', lastName: 'whitfield', isMinor: true }, 'initial-last')).toBe('Kaden W.');
  });

  it('shows adults by full name by default', () => {
    expect(displayName({ firstName: 'Ray', lastName: 'Delgado', isMinor: false })).toBe('Ray Delgado');
  });

  it('can show adults as first initial and last name', () => {
    expect(displayName({ firstName: 'Ray', lastName: 'Delgado', isMinor: false }, 'initial-last')).toBe('R. Delgado');
  });

  it('tidies stray whitespace and copes with a missing last name', () => {
    expect(displayName({ firstName: '  Nora ', lastName: '', isMinor: true })).toBe('Nora');
    expect(displayName({ firstName: 'Mary  Beth', lastName: ' Strand ', isMinor: false })).toBe('Mary Beth Strand');
  });
});
