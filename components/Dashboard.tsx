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
  RefreshCw,
  Table,
  Filter,
  AlertTriangle,
} from 'lucide-react';
import { DashboardConfig, DashboardFieldOption, DashboardWidgetConfig, ProductionRecord, MachineType, ShiftType } from '../types';
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
  kpi: 'Tarjeta KPI',
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
  baseField: string,
  primaryField: string,
  secondaryField: string,
  aggregation: DashboardWidgetConfig['aggregation']
) => {
  const groups = new Map<string, { primary: GroupAccumulator; secondary: GroupAccumulator }>();

  records.forEach((record) => {
    const key = toDisplayString(getRecordFieldValue(record, baseField));
    const current = groups.get(key) || {
      primary: { label: key, sum: 0, count: 0 },
      secondary: { label: key, sum: 0, count: 0 },
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

    groups.set(key, current);
  });

  return Array.from(groups.entries())
    .map(([label, values]) => ({
      label,
      primary:
        aggregation === 'avg' ? (values.primary.count > 0 ? values.primary.sum / values.primary.count : 0) : values.primary.sum,
      secondary:
        aggregation === 'avg'
          ? values.secondary.count > 0
            ? values.secondary.sum / values.secondary.count
            : 0
          : values.secondary.sum,
    }))
    .sort((a, b) => a.label.localeCompare(b.label)); // Default sort by label (useful if date)
};

const buildKpiData = (
  records: ProductionRecord[],
  valueField: string,
  aggregation: DashboardWidgetConfig['aggregation']
): number => {
  if (records.length === 0) return 0;
  if (aggregation === 'count') return records.length;

  const totalSum = records.reduce((acc, record) => acc + toNumeric(getRecordFieldValue(record, valueField)), 0);
  if (aggregation === 'avg') {
    return totalSum / records.length;
  }
  return totalSum;
};

const Dashboard: React.FC<DashboardProps> = ({ records, canManageDashboards = false, onOpenAdmin }) => {
  const [configs, setConfigs] = useState<DashboardConfig[]>([]);
  const [fieldOptions, setFieldOptions] = useState<DashboardFieldOption[]>(CORE_FIELDS);
  const [selectedConfigId, setSelectedConfigId] = useState('');
  
  // Global Filters
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [filterMachine, setFilterMachine] = useState('');
  const [filterShift, setFilterShift] = useState('');

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
        const safeWidgets = (config.widgets || []).map((widget, index) => {
          const safeValueField = optionMap.has(widget.valueField) ? widget.valueField : 'meters';
          const secondary = widget.secondaryValueField && optionMap.has(widget.secondaryValueField)
            ? widget.secondaryValueField
            : undefined;
          return {
            ...widget,
            id: widget.id || `widget_${index + 1}`,
            groupBy: widget.groupBy || config.baseField || 'machine', // fallback for old configs
            valueField: safeValueField,
            secondaryValueField: secondary,
          };
        });

        return {
          ...config,
          widgets: safeWidgets,
        };
      });

      setConfigs(normalizedConfigs);
      setFieldOptions(options);

      const defaultConfig = normalizedConfigs.find((config) => config.isDefault) || normalizedConfigs[0];
      if (defaultConfig) {
        setSelectedConfigId(defaultConfig.id);
      } else {
        setSelectedConfigId('');
      }
    } catch (err: any) {
      setError(err?.message || 'No se pudieron cargar los dashboards dinamicos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records.length]); // Reload structure if new dynamic fields appear in records

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      let keep = true;
      if (startDate && r.date < startDate) keep = false;
      if (endDate && r.date > endDate) keep = false;
      if (filterMachine && r.machine !== filterMachine) keep = false;
      if (filterShift && r.shift !== filterShift) keep = false;
      return keep;
    });
  }, [records, startDate, endDate, filterMachine, filterShift]);

  const fieldMap = useMemo<Record<string, DashboardFieldOption>>(() => {
    const map: Record<string, DashboardFieldOption> = {};
    fieldOptions.forEach((field) => {
      map[field.key] = field;
    });
    return map;
  }, [fieldOptions]);

  const selectedConfig = useMemo(
    () => configs.find((config) => config.id === selectedConfigId) || null,
    [configs, selectedConfigId]
  );

  const formatNumber = (val: number) => {
    if (val >= 1000000) return (val / 1000000).toFixed(2) + 'M';
    if (val >= 1000) return (val / 1000).toFixed(2) + 'K';
    return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  const renderWidget = (widget: DashboardWidgetConfig) => {
    const groupByField = widget.groupBy || 'machine';

    if (widget.chartType === 'kpi') {
      const val = buildKpiData(filteredRecords, widget.valueField, widget.aggregation);
      return (
        <div className="flex flex-col items-center justify-center h-40">
          <p className="text-[3rem] font-black text-slate-800 leading-none tracking-tight">
            {formatNumber(val)}
          </p>
          <p className="text-sm font-medium text-slate-500 mt-2 uppercase tracking-wide">
            {AGGREGATION_LABELS[widget.aggregation]} de {metricLabel(widget.valueField, fieldMap)}
          </p>
        </div>
      );
    }

    if (widget.chartType === 'combined_trend') {
      const secondaryField = widget.secondaryValueField || widget.valueField;
      const data = buildCombinedTrendData(filteredRecords, groupByField, widget.valueField, secondaryField, widget.aggregation);

      return (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
              <Tooltip formatter={(value) => Number(value).toLocaleString()} />
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

    const data = buildGroupedData(filteredRecords, groupByField, widget.valueField, widget.aggregation, widget.limit);

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
        <p className="font-medium">Cargando dashboards V2...</p>
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
        <p className="text-sm text-slate-500 mt-1">Crea un panel desde administracion para habilitar visualizaciones.</p>
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
            <h2 className="text-2xl font-bold text-slate-900">Vista de Dashboards</h2>
            <p className="text-sm text-slate-500 mt-1">Analiza las metricas de produccion en tiempo real a traves de paneles configurables.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedConfigId}
              onChange={(e) => setSelectedConfigId(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-blue-700 bg-blue-50 focus:ring-2 focus:ring-blue-500"
            >
              {configs.map((config) => (
                <option key={config.id} value={config.id}>
                  {config.name}{config.isDefault ? ' (Default)' : ''}
                </option>
              ))}
            </select>

            <button
              onClick={() => exportToExcel(filteredRecords)}
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

      {/* Global Filters Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <div className="flex items-center gap-2 text-slate-700 font-bold mb-3 text-sm">
          <Filter className="w-4 h-4" /> Filtros Globales del Dashboard
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Fecha Inicio</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Fecha Fin</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Maquina</label>
            <select
              value={filterMachine}
              onChange={(e) => setFilterMachine(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
            >
              <option value="">Todas</option>
              {Object.values(MachineType).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Turno</label>
            <select
              value={filterShift}
              onChange={(e) => setFilterShift(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
            >
              <option value="">Todos</option>
              {Object.values(ShiftType).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 text-xs font-medium text-slate-500 text-right">
          Mostrando {filteredRecords.length.toLocaleString()} de {records.length.toLocaleString()} registros totales
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {selectedConfig.widgets.map((widget) => (
          <div
            key={widget.id}
            className={`bg-white border border-slate-200 rounded-2xl p-5 ${
              widget.chartType === 'kpi' ? 'col-span-1' : 'col-span-1 md:col-span-2'
            }`}
          >
            <div className="mb-3">
              <h4 className="font-bold text-slate-900">{widget.title}</h4>
              <p className="text-xs text-slate-500 mt-1">
                {CHART_LABELS[widget.chartType]} 
                {widget.chartType !== 'kpi' && ` · Agrupado por ${metricLabel(widget.groupBy || 'machine', fieldMap)}`}
              </p>
            </div>
            {renderWidget(widget)}
          </div>
        ))}
        {selectedConfig.widgets.length === 0 && (
          <div className="col-span-full py-10 text-center text-slate-500">
            Este dashboard no tiene widgets configurados.
          </div>
        )}
      </div>

    </div>
  );
};

export default Dashboard;
