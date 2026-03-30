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
  LabelList,
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
import {
  buildDynamicFieldOptionsFromCatalog,
  DASHBOARD_ALLOWED_CORE_FIELDS,
  getDynamicFieldValueByKey,
} from '../utils/dashboardFieldPolicy';

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

const CHART_LABELS: Record<string, string> = {
  kpi: 'Tarjeta KPI',
  bar: 'Barras',
  bar_horizontal: 'Barras Horizontales',
  line: 'Linea',
  area: 'Area',
  pie: 'Torta',
  combined_trend: 'Tendencia Combinada',
  segment_compare: 'Comparativo Operativo (2D)',
};

const AGGREGATION_LABELS: Record<string, string> = {
  count: 'Conteo',
  sum: 'Suma',
  avg: 'Promedio',
};

const COLORS = ['#0ea5e9', '#16a34a', '#f97316', '#ef4444', '#a855f7', '#f43f5e', '#14b8a6', '#6366f1'];

const RADIAN = Math.PI / 180;

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

const toNumeric = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const metricLabel = (valueField: string, fieldMap: Record<string, DashboardFieldOption>) => {
  return fieldMap[valueField]?.label || valueField;
};

const getWidgetSpanClass = (widget: DashboardWidgetConfig) => {
  return widget.spanColumns === 1
    ? 'col-span-1'
    : 'col-span-1 md:col-span-2';
};

const renderPieExternalLabel = ({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  value,
  name,
  fill,
}: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  innerRadius?: number;
  outerRadius?: number;
  value?: number;
  name?: string;
  fill?: string;
}) => {
  if (
    typeof cx !== 'number' ||
    typeof cy !== 'number' ||
    typeof midAngle !== 'number' ||
    typeof innerRadius !== 'number' ||
    typeof outerRadius !== 'number' ||
    typeof value !== 'number'
  ) {
    return null;
  }

  const startRadius = outerRadius + 4;
  const middleRadius = outerRadius + 16;
  const startX = cx + startRadius * Math.cos(-midAngle * RADIAN);
  const startY = cy + startRadius * Math.sin(-midAngle * RADIAN);
  const midX = cx + middleRadius * Math.cos(-midAngle * RADIAN);
  const midY = cy + middleRadius * Math.sin(-midAngle * RADIAN);
  const endX = midX + (midX > cx ? 12 : -12);
  const anchor = endX > cx ? 'start' : 'end';
  const strokeColor = fill || '#334155';
  const labelText = `${String(name || '')}: ${Number(value).toLocaleString()}`;

  return (
    <g>
      <polyline
        points={`${startX},${startY} ${midX},${midY} ${endX},${midY}`}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.5}
      />
      <text
        x={endX + (anchor === 'start' ? 4 : -4)}
        y={midY}
        fill={strokeColor}
        textAnchor={anchor}
        dominantBaseline="central"
        fontSize={11}
        fontWeight={700}
      >
        {labelText}
      </text>
    </g>
  );
};

const buildGroupedData = (
  records: ProductionRecord[],
  baseField: string,
  valueField: string,
  aggregation: DashboardWidgetConfig['aggregation']
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

const buildSegmentCompareData = (
  records: ProductionRecord[],
  baseField: string,
  selectedGroupValues: string[],
  comparisonField: string,
  selectedComparisonValues: string[],
  valueField: string,
  aggregation: DashboardWidgetConfig['aggregation']
) => {
  const groups = new Map<string, { label: string; totals: Record<string, GroupAccumulator> }>();
  let globalSum = 0;
  let globalCount = 0;
  const explicitSegments = selectedComparisonValues
    .map((value) => String(value || '').trim())
    .filter((value) => value.length > 0);

  records.forEach((record) => {
    const groupKey = toDisplayString(getRecordFieldValue(record, baseField));
    const segmentKey = toDisplayString(getRecordFieldValue(record, comparisonField));

    if (selectedGroupValues.length > 0 && !selectedGroupValues.includes(groupKey)) {
      return;
    }

    if (explicitSegments.length > 0 && !explicitSegments.includes(segmentKey)) {
      return;
    }

    const current = groups.get(groupKey) || { label: groupKey, totals: {} };
    const segment = current.totals[segmentKey] || { label: segmentKey, sum: 0, count: 0 };

    if (aggregation === 'count') {
      segment.sum += 1;
      segment.count += 1;
      globalSum += 1;
      globalCount += 1;
    } else {
      const numeric = toNumeric(getRecordFieldValue(record, valueField));
      segment.sum += numeric;
      segment.count += 1;
      globalSum += numeric;
      globalCount += 1;
    }

    current.totals[segmentKey] = segment;
    groups.set(groupKey, current);
  });

  const inferredSegments = Array.from(
    new Set(Array.from(groups.values()).flatMap((group) => Object.keys(group.totals)))
  ).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

  const segments = explicitSegments.length > 0 ? explicitSegments : inferredSegments.slice(0, 6);

  let rows = Array.from(groups.values()).map((group) => {
    const row: Record<string, string | number> = { label: group.label, total: 0 };
    let rowSum = 0;
    let rowCount = 0;

    segments.forEach((segment) => {
      const bucket = group.totals[segment];
      const value = !bucket
        ? 0
        : aggregation === 'avg'
          ? (bucket.count > 0 ? bucket.sum / bucket.count : 0)
          : bucket.sum;
      row[segment] = value;

      if (bucket) {
        rowSum += bucket.sum;
        rowCount += bucket.count;
      }
    });

    row.total = aggregation === 'avg' ? (rowCount > 0 ? rowSum / rowCount : 0) : rowSum;

    return row;
  });

  if (baseField === 'date') {
    rows = rows.sort((a, b) => String(a.label).localeCompare(String(b.label)));
  } else {
    rows = rows.sort((a, b) => Number(b.total || 0) - Number(a.total || 0));
  }

  const segmentMetrics = segments
    .map((segment) => {
      let sum = 0;
      let count = 0;

      Array.from(groups.values()).forEach((group) => {
        const bucket = group.totals[segment];
        if (!bucket) return;
        sum += bucket.sum;
        count += bucket.count;
      });

      return {
        segment,
        total: aggregation === 'avg' ? (count > 0 ? sum / count : 0) : sum,
      };
    })
    .sort((a, b) => b.total - a.total);

  const grandTotal = aggregation === 'avg' ? (globalCount > 0 ? globalSum / globalCount : 0) : globalSum;

  return { rows, segments, segmentMetrics, grandTotal, recordCount: globalCount };
};

const Dashboard: React.FC<DashboardProps> = ({ records, canManageDashboards = false, onOpenAdmin }) => {
  const [configs, setConfigs] = useState<DashboardConfig[]>([]);
  const [fieldOptions, setFieldOptions] = useState<DashboardFieldOption[]>(DASHBOARD_ALLOWED_CORE_FIELDS);
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

      const dynamicOptions = buildDynamicFieldOptionsFromCatalog(fieldCatalog);
      const options = [...DASHBOARD_ALLOWED_CORE_FIELDS, ...dynamicOptions];
      const optionMap = new Map(options.map((f) => [f.key, f]));
      const numericOptions = options.filter((field) => field.type === 'number');
      const defaultNumericField = numericOptions[0]?.key;

      const normalizedConfigs = dashboardConfigs.map((config) => {
        const safeWidgets = (config.widgets || []).map((widget, index) => {
          const safeValueField = optionMap.has(widget.valueField)
            ? widget.valueField
            : (defaultNumericField || 'operator');
          const secondary = widget.secondaryValueField && optionMap.has(widget.secondaryValueField)
            ? widget.secondaryValueField
            : undefined;
          const safeAggregation = widget.aggregation === 'count' || (safeValueField && optionMap.get(safeValueField)?.type === 'number')
            ? widget.aggregation
            : 'count';
          return {
            ...widget,
            id: widget.id || `widget_${index + 1}`,
            groupBy:
              widget.groupBy && optionMap.has(widget.groupBy)
                ? widget.groupBy
                : (config.baseField && optionMap.has(config.baseField) ? config.baseField : 'machine'),
            comparisonField:
              widget.comparisonField && optionMap.has(widget.comparisonField)
                ? widget.comparisonField
                : undefined,
            comparisonValues: Array.isArray(widget.comparisonValues)
              ? widget.comparisonValues
                  .map((value) => String(value || '').trim())
                  .filter((value) => value.length > 0)
              : undefined,
            valueField: safeValueField,
            secondaryValueField: secondary,
            aggregation: safeAggregation,
            spanColumns: Number((widget as any).spanColumns) === 1 ? 1 : 2,
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

  const orderedWidgets = useMemo(
    () => (selectedConfig ? selectedConfig.widgets || [] : []),
    [selectedConfig]
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

    if (widget.chartType === 'segment_compare') {
      const comparisonField = widget.comparisonField || 'shift';

      const availableComparisonValues = Array.from(
        new Set(filteredRecords.map((record) => toDisplayString(getRecordFieldValue(record, comparisonField))))
      ) as string[];
      availableComparisonValues.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

      const selectedGroupValues: string[] = [];
      const selectedComparisonValues = (widget.comparisonValues || []).filter((value) =>
        availableComparisonValues.includes(value)
      );

      const { rows, segments, segmentMetrics, grandTotal, recordCount } = buildSegmentCompareData(
        filteredRecords,
        groupByField,
        selectedGroupValues,
        comparisonField,
        selectedComparisonValues,
        widget.valueField,
        widget.aggregation
      );

      const bestRow = rows[0];
      const detailRows = rows.slice(0, 8);
      const topSegment = segmentMetrics[0];

      if (segments.length === 0) {
        return (
          <div className="h-72 flex items-center justify-center text-sm text-slate-500">
            Sin segmentos para mostrar con la configuracion actual.
          </div>
        );
      }

      return (
        <div className="space-y-4">
          <div className="bg-gradient-to-r from-slate-50 to-blue-50 border border-slate-200 rounded-xl p-3">
            <p className="text-xs font-black text-slate-800 uppercase tracking-wide mb-1">Comparativo Operativo (2D)</p>
            <p className="text-[11px] text-slate-600">
              Este grafico usa solo los <span className="font-bold">Filtros de Datos</span> de la parte superior.
              {selectedComparisonValues.length > 0
                ? ` Series configuradas: ${selectedComparisonValues.join(', ')}`
                : ' Series: automaticas segun los datos visibles.'}
            </p>
            <div className="mt-2 text-[11px] text-slate-500">
              Eje X: {metricLabel(groupByField, fieldMap)} · Serie: {metricLabel(comparisonField, fieldMap)}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-3">
            <div className="xl:col-span-3 h-[380px] bg-white border border-slate-200 rounded-xl p-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 14, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip formatter={(value) => Number(value).toLocaleString()} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  {segments.map((segment, index) => (
                    <Bar
                      key={segment}
                      dataKey={segment}
                      name={`${metricLabel(comparisonField, fieldMap)}: ${segment}`}
                      fill={COLORS[index % COLORS.length]}
                      radius={[4, 4, 0, 0]}
                    >
                      <LabelList
                        dataKey={segment}
                        position="top"
                        formatter={(value: any) => formatNumber(Number(value || 0))}
                        style={{ fill: '#334155', fontSize: 10, fontWeight: 700 }}
                      />
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="xl:col-span-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
              <h5 className="text-sm font-extrabold text-slate-900 mb-2">Resumen de datos</h5>
              <div className="grid grid-cols-1 gap-2 mb-3">
                <div className="bg-white border border-slate-200 rounded-lg p-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 font-bold">
                    {widget.aggregation === 'avg' ? 'Promedio Global' : 'Total Visible'}
                  </p>
                  <p className="text-lg font-black text-slate-800">{formatNumber(grandTotal)}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Registros considerados: {recordCount}</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 font-bold">Mayor {metricLabel(groupByField, fieldMap)}</p>
                  <p className="text-sm font-bold text-slate-800 truncate">{bestRow ? String(bestRow.label) : 'Sin dato'}</p>
                  <p className="text-xs text-slate-500">{bestRow ? formatNumber(Number(bestRow.total || 0)) : '0'}</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 font-bold">Serie Principal</p>
                  <p className="text-sm font-bold text-slate-800 truncate">{topSegment ? topSegment.segment : 'Sin dato'}</p>
                  <p className="text-xs text-slate-500">{topSegment ? formatNumber(topSegment.total) : '0'}</p>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                <div className="grid grid-cols-12 gap-2 bg-slate-100 px-2 py-1.5 text-[11px] font-bold text-slate-700">
                  <span className="col-span-7">{metricLabel(groupByField, fieldMap)}</span>
                  <span className="col-span-5 text-right">Total</span>
                </div>
                <div className="max-h-[180px] overflow-auto">
                  {detailRows.map((row) => (
                    <div key={String(row.label)} className="grid grid-cols-12 gap-2 px-2 py-1.5 text-xs border-t border-slate-100">
                      <span className="col-span-7 text-slate-800 truncate">{String(row.label)}</span>
                      <span className="col-span-5 text-right font-semibold text-slate-900">{formatNumber(Number(row.total || 0))}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    const data = buildGroupedData(
      filteredRecords,
      groupByField,
      widget.valueField,
      widget.aggregation
    );

    if (widget.chartType === 'pie') {
      return (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                innerRadius={58}
                outerRadius={98}
                paddingAngle={3}
                label={renderPieExternalLabel}
                labelLine={false}
              >
                {data.map((entry, index) => (
                  <Cell key={`${entry.label}-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: any, name: string) => [
                  Number(value).toLocaleString(),
                  name === 'value' ? metricLabel(widget.valueField, fieldMap) : name,
                ]}
              />
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
              <Tooltip
                formatter={(value: any, name: string) => [
                  Number(value).toLocaleString(),
                  name === 'value' ? metricLabel(widget.valueField, fieldMap) : name,
                ]}
              />
              <Line
                type="monotone"
                dataKey="value"
                name={metricLabel(widget.valueField, fieldMap)}
                stroke="#0ea5e9"
                strokeWidth={2.5}
                dot={{ r: 3 }}
              />
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
              <Tooltip
                formatter={(value: any, name: string) => [
                  Number(value).toLocaleString(),
                  name === 'value' ? metricLabel(widget.valueField, fieldMap) : name,
                ]}
              />
              <Area
                type="monotone"
                dataKey="value"
                name={metricLabel(widget.valueField, fieldMap)}
                stroke="#16a34a"
                fill={`url(#gradient-${widget.id})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      );
    }

    if (widget.chartType === 'bar_horizontal') {
      const rowHeight = 34;
      const headerAndPadding = 44;
      const chartHeight = Math.max(280, data.length * rowHeight + headerAndPadding);
      const maxLabelLength = data.reduce((max, entry) => Math.max(max, String(entry.label || '').length), 0);
      const yAxisWidth = Math.min(320, Math.max(120, maxLabelLength * 7 + 20));

      return (
        <div style={{ height: `${chartHeight}px` }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 8 }} barSize={20}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis
                type="category"
                dataKey="label"
                width={yAxisWidth}
                interval={0}
                tick={{ fontSize: 11, fill: '#64748b' }}
              />
              <Tooltip
                formatter={(value: any, name: string) => [
                  Number(value).toLocaleString(),
                  name === 'value' ? metricLabel(widget.valueField, fieldMap) : name,
                ]}
              />
              <Bar
                dataKey="value"
                name={metricLabel(widget.valueField, fieldMap)}
                fill="#0ea5e9"
                radius={[0, 6, 6, 0]}
              >
                <LabelList
                  dataKey="value"
                  position="right"
                  formatter={(value: any) => formatNumber(Number(value || 0))}
                  style={{ fill: '#0f172a', fontSize: 10, fontWeight: 700 }}
                />
              </Bar>
            </BarChart>
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
            <Tooltip
              formatter={(value: any, name: string) => [
                Number(value).toLocaleString(),
                name === 'value' ? metricLabel(widget.valueField, fieldMap) : name,
              ]}
            />
            <Bar
              dataKey="value"
              name={metricLabel(widget.valueField, fieldMap)}
              fill="#0ea5e9"
              radius={[6, 6, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  } 

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

      {/* Global Data Filters */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <div className="flex items-center gap-2 text-slate-700 font-bold mb-3 text-sm">
          <Filter className="w-4 h-4" /> Filtros de Datos
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 grid-flow-row-dense">
        {orderedWidgets.map((widget) => (
          <div
            key={widget.id}
            className={`bg-white border border-slate-200 rounded-2xl p-5 min-w-0 ${getWidgetSpanClass(widget)}`}
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
        {orderedWidgets.length === 0 && (
          <div className="col-span-full py-10 text-center text-slate-500">
            Este dashboard no tiene widgets configurados.
          </div>
        )}
      </div>

    </div>
  );
};

export default Dashboard;
