import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2, RefreshCw, Settings2, BarChart3, Info, ArrowUp, ArrowDown, Filter } from 'lucide-react';
import { DashboardConfig, DashboardFieldOption, DashboardSumRule, DashboardWidgetConfig, ProductionRecord } from '../types';
import {
  buildDynamicFieldOptionsFromCatalog,
  DASHBOARD_ALLOWED_CORE_FIELDS,
  getDynamicFieldValueByKey,
} from '../utils/dashboardFieldPolicy';
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
  rules: DashboardSumRule[];
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
  { value: 'segment_compare', label: 'Comparativo Operativo (2D)' },
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
  rules: [],
  isDefault: false,
});

const getRecordFieldValue = (record: ProductionRecord, field: string): unknown => {
  if (field.startsWith('dynamic.')) {
    return getDynamicFieldValueByKey(record.dynamicFieldsValues, field);
  }

  return (record as any)[field];
};

const toDisplayString = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return 'Sin dato';
  if (Array.isArray(value)) return value.join(', ') || 'Sin dato';
  return String(value);
};

const DashboardManager: React.FC<DashboardManagerProps> = ({ records }) => {
  const [configs, setConfigs] = useState<DashboardConfig[]>([]);
  const [fieldOptions, setFieldOptions] = useState<DashboardFieldOption[]>(DASHBOARD_ALLOWED_CORE_FIELDS);
  const [form, setForm] = useState<EditableDashboard>(makeEmptyDashboard());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeTab, setActiveTab] = useState<'widgets' | 'rules'>('widgets');

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
          const normalizedSpanColumns: DashboardWidgetConfig['spanColumns'] = Number((w as any).spanColumns) === 1 ? 1 : 2;

          const resolvedValueField = optionMap.has(w.valueField)
            ? w.valueField
            : (numericKeys.size > 0 ? Array.from(numericKeys)[0] : 'operator');

          return {
            ...w,
            groupBy: w.groupBy && optionMap.has(w.groupBy) ? w.groupBy : (config.baseField && optionMap.has(config.baseField) ? config.baseField : 'machine'),
            comparisonField:
              w.comparisonField && optionMap.has(w.comparisonField) ? w.comparisonField : undefined,
            comparisonValues: Array.isArray(w.comparisonValues)
              ? w.comparisonValues
                  .map((value) => String(value || '').trim())
                  .filter((value) => value.length > 0)
              : undefined,
            valueField: resolvedValueField,
            secondaryValueField:
              w.secondaryValueField && optionMap.has(w.secondaryValueField) ? w.secondaryValueField : undefined,
            aggregation:
              w.aggregation === 'count' || numericKeys.has(resolvedValueField)
                ? w.aggregation
                : 'count',
            spanColumns: normalizedSpanColumns,
          };
        }),
        rules: (config.rules || []).map((rule) => ({
          ...rule,
          principalField: rule.principalField || rule.sourceFields?.[0] || '',
        })),
      }));

      setConfigs(sanitizedConfigs);

      const first = sanitizedConfigs[0];
      if (first) {
        setForm({
          id: first.id,
          name: first.name,
          description: first.description || '',
          widgets: first.widgets || [],
          rules: first.rules || [],
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
      rules: config.rules || [],
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

  const addRule = () => {
    setForm((prev) => ({
      ...prev,
      rules: [
        ...prev.rules,
        {
          id: `rule_${Date.now()}`,
          name: `Nueva Regla`,
          description: '',
          sourceFields: ['meters'],
          principalField: 'meters',
          aggregation: 'sum',
        },
      ],
    }));
  };

  const removeRule = (index: number) => {
    setForm((prev) => {
      const removedRule = prev.rules[index];
      const widgetsUsingRule = prev.widgets.filter((w) => w.activeRuleId === removedRule?.id);
      const cleanedWidgets = prev.widgets.map((w) =>
        w.activeRuleId === removedRule?.id ? { ...w, activeRuleId: null } : w
      );

      return {
        ...prev,
        rules: prev.rules.filter((_, i) => i !== index),
        widgets: cleanedWidgets,
      };
    });
  };

  const updateRule = (index: number, patch: Partial<DashboardSumRule>) => {
    setForm((prev) => ({
      ...prev,
      rules: prev.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    }));
  };

  const updateRuleSourceFields = (index: number, fields: string[]) => {
    setForm((prev) => ({
      ...prev,
      rules: prev.rules.map((rule, i) => (i === index ? { ...rule, sourceFields: fields } : rule)),
    }));
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
        rules: form.rules,
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
        rules: updated.rules || [],
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

  const comparableFieldOptions = useMemo(
    () => fieldOptions.filter((field) => field.type === 'text' || field.type === 'date'),
    [fieldOptions]
  );

  const uniqueValuesByField = useMemo(() => {
    const map: Record<string, string[]> = {};

    comparableFieldOptions.forEach((field) => {
      const values = new Set<string>();
      records.forEach((record) => {
        values.add(toDisplayString(getRecordFieldValue(record, field.key)));
      });
      map[field.key] = Array.from(values).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    });

    return map;
  }, [comparableFieldOptions, records]);

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

          <div className="flex gap-2 border-b border-slate-200">
            <button
              type="button"
              onClick={() => setActiveTab('widgets')}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === 'widgets'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <BarChart3 className="w-4 h-4 inline mr-1" /> Widgets
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('rules')}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === 'rules'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <Filter className="w-4 h-4 inline mr-1" /> Reglas
              {form.rules.length > 0 && (
                <span className="ml-1 inline-flex items-center justify-center h-5 min-w-[20px] px-1 text-[10px] font-bold rounded-full bg-blue-100 text-blue-700">
                  {form.rules.length}
                </span>
              )}
            </button>
          </div>

          {activeTab === 'widgets' && (
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
                        {widget.chartType === 'segment_compare' ? 'Campo Principal (Ej: Operario)' : 'Dimension (Eje X / Agrupar por)'}
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

                  {widget.chartType === 'segment_compare' && (
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">Campo de Serie (Ej: Turno)</label>
                      <select
                        value={widget.comparisonField || 'shift'}
                        onChange={(e) => updateWidget(index, { comparisonField: e.target.value, comparisonValues: [] })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      >
                        {comparableFieldOptions.map((field) => (
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
                    <label className="block text-xs font-bold text-slate-500 mb-1">Regla Activa (Opcional)</label>
                    <select
                      value={widget.activeRuleId || ''}
                      onChange={(e) => updateWidget(index, { activeRuleId: e.target.value || null })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    >
                      <option value="">Sin regla (usa campo individual)</option>
                      {form.rules.map((rule) => (
                        <option key={rule.id} value={rule.id}>{rule.name}</option>
                      ))}
                    </select>
                    {widget.activeRuleId && (
                      <p className="text-[11px] text-blue-600 mt-1">
                        La regla suma los campos configurados en lugar del campo individual.
                      </p>
                    )}
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

                  {widget.chartType === 'segment_compare' && (
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-slate-500 mb-1">Valores de Serie (1 o varios)</label>
                      <select
                        multiple
                        value={widget.comparisonValues || []}
                        onChange={(e) => {
                          const values = Array.from(
                            e.target.selectedOptions,
                            (option) => (option as HTMLOptionElement).value
                          );
                          updateWidget(index, { comparisonValues: values });
                        }}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm min-h-[120px]"
                      >
                        {(uniqueValuesByField[widget.comparisonField || 'shift'] || []).map((value) => (
                          <option key={value} value={value}>{value}</option>
                        ))}
                      </select>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Tip: para tu caso, elegi Serie = Turno y selecciona Manana para ver operarios y sus metros.
                      </p>
                    </div>
                  )}

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
          )}

          {activeTab === 'rules' && (
          <div className="border border-slate-200 rounded-xl p-3 space-y-4 bg-slate-50">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-bold text-slate-800 flex items-center gap-2"><Filter className="w-4 h-4" /> Reglas de Metricas</h4>
                <p className="text-xs text-slate-500 mt-1">Crea reglas que suman multiples campos en una sola metrica. Luego activa una regla en cualquier widget.</p>
              </div>
              <button
                type="button"
                onClick={addRule}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" /> Agregar Regla
              </button>
            </div>

            {form.rules.map((rule, index) => (
              <div key={rule.id} className="bg-white border border-slate-200 shadow-sm rounded-xl p-4 space-y-3">
                <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                  <p className="text-sm font-bold text-slate-800">Regla {index + 1}</p>
                  <button
                    type="button"
                    onClick={() => removeRule(index)}
                    className="text-xs font-semibold text-red-600 hover:text-red-800 flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" /> Eliminar
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Nombre de la Regla</label>
                    <input
                      value={rule.name}
                      onChange={(e) => updateRule(index, { name: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      placeholder="Ej: Total Metros Combinados"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Descripcion (Opcional)</label>
                    <input
                      value={rule.description || ''}
                      onChange={(e) => updateRule(index, { description: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      placeholder="Que representa esta regla"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-500 mb-1">Campo Principal</label>
                    <select
                      value={rule.principalField || rule.sourceFields[0] || ''}
                      onChange={(e) => updateRule(index, { principalField: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    >
                      {numericFieldOptions.length === 0 ? (
                        <option value="">Sin campos numericos disponibles</option>
                      ) : (
                        numericFieldOptions.map((field) => (
                          <option key={field.key} value={field.key}>{field.label}</option>
                        ))
                      )}
                    </select>
                    <p className="text-[11px] text-slate-500 mt-1">
                      El campo base al que se sumaran los campos adicionales.
                    </p>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-500 mb-1">Campos Adicionales (Suma al principal)</label>
                    <select
                      multiple
                      value={rule.sourceFields.filter((f) => f !== (rule.principalField || rule.sourceFields[0]))}
                      onChange={(e) => {
                        const additionalValues = Array.from(
                          e.target.selectedOptions,
                          (option) => (option as HTMLOptionElement).value
                        );
                        const principal = rule.principalField || rule.sourceFields[0];
                        const allFields = principal ? [principal, ...additionalValues.filter((f) => f !== principal)] : additionalValues;
                        updateRuleSourceFields(index, allFields);
                      }}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm min-h-[120px]"
                    >
                      {numericFieldOptions.map((field) => (
                        <option key={field.key} value={field.key} disabled={field.key === (rule.principalField || rule.sourceFields[0])}>
                          {field.label}{field.key === (rule.principalField || rule.sourceFields[0]) ? ' (campo principal)' : ''}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Estos campos se sumaran al campo principal. El total sera: campo principal + campos adicionales.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Widgets usando esta regla</label>
                    <p className="text-xs text-slate-700">
                      {form.widgets.filter((w) => w.activeRuleId === rule.id).length} widget(s) activo(s)
                    </p>
                  </div>
                </div>
              </div>
            ))}
            {form.rules.length === 0 && (
              <div className="text-center py-6 text-slate-500 text-sm flex flex-col items-center">
                <Filter className="w-8 h-8 text-slate-300 mb-2" />
                Agrega reglas para combinar multiples campos en una sola metrica.
              </div>
            )}
          </div>
          )}

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
