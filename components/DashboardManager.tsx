import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2, RefreshCw, Settings2, BarChart3, Info, ArrowUp, ArrowDown } from 'lucide-react';
import { DashboardConfig, DashboardFieldOption, DashboardWidgetConfig, ProductionRecord } from '../types';
import { buildDynamicFieldOptionsFromCatalog, DASHBOARD_ALLOWED_CORE_FIELDS } from '../utils/dashboardFieldPolicy';
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
  widgets: DashboardWidgetConfig[];
  isDefault: boolean;
};

const CHART_TYPES = [
  { value: 'kpi', label: 'KPI (Numero Grande)' },
  { value: 'bar', label: 'Barras' },
  { value: 'bar_horizontal', label: 'Barras Horizontales' },
  { value: 'line', label: 'Linea' },
  { value: 'area', label: 'Area' },
  { value: 'pie', label: 'Torta' },
  { value: 'combined_trend', label: 'Tendencia Combinada' },
] as const;

const CHART_TYPE_VALUES = new Set<string>(CHART_TYPES.map((item) => item.value));

const AGGREGATIONS = [
  { value: 'count', label: 'Conteo' },
  { value: 'sum', label: 'Suma' },
  { value: 'avg', label: 'Promedio' },
] as const;

const makeEmptyDashboard = (): EditableDashboard => ({
  id: null,
  name: '',
  description: '',
  widgets: [
    {
      id: `widget_${Date.now()}`,
      title: 'Produccion por Maquina',
      chartType: 'bar',
      groupBy: 'machine',
      valueField: 'meters',
      aggregation: 'sum',
      spanColumns: 2,
    },
  ],
  isDefault: false,
});

const DashboardManager: React.FC<DashboardManagerProps> = ({ records }) => {
  const [configs, setConfigs] = useState<DashboardConfig[]>([]);
  const [fieldOptions, setFieldOptions] = useState<DashboardFieldOption[]>(DASHBOARD_ALLOWED_CORE_FIELDS);
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

      const dynamicOptions = buildDynamicFieldOptionsFromCatalog(fieldCatalog);
      setFieldOptions([...DASHBOARD_ALLOWED_CORE_FIELDS, ...dynamicOptions]);

      const optionMap = new Map([...DASHBOARD_ALLOWED_CORE_FIELDS, ...dynamicOptions].map((field) => [field.key, field]));
      const numericKeys = new Set(
        [...DASHBOARD_ALLOWED_CORE_FIELDS, ...dynamicOptions]
          .filter((field) => field.type === 'number')
          .map((field) => field.key)
      );

      // Migrar al vuelo configs antiguos
      const sanitizedConfigs = dashboardConfigs.map((config) => ({
        ...config,
        widgets: (config.widgets || []).map((w) => {
          const normalizedSpanColumns = Number((w as any).spanColumns) === 1 ? 1 : 2;

          const rawChartType = String((w as any).chartType || 'bar');
          const chartType = CHART_TYPE_VALUES.has(rawChartType) ? rawChartType : 'bar';

          return {
            ...w,
            chartType,
            groupBy: w.groupBy && optionMap.has(w.groupBy) ? w.groupBy : (config.baseField && optionMap.has(config.baseField) ? config.baseField : 'machine'),
            valueField: optionMap.has(w.valueField)
              ? w.valueField
              : (numericKeys.size > 0 ? Array.from(numericKeys)[0] : 'operator'),
            secondaryValueField:
              w.secondaryValueField && optionMap.has(w.secondaryValueField) ? w.secondaryValueField : undefined,
            aggregation:
              w.aggregation === 'count' || numericKeys.has(w.valueField)
                ? w.aggregation
                : 'count',
            spanColumns: normalizedSpanColumns,
          };
        }),
      }));

      setConfigs(sanitizedConfigs);

      const first = sanitizedConfigs[0];
      if (first) {
        setForm({
          id: first.id,
          name: first.name,
          description: first.description || '',
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
          title: `Nuevo Widget`,
          chartType: 'bar',
          groupBy: 'machine',
          valueField: 'meters',
          aggregation: 'sum',
          spanColumns: 2,
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

  const moveWidget = (fromIndex: number, toIndex: number) => {
    setForm((prev) => {
      if (toIndex < 0 || toIndex >= prev.widgets.length) {
        return prev;
      }

      const reordered = [...prev.widgets];
      const [movedWidget] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, movedWidget);

      return {
        ...prev,
        widgets: reordered,
      };
    });
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError('El nombre del dashboard es obligatorio.');
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
        widgets: form.widgets,
        isDefault: form.isDefault,
      };

      let saved: DashboardConfig;
      if (form.id) {
        saved = await updateDashboardConfig(form.id, payload);
      } else {
        saved = await createDashboardConfig(payload);
      }

      await loadData();
      const updated = saved;
      setForm({
        id: updated.id,
        name: updated.name,
        description: updated.description || '',
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
        <p className="font-medium">Cargando gestor de dashboards (V2)...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-20">
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Settings2 className="w-6 h-6 text-blue-600" /> Gestor de Dashboards V2
            </h2>
            <p className="text-sm text-slate-500 mt-1">Configura paneles visuales con metricas combinadas e independientes.</p>
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
                  <p className="text-xs text-slate-500 mt-1">{config.widgets.length} widget(s)</p>
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
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Nombre del Dashboard</label>
            <input
              value={form.name}
              onChange={(e) => updateForm({ name: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              placeholder="Ej: Vista General de Produccion"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Descripcion (Opcional)</label>
            <textarea
              value={form.description}
              onChange={(e) => updateForm({ description: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              rows={2}
              placeholder="Objetivo del panel"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="isDefaultDashboard"
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => updateForm({ isDefault: e.target.checked })}
              className="h-4 w-4 accent-blue-600"
            />
            <label htmlFor="isDefaultDashboard" className="text-sm font-semibold text-slate-700">Mostrar por defecto al entrar</label>
          </div>

          <div className="border border-slate-200 rounded-xl p-3 space-y-4 bg-slate-50">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-bold text-slate-800 flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Widgets del Dashboard</h4>
                <p className="text-xs text-slate-500 mt-1">Agrega graficas o KPIs individuales. Cada uno puede tener su propia dimension.</p>
              </div>
              <button
                type="button"
                onClick={addWidget}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" /> Agregar Widget
              </button>
            </div>

            {form.widgets.map((widget, index) => (
              <div key={widget.id} className="bg-white border border-slate-200 shadow-sm rounded-xl p-4 space-y-3">
                <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                  <p className="text-sm font-bold text-slate-800">Widget {index + 1}</p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveWidget(index, index - 1)}
                      disabled={index === 0}
                      className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Mover arriba"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveWidget(index, index + 1)}
                      disabled={index === form.widgets.length - 1}
                      className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Mover abajo"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeWidget(index)}
                      className="text-xs font-semibold text-red-600 hover:text-red-800 flex items-center gap-1 ml-1"
                    >
                      <Trash2 className="w-3 h-3" /> Eliminar
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Titulo</label>
                    <input
                      value={widget.title}
                      onChange={(e) => updateWidget(index, { title: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      placeholder="Titulo del widget"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Tipo de Grafico</label>
                    <select
                      value={widget.chartType}
                      onChange={(e) => updateWidget(index, { chartType: e.target.value as DashboardWidgetConfig['chartType'] })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium text-blue-700 bg-blue-50"
                    >
                      {CHART_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>{type.label}</option>
                      ))}
                    </select>
                  </div>

                  {widget.chartType !== 'kpi' && (
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">
                        Dimension (Eje X / Agrupar por)
                      </label>
                      <select
                        value={widget.groupBy || 'machine'}
                        onChange={(e) => updateWidget(index, { groupBy: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      >
                        {fieldOptions.map((field) => (
                          <option key={field.key} value={field.key}>{field.label}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Metrica a Calcular (Valor)</label>
                    <select
                      value={widget.valueField}
                      onChange={(e) => updateWidget(index, { valueField: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    >
                      {(widget.aggregation === 'count' ? fieldOptions : numericFieldOptions).length === 0 ? (
                        <option value="operator">Sin campos numéricos disponibles</option>
                      ) : (
                        (widget.aggregation === 'count' ? fieldOptions : numericFieldOptions).map((field) => (
                          <option key={field.key} value={field.key}>{field.label}</option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Operacion</label>
                    <select
                      value={widget.aggregation}
                      onChange={(e) => updateWidget(index, {
                        aggregation: e.target.value as DashboardWidgetConfig['aggregation'],
                        valueField:
                          e.target.value === 'count'
                            ? widget.valueField
                            : (numericFieldOptions[0]?.key || widget.valueField),
                      })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    >
                      {AGGREGATIONS.filter((agg) => agg.value === 'count' || numericFieldOptions.length > 0).map((agg) => (
                        <option key={agg.value} value={agg.value}>{agg.label}</option>
                      ))}
                    </select>
                  </div>

                  {widget.chartType === 'combined_trend' && (
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-slate-500 mb-1">Metrica Secundaria (Linea superpuesta)</label>
                      <select
                        value={widget.secondaryValueField || (numericFieldOptions[0]?.key || '')}
                        onChange={(e) => updateWidget(index, { secondaryValueField: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      >
                        {numericFieldOptions.length === 0 ? (
                          <option value="">Sin campos numéricos disponibles</option>
                        ) : (
                          numericFieldOptions.map((field) => (
                            <option key={field.key} value={field.key}>{field.label} (Serie 2)</option>
                          ))
                        )}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Ancho del widget en panel</label>
                    <select
                      value={widget.spanColumns === 1 ? '1' : '2'}
                      onChange={(e) => updateWidget(index, { spanColumns: e.target.value === '1' ? 1 : 2 })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    >
                      <option value="1">1 columna</option>
                      <option value="2">2 columnas</option>
                    </select>
                  </div>

                </div>
              </div>
            ))}
            {form.widgets.length === 0 && (
              <div className="text-center py-6 text-slate-500 text-sm flex flex-col items-center">
                <Info className="w-8 h-8 text-slate-300 mb-2" />
                Agrega widgets para empezar a visualizar datos.
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-md disabled:opacity-60 transition-all"
            >
              <Save className="w-5 h-5" /> {saving ? 'Guardando...' : form.id ? 'Guardar Cambios' : 'Crear Dashboard'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardManager;
