import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
} from 'recharts';
import {
  LayoutDashboard,
  Settings2,
  Layers,
  Activity,
  AlertTriangle,
  RefreshCw,
  Table,
  Filter,
} from 'lucide-react';
import { DashboardConfig, DashboardFieldOption, DashboardWidgetConfig, ProductionRecord } from '../types';
import { exportToExcel, getDashboardConfigs, getFieldCatalog } from '../services/storageService';

interface DashboardProps {
  records: ProductionRecord[];
  canManageDashboards?: boolean;
  onOpenAdmin?: () => void;
}

type GroupAccumulator = {
  label: string;
  sum: number;
  count: number;
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

const CHART_LABELS: Record<string, string> = {
  bar: 'Barras',
  line: 'Linea',
  area: 'Area',
  pie: 'Torta',
  combined_trend: 'Tendencia Combinada',
};

const AGGREGATION_LABELS: Record<string, string> = {
  count: 'Conteo',
  sum: 'Suma',
  avg: 'Promedio',
};

const COLORS = ['#0ea5e9', '#16a34a', '#f97316', '#ef4444', '#a855f7', '#f43f5e', '#14b8a6', '#6366f1'];

const normalizeDynamicKey = (field: string) => (field.startsWith('dynamic.') ? field.slice(8) : field);

const getRecordFieldValue = (record: ProductionRecord, field: string): unknown => {
  if (field.startsWith('dynamic.')) {
    const dynamicKey = normalizeDynamicKey(field);
    return record.dynamicFieldsValues?.[dynamicKey];
  }

  return (record as any)[field];
};

const toDisplayString = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return 'Sin dato';
  if (Array.isArray(value)) return value.join(', ') || 'Sin dato';
  return String(value);
};

const toNumeric = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const metricLabel = (valueField: string, fieldMap: Record<string, DashboardFieldOption>) => {
  return fieldMap[valueField]?.label || valueField;
};

const buildGroupedData = (
  records: ProductionRecord[],
  baseField: string,
  valueField: string,
  aggregation: DashboardWidgetConfig['aggregation'],
  limit?: number
) => {
  const groups = new Map<string, GroupAccumulator>();

  records.forEach((record) => {
    const key = toDisplayString(getRecordFieldValue(record, baseField));
    const current = groups.get(key) || { label: key, sum: 0, count: 0 };

    if (aggregation === 'count') {
      current.sum += 1;
      current.count += 1;
    } else {
      current.sum += toNumeric(getRecordFieldValue(record, valueField));
      current.count += 1;
    }

    groups.set(key, current);
  });

  let rows = Array.from(groups.values()).map((entry) => ({
    label: entry.label,
    value: aggregation === 'avg' ? (entry.count > 0 ? entry.sum / entry.count : 0) : entry.sum,
  }));

  if (baseField === 'date') {
    rows = rows.sort((a, b) => a.label.localeCompare(b.label));
  } else {
    rows = rows.sort((a, b) => b.value - a.value);
  }

  if (limit && limit > 0) {
    rows = rows.slice(0, limit);
  }

  return rows;
};

const buildCombinedTrendData = (
  records: ProductionRecord[],
  primaryField: string,
  secondaryField: string,
  aggregation: DashboardWidgetConfig['aggregation']
) => {
  const groups = new Map<string, { primary: GroupAccumulator; secondary: GroupAccumulator }>();

  records.forEach((record) => {
    const dateKey = toDisplayString(getRecordFieldValue(record, 'date'));
    const current = groups.get(dateKey) || {
      primary: { label: dateKey, sum: 0, count: 0 },
      secondary: { label: dateKey, sum: 0, count: 0 },
    };

    if (aggregation === 'count') {
      current.primary.sum += 1;
      current.secondary.sum += 1;
      current.primary.count += 1;
      current.secondary.count += 1;
    } else {
      current.primary.sum += toNumeric(getRecordFieldValue(record, primaryField));
      current.secondary.sum += toNumeric(getRecordFieldValue(record, secondaryField));
      current.primary.count += 1;
      current.secondary.count += 1;
    }

    groups.set(dateKey, current);
  });

  return Array.from(groups.entries())
    .map(([date, values]) => ({
      date,
      primary:
        aggregation === 'avg' ? (values.primary.count > 0 ? values.primary.sum / values.primary.count : 0) : values.primary.sum,
      secondary:
        aggregation === 'avg'
          ? values.secondary.count > 0
            ? values.secondary.sum / values.secondary.count
            : 0
          : values.secondary.sum,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
};

const Dashboard: React.FC<DashboardProps> = ({ records, canManageDashboards = false, onOpenAdmin }) => {
  const [configs, setConfigs] = useState<DashboardConfig[]>([]);
  const [fieldOptions, setFieldOptions] = useState<DashboardFieldOption[]>(CORE_FIELDS);
  const [selectedConfigId, setSelectedConfigId] = useState('');
  const [selectedBaseField, setSelectedBaseField] = useState('');
  const [selectedRelatedFields, setSelectedRelatedFields] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDashboardData = async () => {
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

      const options = [...CORE_FIELDS, ...mergedDynamic];
      const optionMap = new Map(options.map((f) => [f.key, f]));

      const normalizedConfigs = dashboardConfigs.map((config) => {
        const safeBaseField = optionMap.has(config.baseField) ? config.baseField : 'machine';
        const safeRelated = (config.relatedFields || []).filter((field) => optionMap.has(field) && field !== safeBaseField);
        const safeWidgets = (config.widgets || []).map((widget, index) => {
          const safeValueField = optionMap.has(widget.valueField) ? widget.valueField : 'meters';
          const secondary = widget.secondaryValueField && optionMap.has(widget.secondaryValueField)
            ? widget.secondaryValueField
            : undefined;
          return {
            ...widget,
            id: widget.id || `widget_${index + 1}`,
            valueField: safeValueField,
            secondaryValueField: secondary,
          };
        });

        return {
          ...config,
          baseField: safeBaseField,
          relatedFields: safeRelated,
          widgets: safeWidgets,
        };
      });

      setConfigs(normalizedConfigs);
      setFieldOptions(options);

      const defaultConfig = normalizedConfigs.find((config) => config.isDefault) || normalizedConfigs[0];
      if (defaultConfig) {
        setSelectedConfigId(defaultConfig.id);
        setSelectedBaseField(defaultConfig.baseField);
        setSelectedRelatedFields(defaultConfig.relatedFields || []);
      } else {
        setSelectedConfigId('');
        setSelectedBaseField('machine');
        setSelectedRelatedFields([]);
      }
    } catch (err: any) {
      setError(err?.message || 'No se pudieron cargar los dashboards dinámicos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records.length]);

  const allFieldOptions = useMemo<DashboardFieldOption[]>(() => {
    return fieldOptions;
  }, [fieldOptions]);

  const fieldMap = useMemo<Record<string, DashboardFieldOption>>(() => {
    const map: Record<string, DashboardFieldOption> = {};
    allFieldOptions.forEach((field) => {
      map[field.key] = field;
    });
    return map;
  }, [allFieldOptions]);

  const selectedConfig = useMemo(
    () => configs.find((config) => config.id === selectedConfigId) || null,
    [configs, selectedConfigId]
  );

  const activeBaseField = selectedBaseField || 'machine';
  const activeRelatedFields = selectedRelatedFields;

  const dimensionPreview = useMemo(() => {
    return buildGroupedData(records, activeBaseField, 'meters', 'count', 15);
  }, [records, activeBaseField]);

  const relatedPreviewRows = useMemo(() => {
    const grouped = new Map<string, Record<string, string>>();

    records.forEach((record) => {
      const baseKey = toDisplayString(getRecordFieldValue(record, activeBaseField));
      const current = grouped.get(baseKey) || { dimension: baseKey };

      activeRelatedFields.forEach((field) => {
        current[field] = toDisplayString(getRecordFieldValue(record, field));
      });

      grouped.set(baseKey, current);
    });

    return Array.from(grouped.values()).slice(0, 15);
  }, [records, activeBaseField, activeRelatedFields]);

  const handleConfigSelection = (nextId: string) => {
    setSelectedConfigId(nextId);
    const next = configs.find((config) => config.id === nextId);
    if (!next) return;
    setSelectedBaseField(next.baseField);
    setSelectedRelatedFields(next.relatedFields || []);
  };

  const renderWidget = (widget: DashboardWidgetConfig) => {
    if (widget.chartType === 'combined_trend') {
      const secondaryField = widget.secondaryValueField || widget.valueField;
      const data = buildCombinedTrendData(records, widget.valueField, secondaryField, widget.aggregation);

      return (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="primary" name={metricLabel(widget.valueField, fieldMap)} fill="#0ea5e9" radius={[6, 6, 0, 0]} />
              <Line
                type="monotone"
                dataKey="secondary"
                name={metricLabel(secondaryField, fieldMap)}
                stroke="#f97316"
                strokeWidth={2.5}
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      );
    }

    const data = buildGroupedData(records, activeBaseField, widget.valueField, widget.aggregation, widget.limit);

    if (widget.chartType === 'pie') {
      return (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="label" innerRadius={58} outerRadius={98} paddingAngle={3}>
                {data.map((entry, index) => (
                  <Cell key={`${entry.label}-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => Number(value).toLocaleString()} />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      );
    }

    if (widget.chartType === 'line') {
      return (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
              <Tooltip formatter={(value) => Number(value).toLocaleString()} />
              <Line type="monotone" dataKey="value" stroke="#0ea5e9" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      );
    }

    if (widget.chartType === 'area') {
      return (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
              <defs>
                <linearGradient id={`gradient-${widget.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#16a34a" stopOpacity={0.7} />
                  <stop offset="95%" stopColor="#16a34a" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
              <Tooltip formatter={(value) => Number(value).toLocaleString()} />
              <Area type="monotone" dataKey="value" stroke="#16a34a" fill={`url(#gradient-${widget.id})`} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      );
    }

    return (
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
            <Tooltip formatter={(value) => Number(value).toLocaleString()} />
            <Bar dataKey="value" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 flex flex-col items-center gap-3 text-slate-600">
        <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
        <p className="font-medium">Cargando dashboards dinamicos...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-700 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 mt-0.5" />
        <div>
          <p className="font-bold">No se pudo cargar el dashboard</p>
          <p className="text-sm">{error}</p>
          <button
            onClick={() => void loadDashboardData()}
            className="mt-3 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (!selectedConfig) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
        <LayoutDashboard className="w-8 h-8 mx-auto text-slate-400 mb-3" />
        <h3 className="text-lg font-bold text-slate-800">Aun no hay dashboards configurados</h3>
        <p className="text-sm text-slate-500 mt-1">Crea un panel desde administracion para habilitar visualizaciones dinamicas.</p>
        {canManageDashboards && onOpenAdmin && (
          <button
            onClick={onOpenAdmin}
            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold"
          >
            Ir al gestor de dashboards
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-20">
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Dashboard Dinamico</h2>
            <p className="text-sm text-slate-500 mt-1">Selecciona panel, campo base y campos relacionados para construir reportes personalizados.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => exportToExcel(records)}
              className="inline-flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold"
            >
              <Table className="w-4 h-4" /> Excel
            </button>
            <button
              onClick={() => void loadDashboardData()}
              className="inline-flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-semibold"
            >
              <RefreshCw className="w-4 h-4" /> Recargar
            </button>
            {canManageDashboards && onOpenAdmin && (
              <button
                onClick={onOpenAdmin}
                className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold"
              >
                <Settings2 className="w-4 h-4" /> Administrar
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <div className="flex items-center gap-2 text-slate-700 font-bold mb-4">
          <Filter className="w-4 h-4" /> Constructor de Vista
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Panel Configurado</label>
            <select
              value={selectedConfigId}
              onChange={(e) => handleConfigSelection(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            >
              {configs.map((config) => (
                <option key={config.id} value={config.id}>
                  {config.name}{config.isDefault ? ' (Default)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Campo Base (Dimension)</label>
            <select
              value={activeBaseField}
              onChange={(e) => {
                setSelectedBaseField(e.target.value);
                setSelectedRelatedFields((prev) => prev.filter((field) => field !== e.target.value));
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            >
              {allFieldOptions.map((field) => (
                <option key={field.key} value={field.key}>{field.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Campos Adicionales (Relacion)</label>
            <select
              multiple
              value={activeRelatedFields}
              onChange={(e) => {
                const values = Array.from(e.target.selectedOptions)
                  .map((option) => (option as HTMLOptionElement).value)
                  .filter((field) => field !== activeBaseField);
                setSelectedRelatedFields(values);
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm min-h-[96px]"
            >
              {allFieldOptions
                .filter((field) => field.key !== activeBaseField)
                .map((field) => (
                  <option key={field.key} value={field.key}>{field.label}</option>
                ))}
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Registros Analizados</p>
          <p className="text-3xl font-black text-slate-900">{records.length.toLocaleString()}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Dimension Activa</p>
          <p className="text-xl font-bold text-slate-900">{fieldMap[activeBaseField]?.label || activeBaseField}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Campos Relacionados</p>
          <p className="text-xl font-bold text-slate-900">{activeRelatedFields.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {selectedConfig.widgets.map((widget) => (
          <div key={widget.id} className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="mb-3">
              <h4 className="font-bold text-slate-900">{widget.title}</h4>
              <p className="text-xs text-slate-500 mt-1">
                {CHART_LABELS[widget.chartType]} · {AGGREGATION_LABELS[widget.aggregation]} de {metricLabel(widget.valueField, fieldMap)}
              </p>
            </div>
            {renderWidget(widget)}
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <h4 className="font-bold text-slate-900 mb-3">Resumen por Campo Base</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2 pr-3">Dimension</th>
                <th className="py-2 pr-3">Registros</th>
              </tr>
            </thead>
            <tbody>
              {dimensionPreview.map((row) => (
                <tr key={row.label} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-medium text-slate-700">{row.label}</td>
                  <td className="py-2 pr-3 text-slate-600">{row.value.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {activeRelatedFields.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h4 className="font-bold text-slate-900 mb-3">Relacion entre Campo Base y Campos Adicionales</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pr-3">{fieldMap[activeBaseField]?.label || activeBaseField}</th>
                  {activeRelatedFields.map((field) => (
                    <th key={field} className="py-2 pr-3">{fieldMap[field]?.label || field}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {relatedPreviewRows.map((row, index) => (
                  <tr key={`${(row as any).dimension}-${index}`} className="border-b border-slate-100">
                    <td className="py-2 pr-3 font-medium text-slate-700">{(row as any).dimension}</td>
                    {activeRelatedFields.map((field) => (
                      <td key={field} className="py-2 pr-3 text-slate-600">{(row as any)[field] || 'Sin dato'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="text-xs text-slate-500 px-1">
        Tip: para guardar cambios permanentes de visualizacion, usa el boton Administrar y actualiza la configuracion del panel.
      </div>
    </div>
  );
};

export default Dashboard;
