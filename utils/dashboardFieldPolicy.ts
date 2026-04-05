import { DashboardFieldOption, FieldCatalogEntry } from '../types';

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
