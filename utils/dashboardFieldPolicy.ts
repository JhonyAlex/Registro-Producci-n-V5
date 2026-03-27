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

export const buildDynamicFieldOptionsFromCatalog = (
  fieldCatalog: Array<Pick<FieldCatalogEntry, 'key' | 'label' | 'type'>>
): DashboardFieldOption[] => {
  const uniqueByNormalizedKey = new Map<string, DashboardFieldOption>();

  fieldCatalog.forEach((field) => {
    const rawKey = String(field.key || '').trim();
    if (!rawKey) return;

    const normalizedKey = rawKey.toLowerCase();
    if (uniqueByNormalizedKey.has(normalizedKey)) return;

    uniqueByNormalizedKey.set(normalizedKey, {
      key: `dynamic.${rawKey}`,
      label: String(field.label || rawKey).trim() || rawKey,
      type: field.type === 'number' ? 'number' : 'text',
      source: 'dynamic',
    });
  });

  return Array.from(uniqueByNormalizedKey.values()).sort((a, b) => a.label.localeCompare(b.label));
};
