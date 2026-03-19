import { describe, expect, it } from 'vitest';
import { getDailyPhrase, getDailyPhraseIndex, getDayOfYear, motivationalPhrases } from '../utils/dailyPhrase';

describe('daily phrase rotation', () => {
  it('calculates day of year correctly for leap year', () => {
    expect(getDayOfYear(new Date('2024-01-01T12:00:00'))).toBe(1);
    expect(getDayOfYear(new Date('2024-12-31T12:00:00'))).toBe(366);
  });

  it('keeps index deterministic for same date', () => {
    const date = new Date('2026-03-19T08:00:00');
    const first = getDailyPhraseIndex(date, motivationalPhrases.length);
    const second = getDailyPhraseIndex(date, motivationalPhrases.length);
    expect(first).toBe(second);
  });

  it('returns different phrase on different days', () => {
    const dayOne = getDailyPhrase(new Date('2026-03-19T08:00:00'));
    const dayTwo = getDailyPhrase(new Date('2026-03-20T08:00:00'));
    expect(dayOne).not.toBe(dayTwo);
  });

  it('cycles inside the 30 phrases list', () => {
    expect(motivationalPhrases).toHaveLength(30);
    const phrase = getDailyPhrase(new Date('2026-12-31T08:00:00'));
    expect(motivationalPhrases).toContain(phrase);
  });
});
