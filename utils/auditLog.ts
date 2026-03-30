import type { ProductionRecord } from '../types';

export type RecordAuditSnapshot = Pick<
  ProductionRecord,
  | 'date'
  | 'machine'
  | 'shift'
  | 'boss'
  | 'bossUserId'
  | 'operator'
  | 'operatorUserId'
  | 'meters'
  | 'changesCount'
  | 'changesComment'
  | 'dynamicFieldsValues'
  | 'schemaVersionUsed'
>;

const normalizeOptionalString = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const normalizeNumber = (value: unknown): number => {
  const normalized = Number(value ?? 0);
  return Number.isFinite(normalized) ? normalized : 0;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const normalizeDeepValue = (value: unknown): unknown => {
  if (value === null || value === undefined) return '';

  if (Array.isArray(value)) {
    return value.map((item) => normalizeDeepValue(item));
  }

  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalizeDeepValue(value[key]);
        return acc;
      }, {});
  }

  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return normalizeNumber(value);
  if (typeof value === 'boolean') return value;

  return normalizeOptionalString(value);
};

const stableSerialize = (value: unknown): string => JSON.stringify(normalizeDeepValue(value));

export const buildRecordAuditSnapshot = (
  source: Partial<RecordAuditSnapshot> | null | undefined,
): RecordAuditSnapshot => ({
  date: normalizeOptionalString(source?.date),
  machine: normalizeOptionalString(source?.machine),
  shift: normalizeOptionalString(source?.shift),
  boss: normalizeOptionalString(source?.boss),
  bossUserId: normalizeOptionalString(source?.bossUserId),
  operator: normalizeOptionalString(source?.operator),
  operatorUserId: normalizeOptionalString(source?.operatorUserId),
  meters: normalizeNumber(source?.meters),
  changesCount: normalizeNumber(source?.changesCount),
  changesComment: normalizeOptionalString(source?.changesComment),
  dynamicFieldsValues: (normalizeDeepValue(source?.dynamicFieldsValues || {}) as Record<string, unknown>) || {},
  schemaVersionUsed: normalizeNumber(source?.schemaVersionUsed),
});

const collectChangedPaths = (beforeValue: unknown, afterValue: unknown, prefix = ''): string[] => {
  const normalizedBefore = normalizeDeepValue(beforeValue);
  const normalizedAfter = normalizeDeepValue(afterValue);

  if (stableSerialize(normalizedBefore) === stableSerialize(normalizedAfter)) {
    return [];
  }

  if (Array.isArray(normalizedBefore) || Array.isArray(normalizedAfter)) {
    return prefix ? [prefix] : [];
  }

  if (isPlainObject(normalizedBefore) && isPlainObject(normalizedAfter)) {
    return Array.from(new Set([...Object.keys(normalizedBefore), ...Object.keys(normalizedAfter)]))
      .sort()
      .flatMap((key) => collectChangedPaths(normalizedBefore[key], normalizedAfter[key], prefix ? `${prefix}.${key}` : key));
  }

  return prefix ? [prefix] : [];
};

export const getRecordAuditChangedFields = (
  before: Partial<RecordAuditSnapshot> | null | undefined,
  after: Partial<RecordAuditSnapshot> | null | undefined,
): string[] => collectChangedPaths(buildRecordAuditSnapshot(before), buildRecordAuditSnapshot(after));

export const hasRecordAuditChanges = (
  before: Partial<RecordAuditSnapshot> | null | undefined,
  after: Partial<RecordAuditSnapshot> | null | undefined,
): boolean => getRecordAuditChangedFields(before, after).length > 0;