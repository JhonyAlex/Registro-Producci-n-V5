import { DashboardFieldOption, DashboardRuleCondition, DashboardSumRule, FieldCatalogEntry, ProductionRecord } from '../types';

export const DASHBOARD_ALLOWED_CORE_FIELDS: DashboardFieldOption[] = [
  { key: 'date', label: 'Fecha de turno', type: 'date', source: 'core' },
  { key: 'shift', label: 'Turno', type: 'text', source: 'core' },
  { key: 'boss', label: 'Jefe de turno', type: 'text', source: 'core' },
  { key: 'operator', label: 'Operario', type: 'text', source: 'core' },
  { key: 'machine', label: 'Seleccionar máquina', type: 'text', source: 'core' },
  { key: 'meters', label: 'Metros', type: 'number', source: 'core' },
  { key: 'changesCount', label: 'Cantidad de cambios', type: 'number', source: 'core' },
  { key: 'changesComment', label: 'Comentario/incidencia', type: 'text', source: 'core' },
];

export const normalizeDashboardDynamicFieldKey = (value: string) =>
  String(value || '').trim().toLocaleLowerCase('es');

export const getDynamicFieldValueByKey = (
  dynamicFieldsValues: Record<string, unknown> | undefined,
  field: string
): unknown => {
  const requestedKey = String(field || '').startsWith('dynamic.') ? String(field).slice(8) : String(field || '');
  const trimmedKey = requestedKey.trim();

  if (!trimmedKey || !dynamicFieldsValues) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(dynamicFieldsValues, trimmedKey)) {
    return dynamicFieldsValues[trimmedKey];
  }

  const normalizedRequestedKey = normalizeDashboardDynamicFieldKey(trimmedKey);
  for (const [candidateKey, candidateValue] of Object.entries(dynamicFieldsValues)) {
    if (normalizeDashboardDynamicFieldKey(candidateKey) === normalizedRequestedKey) {
      return candidateValue;
    }
  }

  return undefined;
};

const normalizeFieldKeyForAlias = (value: string): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export const normalizeKeyForAlias = normalizeFieldKeyForAlias;

const CORE_ALIAS_KEYS = new Set(
  ['metros', 'metro', 'meters', 'cambiopedido', 'cambio_pedido', 'cambios', 'changescount', 'changes']
    .map(normalizeFieldKeyForAlias)
);

export const buildDynamicFieldOptionsFromCatalog = (
  fieldCatalog: Array<Pick<FieldCatalogEntry, 'key' | 'label' | 'type'>>
): DashboardFieldOption[] => {
  const uniqueByNormalizedKey = new Map<string, DashboardFieldOption>();

  fieldCatalog.forEach((field) => {
    const rawKey = String(field.key || '').trim();
    if (!rawKey) return;

    const normalizedKey = normalizeDashboardDynamicFieldKey(rawKey);
    if (uniqueByNormalizedKey.has(normalizedKey)) return;

    if (CORE_ALIAS_KEYS.has(normalizeFieldKeyForAlias(rawKey))) return;

    uniqueByNormalizedKey.set(normalizedKey, {
      key: `dynamic.${rawKey}`,
      label: String(field.label || rawKey).trim() || rawKey,
      type: field.type === 'number' ? 'number' : 'text',
      source: 'dynamic',
    });
  });

  const dynamicOptions = Array.from(uniqueByNormalizedKey.values());
  const duplicateLabels = new Map<string, number>();

  [...DASHBOARD_ALLOWED_CORE_FIELDS, ...dynamicOptions].forEach((field) => {
    const normalizedLabel = normalizeDashboardDynamicFieldKey(field.label);
    if (!normalizedLabel) return;
    duplicateLabels.set(normalizedLabel, (duplicateLabels.get(normalizedLabel) || 0) + 1);
  });

  return dynamicOptions
    .map((field) => {
      const normalizedLabel = normalizeDashboardDynamicFieldKey(field.label);
      if ((duplicateLabels.get(normalizedLabel) || 0) <= 1) {
        return field;
      }

      return {
        ...field,
        label: `${field.label} (${field.key.slice(8)})`,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
};

export const METER_FIELD_ALIASES = ['metros', 'metro', 'meters'] as const;

export const CHANGE_FIELD_ALIASES = [
  'cambiopedido',
  'cambio_pedido',
  'cambios',
  'changescount',
  'changes',
] as const;

export const getDynamicValueByAliases = (
  dynamicFieldsValues: Record<string, unknown> | undefined,
  aliases: readonly string[]
): unknown => {
  if (!dynamicFieldsValues) return undefined;
  const entries = Object.entries(dynamicFieldsValues);
  for (const [key, value] of entries) {
    const normalized = normalizeFieldKeyForAlias(key);
    if (aliases.some((alias) => normalizeFieldKeyForAlias(alias) === normalized)) {
      return value;
    }
  }
  return undefined;
};

export const getMetersValue = (record: ProductionRecord): unknown => {
  const dynamicMeters = getDynamicValueByAliases(record.dynamicFieldsValues, METER_FIELD_ALIASES);
  return dynamicMeters !== undefined ? dynamicMeters : record.meters;
};

export const getChangesValue = (record: ProductionRecord): unknown => {
  const dynamicChanges = getDynamicValueByAliases(record.dynamicFieldsValues, CHANGE_FIELD_ALIASES);
  return dynamicChanges !== undefined ? dynamicChanges : record.changesCount;
};

const passesRuleCondition = (
  record: ProductionRecord,
  condition: DashboardRuleCondition
): boolean => {
  const fieldValue = getDynamicFieldValueByKey(record.dynamicFieldsValues, condition.field);
  const displayValue = fieldValue !== undefined ? toDisplayString(fieldValue) : '';

  switch (condition.operator) {
    case 'equals':
      return displayValue === String(condition.value);
    case 'not_equals':
      return displayValue !== String(condition.value);
    case 'greater_than':
      return toNumeric(fieldValue) > toNumeric(condition.value);
    case 'less_than':
      return toNumeric(fieldValue) < toNumeric(condition.value);
    case 'contains':
      return displayValue.toLowerCase().includes(String(condition.value).toLowerCase());
    default:
      return true;
  }
};

const toDisplayString = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
};

const toNumeric = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(/,/g, '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

export const evaluateRuleForRecord = (
  record: ProductionRecord,
  rule: DashboardSumRule
): number => {
  if (rule.condition && !passesRuleCondition(record, rule.condition)) {
    return 0;
  }

  let total = 0;
  for (const field of rule.sourceFields) {
    const value = getDynamicFieldValueByKey(record.dynamicFieldsValues, field);
    total += toNumeric(value);
  }
  return total;
};
