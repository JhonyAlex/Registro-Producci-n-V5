import phrasesDataset from '../data/motivationalPhrases.json';

export interface MotivationalPhrasesDataset {
  appName: string;
  phrases: string[];
}

export const motivationalPhrases = (phrasesDataset as MotivationalPhrasesDataset).phrases;

export const getDayOfYear = (date: Date): number => {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const diffMs = date.getTime() - startOfYear.getTime();
  return Math.floor(diffMs / 86400000) + 1;
};

export const getDailyPhraseIndex = (date: Date, totalPhrases: number): number => {
  if (totalPhrases <= 0) return 0;
  return (getDayOfYear(date) - 1) % totalPhrases;
};

export const getDailyPhrase = (date: Date = new Date(), phrases: string[] = motivationalPhrases): string => {
  if (!phrases.length) return '';
  const index = getDailyPhraseIndex(date, phrases.length);
  return phrases[index];
};
