import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2, RefreshCw, Settings2, BarChart3 } from 'lucide-react';
import { DashboardConfig, DashboardFieldOption, DashboardWidgetConfig, ProductionRecord } from '../types';
import {
  createDashboardConfig,
  deleteDashboardConfig,
  getDashboardConfigs,
  getFieldCatalog,
  updateDashboardConfig,
} from '../services/storageService';

interface DashboardManagerProps {
  records: ProductionRecord[];
}

type EditableDashboard = {
  id: string | null;
  name: string;
  description: string;
  baseField: string;
  relatedFields: string[];
  widgets: DashboardWidgetConfig[];
  isDefault: boolean;
};

const CORE_FIELDS: DashboardFieldOption[] = [
  { key: 'date', label: 'Fecha', type: 'date', source: 'core' },
  { key: 'machine', label: 'Maquina', type: 'text', source: 'core' },
  { key: 'shift', label: 'Turno', type: 'text', source: 'core' },
  { key: 'boss', label: 'Jefe de Turno', type: 'text', source: 'core' },
  { key: 'operator', label: 'Operario', type: 'text', source: 'core' },
  { key: 'meters', label: 'Metros', type: 'number', source: 'core' },
  { key: 'changesCount', label: 'Cantidad de Cambios', type: 'number', source: 'core' },
  { key: 'changesComment', label: 'Comentario de Cambio', type: 'text', source: 'core' },
];

const CHART_TYPES = [
  { value: 'bar', label: 'Barras' },
  { value: 'line', label: 'Linea' },
  { value: 'area', label: 'Area' },
  { value: 'pie', label: 'Torta' },
  { value: 'combined_trend', label: 'Tendencia Combinada' },
] as const;

const AGGREGATIONS = [
  { value: 'count', label: 'Conteo' },
  { value: 'sum', label: 'Suma' },
  { value: 'avg', label: 'Promedio' },
] as const;

const makeEmptyDashboard = (): EditableDashboard => ({
  id: null,
  name: '',
  description: '',
  baseField: 'machine',
  relatedFields: [],
  widgets: [
    {
      id: 'widget_1',
      title: 'Produccion por Dimension',
      chartType: 'bar',
      valueField: 'meters',
      aggregation: 'sum',
      limit: 12,
    },
  ],
  isDefault: false,
});

const DashboardManager: React.FC<DashboardManagerProps> = ({ records }) => {
  const [configs, setConfigs] = useState<DashboardConfig[]>([]);
  const [fieldOptions, setFieldOptions] = useState<DashboardFieldOption[]>(CORE_FIELDS);
  const [form, setForm] = useState<EditableDashboard>(makeEmptyDashboard());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const showSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(''), 2500);
  };

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [dashboardConfigs, fieldCatalog] = await Promise.all([getDashboardConfigs(), getFieldCatalog()]);

      const dynamicFromCatalog: DashboardFieldOption[] = fieldCatalog.map((field) => ({
        key: `dynamic.${field.key}`,
        label: field.label,
        type: field.type === 'number' ? 'number' : 'text',
        source: 'dynamic',
      }));

      const discoveredDynamicKeys = new Map<string, DashboardFieldOption>();
      records.forEach((record) => {
        Object.keys(record.dynamicFieldsValues || {}).forEach((key) => {
          if (discoveredDynamicKeys.has(key)) return;
          const value = record.dynamicFieldsValues?.[key];
          discoveredDynamicKeys.set(key, {
            key: `dynamic.${key}`,
            label: key,
            type: typeof value === 'number' ? 'number' : 'text',
            source: 'dynamic',
          });
        });
      });

      const mergedDynamic = Array.from(
        new Map([...dynamicFromCatalog, ...Array.from(discoveredDynamicKeys.values())].map((f) => [f.key, f])).values()
      ).sort((a, b) => a.label.localeCompare(b.label));

      setFieldOptions([...CORE_FIELDS, ...mergedDynamic]);
      setConfigs(dashboardConfigs);

      const first = dashboardConfigs[0];
      if (first) {
        setForm({
          id: first.id,
          name: first.name,
          description: first.description || '',
          baseField: first.baseField,
          relatedFields: first.relatedFields || [],
          widgets: first.widgets || [],
          isDefault: first.isDefault,
        });
      } else {
        setForm(makeEmptyDashboard());
      }
    } catch (err: any) {
      setError(err?.message || 'No se pudo cargar el gestor de dashboards.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records.length]);

  const selectConfig = (config: DashboardConfig) => {
    setForm({
      id: config.id,
      name: config.name,
      description: config.description || '',
      baseField: config.baseField,
      relatedFields: config.relatedFields || [],
      widgets: config.widgets || [],
      isDefault: config.isDefault,
    });
    setError('');
    setSuccess('');
  };

  const updateForm = (patch: Partial<EditableDashboard>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const updateWidget = (index: number, patch: Partial<DashboardWidgetConfig>) => {
    setForm((prev) => ({
      ...prev,
      widgets: prev.widgets.map((widget, widgetIndex) => (widgetIndex === index ? { ...widget, ...patch } : widget)),
    }));
  };

  const addWidget = () => {
    setForm((prev) => ({
      ...prev,
      widgets: [
        ...prev.widgets,
        {
          id: `widget_${Date.now()}`,
          title: `Widget ${prev.widgets.length + 1}`,
          chartType: 'bar',
          valueField: 'meters',
          aggregation: 'sum',
          limit: 12,
        },
      ],
    }));
  };

  const removeWidget = (index: number) => {
    setForm((prev) => ({
      ...prev,
      widgets: prev.widgets.filter((_, widgetIndex) => widgetIndex !== index),
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError('El nombre del dashboard es obligatorio.');
      return;
    }

    if (!form.baseField) {
      setError('Debes seleccionar un campo base.');
      return;
    }

    if (form.widgets.length === 0) {
      setError('Agrega al menos un widget.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        baseField: form.baseField,
        relatedFields: form.relatedFields.filter((field) => field !== form.baseField),
        widgets: form.widgets,
        isDefault: form.isDefault,
      };

      let saved: DashboardConfig;
      if (form.id) {
        saved = await updateDashboardConfig(form.id, payload);
        showSuccess('Dashboard actualizado.');
      } else {
        saved = await createDashboardConfig(payload);
        showSuccess('Dashboard creado.');
      }

      await loadData();
      const updated = saved;
      setForm({
        id: updated.id,
        name: updated.name,
        description: updated.description || '',
        baseField: updated.baseField,
        relatedFields: updated.relatedFields || [],
        widgets: updated.widgets || [],
        isDefault: updated.isDefault,
      });
    } catch (err: any) {
      setError(err?.message || 'No se pudo guardar el dashboard.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (config: DashboardConfig) => {
    if (!window.confirm(`Eliminar el dashboard "${config.name}"?`)) return;

    setDeletingId(config.id);
    setError('');

    try {
      await deleteDashboardConfig(config.id);
      await loadData();
      showSuccess('Dashboard eliminado.');
    } catch (err: any) {
      setError(err?.message || 'No se pudo eliminar el dashboard.');
    } finally {
      setDeletingId(null);
    }
  };

  const numericFieldOptions = useMemo(
    () => fieldOptions.filter((field) => field.type === 'number'),
    [fieldOptions]
  );

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 flex flex-col items-center gap-3 text-slate-600">
        <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
        <p className="font-medium">Cargando gestor de dashboards...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-20">
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Settings2 className="w-6 h-6 text-blue-600" /> Gestor de Dashboards Dinamicos
            </h2>
            <p className="text-sm text-slate-500 mt-1">Configura paneles visuales sin tocar codigo: campo base, campos relacionados y widgets.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setForm(makeEmptyDashboard())}
              className="inline-flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-semibold"
            >
              <Plus className="w-4 h-4" /> Nuevo
            </button>
            <button
              onClick={() => void loadData()}
              className="inline-flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-semibold"
            >
              <RefreshCw className="w-4 h-4" /> Recargar
            </button>
          </div>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm font-medium">{error}</div>}
      {success && <div className="bg-green-50 border border-green-200 text-green-700 p-4 rounded-xl text-sm font-medium">{success}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 xl:col-span-1">
          <h3 className="text-sm font-bold text-slate-700 mb-3">Dashboards Existentes</h3>
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {configs.map((config) => (
              <div
                key={config.id}
                className={`border rounded-lg p-3 ${form.id === config.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white'}`}
              >
                <button
                  onClick={() => selectConfig(config)}
                  className="w-full text-left"
                >
                  <p className="font-semibold text-slate-800 text-sm">{config.name}</p>
                  <p className="text-xs text-slate-500 mt-1">Base: {config.baseField}</p>
                  {config.isDefault && <p className="text-[10px] mt-1 text-blue-700 font-bold">DEFAULT</p>}
                </button>
                <button
                  onClick={() => void handleDelete(config)}
                  disabled={deletingId === config.id}
                  className="mt-2 inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-60"
                >
                  <Trash2 className="w-3 h-3" /> {deletingId === config.id ? 'Eliminando...' : 'Eliminar'}
                </button>
              </div>
            ))}
            {configs.length === 0 && <p className="text-sm text-slate-500">No hay dashboards creados.</p>}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 xl:col-span-2 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Nombre</label>
              <input
                value={form.name}
                onChange={(e) => updateForm({ name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                placeholder="Ej: Panel Produccion por Maquina"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Campo Base</label>
              <select
                value={form.baseField}
                onChange={(e) => updateForm({ baseField: e.target.value, relatedFields: form.relatedFields.filter((f) => f !== e.target.value) })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              >
                {fieldOptions.map((field) => (
                  <option key={field.key} value={field.key}>{field.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Descripcion</label>
            <textarea
              value={form.description}
              onChange={(e) => updateForm({ description: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              rows={2}
              placeholder="Objetivo del panel y contexto para la gerencia"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Campos Relacionados</label>
            <select
              multiple
              value={form.relatedFields}
              onChange={(e) => {
                const values = Array.from(e.target.selectedOptions)
                  .map((option) => (option as HTMLOptionElement).value)
                  .filter((f) => f !== form.baseField);
                updateForm({ relatedFields: values });
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm min-h-[96px]"
            >
              {fieldOptions.filter((field) => field.key !== form.baseField).map((field) => (
                <option key={field.key} value={field.key}>{field.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="isDefaultDashboard"
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => updateForm({ isDefault: e.target.checked })}
              className="h-4 w-4 accent-blue-600"
            />
            <label htmlFor="isDefaultDashboard" className="text-sm font-semibold text-slate-700">Marcar como dashboard por defecto</label>
          </div>

          <div className="border border-slate-200 rounded-xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-slate-800 flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Widgets</h4>
              <button
                type="button"
                onClick={addWidget}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded bg-blue-600 text-white hover:bg-blue-700"
              >
                <Plus className="w-3 h-3" /> Agregar Widget
              </button>
            </div>

            {form.widgets.map((widget, index) => (
              <div key={widget.id} className="border border-slate-200 rounded-lg p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <p className="text-xs font-bold text-slate-500">Widget {index + 1}</p>
                  <button
                    type="button"
                    onClick={() => removeWidget(index)}
                    className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 hover:bg-red-100"
                  >
                    Quitar
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input
                    value={widget.title}
                    onChange={(e) => updateWidget(index, { title: e.target.value })}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    placeholder="Titulo del widget"
                  />

                  <select
                    value={widget.chartType}
                    onChange={(e) => updateWidget(index, { chartType: e.target.value as DashboardWidgetConfig['chartType'] })}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  >
                    {CHART_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>

                  <select
                    value={widget.valueField}
                    onChange={(e) => updateWidget(index, { valueField: e.target.value })}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  >
                    {(widget.aggregation === 'count' ? fieldOptions : numericFieldOptions).map((field) => (
                      <option key={field.key} value={field.key}>{field.label}</option>
                    ))}
                  </select>

                  <select
                    value={widget.aggregation}
                    onChange={(e) => updateWidget(index, { aggregation: e.target.value as DashboardWidgetConfig['aggregation'] })}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  >
                    {AGGREGATIONS.map((agg) => (
                      <option key={agg.value} value={agg.value}>{agg.label}</option>
                    ))}
                  </select>

                  {widget.chartType === 'combined_trend' && (
                    <select
                      value={widget.secondaryValueField || 'meters'}
                      onChange={(e) => updateWidget(index, { secondaryValueField: e.target.value })}
                      className="px-3 py-2 border border-slate-300 rounded-lg text-sm md:col-span-2"
                    >
                      {numericFieldOptions.map((field) => (
                        <option key={field.key} value={field.key}>{field.label} (Serie 2)</option>
                      ))}
                    </select>
                  )}

                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={widget.limit || 12}
                    onChange={(e) => updateWidget(index, { limit: Number(e.target.value) || 12 })}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    placeholder="Limite de categorias"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="pt-2">
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold disabled:opacity-60"
            >
              <Save className="w-4 h-4" /> {saving ? 'Guardando...' : form.id ? 'Actualizar Dashboard' : 'Crear Dashboard'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardManager;
