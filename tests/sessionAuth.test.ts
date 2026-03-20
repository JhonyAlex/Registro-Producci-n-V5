import { describe, expect, it } from 'vitest';
import { isSessionTokenCurrent } from '../utils/sessionAuth';

describe('isSessionTokenCurrent', () => {
  it('acepta el token cuando coincide con la versión persistida', () => {
    expect(isSessionTokenCurrent(3, 3)).toBe(true);
    expect(isSessionTokenCurrent(0, '0')).toBe(true);
  });

  it('rechaza el token cuando la versión ya fue reemplazada', () => {
    expect(isSessionTokenCurrent(2, 3)).toBe(false);
    expect(isSessionTokenCurrent(undefined, 1)).toBe(false);
  });
});