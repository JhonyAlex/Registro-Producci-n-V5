import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  BarChart3,
  Clock3,
  Download,
  Search,
  Share2,
  Sparkles,
} from 'lucide-react';
import { MachineType, ProductionRecord, ShiftType } from '../types';

type Direction = 'up' | 'down' | 'neutral';
type Outcome = 'improved' | 'worsened' | 'neutral';
type SortKey = 'impact' | 'segment' | 'periodA' | 'periodB' | 'diffAbs' | 'diffPct';
type SortDirection = 'asc' | 'desc';
type SegmentKey = 'machine' | 'shift' | 'boss' | 'operator';
type SegmentMetricKey = 'totalMeters' | 'totalChanges' | 'recordCount' | 'avgMeters' | 'avgChanges';

type PeriodStats = {
  recordCount: number;
  totalMeters: number;
  totalChanges: number;
  avgMeters: number;
  avgChanges: number;
};

type IndicatorDefinition = {
  key: SegmentMetricKey;
  label: string;
  description: string;
  higherIsBetter: boolean;
  format: (value: number) => string;
};

type IndicatorRow = {
  key: SegmentMetricKey;
  label: string;
  description: string;
  higherIsBetter: boolean;
  periodA: number;
  periodB: number;
  diffAbs: number;
  diffPct: number | null;
  pctConvention: string;
  direction: Direction;
  outcome: Outcome;
};

type SegmentRow = {
  segment: string;
  periodA: number;
  periodB: number;
  diffAbs: number;
  diffPct: number | null;
  pctConvention: string;
  impact: number;
};

type ComparisonResult = {
  generatedAt: string;
  periodAStats: PeriodStats;
  periodBStats: PeriodStats;
  indicators: IndicatorRow[];
  segmentRows: SegmentRow[];
  warnings: string[];
};

interface ComparativeReportsWidgetProps {
  records: ProductionRecord[];
}

const MIN_RECORDS_FOR_FULL_COMPARISON = 3;

const SEGMENT_OPTIONS: Array<{ key: SegmentKey; label: string }> = [
  { key: 'machine', label: 'Maquina' },
  { key: 'shift', label: 'Turno' },
  { key: 'boss', label: 'Jefe de turno' },
  { key: 'operator', label: 'Operario' },
];

const SEGMENT_METRIC_OPTIONS: Array<{ key: SegmentMetricKey; label: string }> = [
  { key: 'totalMeters', label: 'Metros totales' },
  { key: 'totalChanges', label: 'Cambios totales' },
  { key: 'recordCount', label: 'Registros' },
  { key: 'avgMeters', label: 'Promedio metros/registro' },
  { key: 'avgChanges', label: 'Promedio cambios/registro' },
];

const formatInteger = (value: number) =>
  Number(value).toLocaleString('es-ES', { maximumFractionDigits: 0 });

const formatDecimal = (value: number) =>
  Number(value).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatSigned = (value: number, fractionDigits = 2) => {
  const abs = Math.abs(value).toLocaleString('es-ES', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

  if (value > 0) return `+${abs}`;
  if (value < 0) return `-${abs}`;
  return abs;
};

const formatDateOnly = (isoDate: string) => {
  if (!isoDate) return '-';
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(y, m - 1, d).toLocaleDateString('es-ES');
};

const indicatorDefinitions: IndicatorDefinition[] = [
  {
    key: 'totalMeters',
    label: 'Metros Totales',
    description: 'Produccion total acumulada en el periodo.',
    higherIsBetter: true,
    format: (value) => formatInteger(value),
  },
  {
    key: 'recordCount',
    label: 'Registros',
    description: 'Cantidad de registros cargados.',
    higherIsBetter: true,
    format: (value) => formatInteger(value),
  },
  {
    key: 'avgMeters',
    label: 'Promedio de Metros por Registro',
    description: 'Rendimiento promedio por registro.',
    higherIsBetter: true,
    format: (value) => formatDecimal(value),
  },
  {
    key: 'totalChanges',
    label: 'Cambios Totales',
    description: 'Total de cambios/incidencias reportadas.',
    higherIsBetter: false,
    format: (value) => formatInteger(value),
  },
  {
    key: 'avgChanges',
    label: 'Promedio de Cambios por Registro',
    description: 'Frecuencia media de cambios por registro.',
    higherIsBetter: false,
    format: (value) => formatDecimal(value),
  },
];

const dateToISO = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const safeDateAdd = (isoDate: string, days: number) => {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return '';
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return dateToISO(date);
};

const buildPeriodStats = (periodRecords: ProductionRecord[]): PeriodStats => {
  const recordCount = periodRecords.length;
  const totalMeters = periodRecords.reduce((acc, r) => acc + (Number.isFinite(r.meters) ? r.meters : 0), 0);
  const totalChanges = periodRecords.reduce((acc, r) => acc + (Number.isFinite(r.changesCount) ? r.changesCount : 0), 0);

  return {
    recordCount,
    totalMeters,
    totalChanges,
    avgMeters: recordCount > 0 ? totalMeters / recordCount : 0,
    avgChanges: recordCount > 0 ? totalChanges / recordCount : 0,
  };
};

const pickMetricValue = (stats: PeriodStats, metricKey: SegmentMetricKey): number => {
  return stats[metricKey];
};

const computePct = (base: number, current: number): { pct: number | null; convention: string } => {
  if (base === 0 && current === 0) {
    return { pct: 0, convention: '0% (ambos periodos en cero)' };
  }
  if (base === 0 && current !== 0) {
    return { pct: null, convention: 'N/A (Periodo A = 0; se muestra diferencia absoluta)' };
  }

  const pct = ((current - base) / Math.abs(base)) * 100;
  return { pct, convention: 'Variacion porcentual estandar' };
};

const getDirection = (diffAbs: number): Direction => {
  if (diffAbs > 0) return 'up';
  if (diffAbs < 0) return 'down';
  return 'neutral';
};

const getOutcome = (diffAbs: number, higherIsBetter: boolean): Outcome => {
  if (diffAbs === 0) return 'neutral';
  if (higherIsBetter) {
    return diffAbs > 0 ? 'improved' : 'worsened';
  }
  return diffAbs < 0 ? 'improved' : 'worsened';
};

const outcomeLabel = (outcome: Outcome) => {
  if (outcome === 'improved') return 'Mejoro';
  if (outcome === 'worsened') return 'Empeoro';
  return 'Sin cambios';
};

const isPeriodValid = (start: string, end: string) => Boolean(start && end && start <= end);

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.trim().length > 0;
};

const ComparativeReportsWidget: React.FC<ComparativeReportsWidgetProps> = ({ records }) => {
  const sortedRecordDates = useMemo(() => {
    const dates: string[] = records.map((r) => r.date).filter(isNonEmptyString);
    const set = new Set<string>(dates);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [records]);

  const [periodAStart, setPeriodAStart] = useState('');
  const [periodAEnd, setPeriodAEnd] = useState('');
  const [periodBStart, setPeriodBStart] = useState('');
  const [periodBEnd, setPeriodBEnd] = useState('');
  const [filterMachine, setFilterMachine] = useState('');
  const [filterShift, setFilterShift] = useState('');
  const [filterBoss, setFilterBoss] = useState('');
  const [filterOperator, setFilterOperator] = useState('');
  const [segmentKey, setSegmentKey] = useState<SegmentKey>('machine');
  const [segmentMetric, setSegmentMetric] = useState<SegmentMetricKey>('totalMeters');
  const [searchSegment, setSearchSegment] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('impact');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [validationError, setValidationError] = useState('');
  const [shareMessage, setShareMessage] = useState('');

  useEffect(() => {
    if (sortedRecordDates.length === 0) return;
    if (periodAStart || periodAEnd || periodBStart || periodBEnd) return;

    const lastDate = sortedRecordDates[sortedRecordDates.length - 1];
    const defaultBEnd = lastDate;
    const defaultBStart = safeDateAdd(defaultBEnd, -6);
    const defaultAEnd = safeDateAdd(defaultBStart, -1);
    const defaultAStart = safeDateAdd(defaultAEnd, -6);

    setPeriodBEnd(defaultBEnd);
    setPeriodBStart(defaultBStart);
    setPeriodAEnd(defaultAEnd);
    setPeriodAStart(defaultAStart);
  }, [periodAEnd, periodAStart, periodBEnd, periodBStart, sortedRecordDates]);

  const baseFilteredRecords = useMemo(() => {
    return records.filter((record) => {
      if (filterMachine && record.machine !== filterMachine) return false;
      if (filterShift && record.shift !== filterShift) return false;
      if (filterBoss && record.boss !== filterBoss) return false;
      if (filterOperator && record.operator !== filterOperator) return false;
      return true;
    });
  }, [records, filterBoss, filterMachine, filterOperator, filterShift]);

  const uniqueBosses = useMemo(() => {
    const bossesValues: string[] = baseFilteredRecords.map((r) => r.boss).filter(isNonEmptyString);
    const bosses = new Set<string>(bossesValues);
    return Array.from(bosses).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }, [baseFilteredRecords]);

  const uniqueOperators = useMemo(() => {
    const operatorsValues: string[] = baseFilteredRecords.map((r) => r.operator).filter(isNonEmptyString);
    const operators = new Set<string>(operatorsValues);
    return Array.from(operators).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }, [baseFilteredRecords]);

  const periodAValid = isPeriodValid(periodAStart, periodAEnd);
  const periodBValid = isPeriodValid(periodBStart, periodBEnd);
  const canRunComparison = periodAValid && periodBValid;

  const generateComparison = useCallback(() => {
    if (!canRunComparison) {
      setValidationError('Debes elegir Periodo A y Periodo B validos antes de comparar.');
      return;
    }

    setValidationError('');
    setShareMessage('');

    const periodARecords = baseFilteredRecords.filter((r) => r.date >= periodAStart && r.date <= periodAEnd);
    const periodBRecords = baseFilteredRecords.filter((r) => r.date >= periodBStart && r.date <= periodBEnd);

    const periodAStats = buildPeriodStats(periodARecords);
    const periodBStats = buildPeriodStats(periodBRecords);

    const warnings: string[] = [];
    if (periodARecords.length === 0 && periodBRecords.length === 0) {
      warnings.push('No hay datos en los dos periodos para los filtros seleccionados.');
    } else {
      if (periodARecords.length < MIN_RECORDS_FOR_FULL_COMPARISON) {
        warnings.push(`Periodo A tiene pocos datos (${periodARecords.length} registros). La comparacion es parcial.`);
      }
      if (periodBRecords.length < MIN_RECORDS_FOR_FULL_COMPARISON) {
        warnings.push(`Periodo B tiene pocos datos (${periodBRecords.length} registros). La comparacion es parcial.`);
      }
    }

    const indicators: IndicatorRow[] = indicatorDefinitions.map((definition) => {
      const periodAValue = pickMetricValue(periodAStats, definition.key);
      const periodBValue = pickMetricValue(periodBStats, definition.key);
      const diffAbs = periodBValue - periodAValue;
      const pctData = computePct(periodAValue, periodBValue);

      return {
        key: definition.key,
        label: definition.label,
        description: definition.description,
        higherIsBetter: definition.higherIsBetter,
        periodA: periodAValue,
        periodB: periodBValue,
        diffAbs,
        diffPct: pctData.pct,
        pctConvention: pctData.convention,
        direction: getDirection(diffAbs),
        outcome: getOutcome(diffAbs, definition.higherIsBetter),
      };
    });

    const segmentMapA = new Map<string, PeriodStats>();
    const segmentMapB = new Map<string, PeriodStats>();

    const addToMap = (target: Map<string, PeriodStats>, periodRecords: ProductionRecord[]) => {
      const grouped = new Map<string, ProductionRecord[]>();
      periodRecords.forEach((record) => {
        const rawValue = record[segmentKey];
        const group = rawValue ? String(rawValue) : 'Sin dato';
        const bucket = grouped.get(group) || [];
        bucket.push(record);
        grouped.set(group, bucket);
      });

      grouped.forEach((groupRecords, group) => {
        target.set(group, buildPeriodStats(groupRecords));
      });
    };

    addToMap(segmentMapA, periodARecords);
    addToMap(segmentMapB, periodBRecords);

    const allSegments = new Set<string>([...segmentMapA.keys(), ...segmentMapB.keys()]);

    const segmentRows: SegmentRow[] = Array.from(allSegments).map((segment) => {
      const statsA = segmentMapA.get(segment) || buildPeriodStats([]);
      const statsB = segmentMapB.get(segment) || buildPeriodStats([]);
      const periodAValue = pickMetricValue(statsA, segmentMetric);
      const periodBValue = pickMetricValue(statsB, segmentMetric);
      const diffAbs = periodBValue - periodAValue;
      const pctData = computePct(periodAValue, periodBValue);

      return {
        segment,
        periodA: periodAValue,
        periodB: periodBValue,
        diffAbs,
        diffPct: pctData.pct,
        pctConvention: pctData.convention,
        impact: Math.abs(diffAbs),
      };
    });

    setResult({
      generatedAt: new Date().toISOString(),
      periodAStats,
      periodBStats,
      indicators,
      segmentRows,
      warnings,
    });
  }, [
    baseFilteredRecords,
    canRunComparison,
    periodAEnd,
    periodAStart,
    periodBEnd,
    periodBStart,
    segmentKey,
    segmentMetric,
  ]);

  useEffect(() => {
    if (!result) return;
    generateComparison();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentKey, segmentMetric]);

  const visibleSegmentRows = useMemo(() => {
    if (!result) return [];

    const filtered = result.segmentRows.filter((row) => {
      if (!searchSegment.trim()) return true;
      return row.segment.toLowerCase().includes(searchSegment.trim().toLowerCase());
    });

    const sorted = [...filtered].sort((a, b) => {
      let compare = 0;
      if (sortKey === 'segment') compare = a.segment.localeCompare(b.segment, 'es', { sensitivity: 'base' });
      if (sortKey === 'periodA') compare = a.periodA - b.periodA;
      if (sortKey === 'periodB') compare = a.periodB - b.periodB;
      if (sortKey === 'diffAbs') compare = a.diffAbs - b.diffAbs;
      if (sortKey === 'diffPct') compare = (a.diffPct ?? Number.NEGATIVE_INFINITY) - (b.diffPct ?? Number.NEGATIVE_INFINITY);
      if (sortKey === 'impact') compare = a.impact - b.impact;
      return sortDirection === 'asc' ? compare : -compare;
    });

    return sorted;
  }, [result, searchSegment, sortDirection, sortKey]);

  const executiveSummary = useMemo(() => {
    if (!result) return null;

    const improved = result.indicators.filter((row) => row.outcome === 'improved');
    const worsened = result.indicators.filter((row) => row.outcome === 'worsened');

    const variationScore = (row: IndicatorRow) => (row.diffPct === null ? Math.abs(row.diffAbs) : Math.abs(row.diffPct));

    const largestVariation = [...result.indicators].sort((a, b) => variationScore(b) - variationScore(a))[0] || null;
    const topImprovement = [...improved].sort((a, b) => variationScore(b) - variationScore(a))[0] || null;
    const topDecline = [...worsened].sort((a, b) => variationScore(b) - variationScore(a))[0] || null;

    const mainIndicator = result.indicators.find((item) => item.key === 'totalMeters') || result.indicators[0];

    return {
      improvedCount: improved.length,
      worsenedCount: worsened.length,
      topImprovement,
      topDecline,
      largestVariation,
      globalDelta: mainIndicator,
    };
  }, [result]);

  const currentMetricDefinition = useMemo(() => {
    return indicatorDefinitions.find((item) => item.key === segmentMetric) || indicatorDefinitions[0];
  }, [segmentMetric]);

  const toggleSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === 'segment' ? 'asc' : 'desc');
  };

  const exportCsv = () => {
    if (!result) return;

    const activeFilters = [
      filterMachine ? `Maquina=${filterMachine}` : null,
      filterShift ? `Turno=${filterShift}` : null,
      filterBoss ? `Jefe=${filterBoss}` : null,
      filterOperator ? `Operario=${filterOperator}` : null,
    ].filter(Boolean) as string[];

    const rows: string[] = [];
    rows.push('Widget,Reportes Comparativos');
    rows.push(`Generado en,${new Date(result.generatedAt).toLocaleString('es-ES')}`);
    rows.push(`Periodo A,${periodAStart} a ${periodAEnd}`);
    rows.push(`Periodo B,${periodBStart} a ${periodBEnd}`);
    rows.push(`Filtros,${activeFilters.length > 0 ? activeFilters.join(' | ') : 'Sin filtros'}`);
    rows.push('');
    rows.push('Indicador,Periodo A,Periodo B,Diferencia Absoluta,Diferencia Porcentual,Convencion');

    result.indicators.forEach((row) => {
      rows.push(
        [
          row.label,
          row.periodA,
          row.periodB,
          row.diffAbs,
          row.diffPct === null ? 'N/A' : `${row.diffPct.toFixed(2)}%`,
          row.pctConvention,
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(',')
      );
    });

    rows.push('');
    rows.push(`Detalle por segmento (${segmentKey}) - Metrica (${currentMetricDefinition.label})`);
    rows.push('Segmento,Periodo A,Periodo B,Diferencia Absoluta,Diferencia Porcentual,Impacto,Convencion');

    visibleSegmentRows.forEach((row) => {
      rows.push(
        [
          row.segment,
          row.periodA,
          row.periodB,
          row.diffAbs,
          row.diffPct === null ? 'N/A' : `${row.diffPct.toFixed(2)}%`,
          row.impact,
          row.pctConvention,
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(',')
      );
    });

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `Reporte_Comparativo_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const exportJson = () => {
    if (!result) return;

    const payload = {
      widget: 'Reportes Comparativos',
      generatedAt: result.generatedAt,
      periodA: { start: periodAStart, end: periodAEnd },
      periodB: { start: periodBStart, end: periodBEnd },
      filters: {
        machine: filterMachine || null,
        shift: filterShift || null,
        boss: filterBoss || null,
        operator: filterOperator || null,
      },
      summary: executiveSummary,
      indicators: result.indicators,
      segments: visibleSegmentRows,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `Reporte_Comparativo_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const copyExecutiveSummary = async () => {
    if (!result || !executiveSummary) return;

    const text = [
      'Resumen ejecutivo - Reportes Comparativos',
      `Generado: ${new Date(result.generatedAt).toLocaleString('es-ES')}`,
      `Periodo A: ${periodAStart} a ${periodAEnd}`,
      `Periodo B: ${periodBStart} a ${periodBEnd}`,
      `Variacion global (${executiveSummary.globalDelta.label}): ${formatSigned(executiveSummary.globalDelta.diffAbs)} (${executiveSummary.globalDelta.diffPct === null ? 'N/A (base 0)' : `${formatSigned(executiveSummary.globalDelta.diffPct)}%`})`,
      `Mejoras: ${executiveSummary.improvedCount} indicadores`,
      `Caidas: ${executiveSummary.worsenedCount} indicadores`,
      `Top mejora: ${executiveSummary.topImprovement ? executiveSummary.topImprovement.label : 'Sin mejora relevante'}`,
      `Top caida: ${executiveSummary.topDecline ? executiveSummary.topDecline.label : 'Sin caida relevante'}`,
      `Mayor variacion: ${executiveSummary.largestVariation ? executiveSummary.largestVariation.label : 'Sin variacion relevante'}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setShareMessage('Resumen copiado al portapapeles.');
      setTimeout(() => setShareMessage(''), 2500);
    } catch {
      setShareMessage('No se pudo copiar automaticamente.');
      setTimeout(() => setShareMessage(''), 2500);
    }
  };

  const activeFilters = [
    filterMachine ? `Maquina: ${filterMachine}` : null,
    filterShift ? `Turno: ${filterShift}` : null,
    filterBoss ? `Jefe: ${filterBoss}` : null,
    filterOperator ? `Operario: ${filterOperator}` : null,
  ].filter(Boolean) as string[];

  const hasNoResults = result && result.indicators.every((row) => row.periodA === 0 && row.periodB === 0);

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" /> Widget: Reportes Comparativos
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Compara dos periodos para detectar mejoras, caidas y desviaciones con trazabilidad por indicador y segmento.
          </p>
        </div>

        <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          <div className="font-semibold text-slate-700">Periodos comparados</div>
          <div>
            A: {periodAStart ? `${formatDateOnly(periodAStart)} a ${formatDateOnly(periodAEnd)}` : '-'}
          </div>
          <div>
            B: {periodBStart ? `${formatDateOnly(periodBStart)} a ${formatDateOnly(periodBEnd)}` : '-'}
          </div>
          <div className="mt-1">Filtros: {activeFilters.length ? activeFilters.join(' | ') : 'Sin filtros activos'}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">Periodo A - Inicio</label>
          <input type="date" value={periodAStart} onChange={(e) => setPeriodAStart(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">Periodo A - Fin</label>
          <input type="date" value={periodAEnd} onChange={(e) => setPeriodAEnd(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">Periodo B - Inicio</label>
          <input type="date" value={periodBStart} onChange={(e) => setPeriodBStart(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">Periodo B - Fin</label>
          <input type="date" value={periodBEnd} onChange={(e) => setPeriodBEnd(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">Maquina</label>
          <select value={filterMachine} onChange={(e) => setFilterMachine(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
            <option value="">Todas</option>
            {Object.values(MachineType).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">Turno</label>
          <select value={filterShift} onChange={(e) => setFilterShift(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
            <option value="">Todos</option>
            {Object.values(ShiftType).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">Jefe</label>
          <select value={filterBoss} onChange={(e) => setFilterBoss(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
            <option value="">Todos</option>
            {uniqueBosses.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">Operario</label>
          <select value={filterOperator} onChange={(e) => setFilterOperator(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
            <option value="">Todos</option>
            {uniqueOperators.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={generateComparison}
          disabled={!canRunComparison}
          className={`px-4 py-2 rounded-lg text-sm font-semibold text-white ${canRunComparison ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-300 cursor-not-allowed'}`}
        >
          Ejecutar comparacion
        </button>
        <button
          type="button"
          onClick={() => {
            setFilterMachine('');
            setFilterShift('');
            setFilterBoss('');
            setFilterOperator('');
          }}
          className="px-3 py-2 rounded-lg text-sm font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700"
        >
          Limpiar filtros
        </button>
        {!periodAValid && <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">Periodo A invalido</span>}
        {!periodBValid && <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">Periodo B invalido</span>}
        {validationError && <span className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{validationError}</span>}
      </div>

      {result && (
        <>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" /> Resumen Ejecutivo
              </h4>
              <div className="text-xs text-slate-500 flex items-center gap-1">
                <Clock3 className="w-3.5 h-3.5" /> Generado: {new Date(result.generatedAt).toLocaleString('es-ES')}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="bg-white border border-slate-200 rounded-lg p-3">
                <p className="text-xs text-slate-500 font-semibold">Variacion Global ({executiveSummary?.globalDelta.label})</p>
                <p className="text-lg font-black text-slate-900 mt-1">{formatSigned(executiveSummary?.globalDelta.diffAbs || 0)}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {executiveSummary?.globalDelta.diffPct === null
                    ? 'N/A (base 0, usar diferencia absoluta)'
                    : `${formatSigned(executiveSummary.globalDelta.diffPct)}%`}
                </p>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-3">
                <p className="text-xs text-slate-500 font-semibold">Top Mejora</p>
                <p className="text-sm font-bold text-emerald-700 mt-1">{executiveSummary?.topImprovement ? executiveSummary.topImprovement.label : 'Sin mejora relevante'}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {executiveSummary?.topImprovement ? outcomeLabel(executiveSummary.topImprovement.outcome) : 'Sin cambios significativos'}
                </p>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-3">
                <p className="text-xs text-slate-500 font-semibold">Top Caida</p>
                <p className="text-sm font-bold text-red-700 mt-1">{executiveSummary?.topDecline ? executiveSummary.topDecline.label : 'Sin caidas relevantes'}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {executiveSummary?.topDecline ? outcomeLabel(executiveSummary.topDecline.outcome) : 'Sin deterioro significativo'}
                </p>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-3">
                <p className="text-xs text-slate-500 font-semibold">Mayor Variacion</p>
                <p className="text-sm font-bold text-slate-800 mt-1">{executiveSummary?.largestVariation ? executiveSummary.largestVariation.label : 'Sin variaciones'}</p>
                <p className="text-xs text-slate-500 mt-1">Mejoras: {executiveSummary?.improvedCount || 0} · Caidas: {executiveSummary?.worsenedCount || 0}</p>
              </div>
            </div>

            {result.warnings.length > 0 && (
              <div className="space-y-2">
                {result.warnings.map((warning, index) => (
                  <div key={`${warning}-${index}`} className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 mt-0.5" />
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button onClick={exportCsv} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white">
                <Download className="w-4 h-4" /> Exportar CSV
              </button>
              <button onClick={exportJson} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white">
                <Download className="w-4 h-4" /> Guardar JSON
              </button>
              <button onClick={() => void copyExecutiveSummary()} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-slate-700 hover:bg-slate-800 text-white">
                <Share2 className="w-4 h-4" /> Copiar resumen
              </button>
              {shareMessage && <span className="text-xs text-slate-600 bg-slate-100 px-2 py-1 rounded">{shareMessage}</span>}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <div className="px-4 py-3 border-b border-slate-200">
              <h4 className="text-sm font-bold text-slate-900">Comparacion por Indicador</h4>
              <p className="text-xs text-slate-500 mt-1">Mismos criterios y formulas entre periodos para evitar interpretaciones inconsistentes.</p>
            </div>
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-2">Indicador</th>
                  <th className="text-right px-4 py-2">Periodo A</th>
                  <th className="text-right px-4 py-2">Periodo B</th>
                  <th className="text-right px-4 py-2">Dif. Abs.</th>
                  <th className="text-right px-4 py-2">Dif. %</th>
                  <th className="text-left px-4 py-2">Lectura</th>
                </tr>
              </thead>
              <tbody>
                {result.indicators.map((row) => {
                  const definition = indicatorDefinitions.find((item) => item.key === row.key) || indicatorDefinitions[0];
                  return (
                    <tr key={row.key} className="border-t border-slate-100">
                      <td className="px-4 py-2">
                        <div className="font-semibold text-slate-800">{row.label}</div>
                        <div className="text-xs text-slate-500">{row.description}</div>
                      </td>
                      <td className="px-4 py-2 text-right font-medium">{definition.format(row.periodA)}</td>
                      <td className="px-4 py-2 text-right font-medium">{definition.format(row.periodB)}</td>
                      <td className={`px-4 py-2 text-right font-bold ${row.diffAbs > 0 ? 'text-emerald-700' : row.diffAbs < 0 ? 'text-red-700' : 'text-slate-600'}`}>
                        {formatSigned(row.diffAbs)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {row.diffPct === null ? (
                          <span className="text-xs text-slate-600">N/A (A=0)</span>
                        ) : (
                          <span className={`font-semibold ${row.diffPct > 0 ? 'text-emerald-700' : row.diffPct < 0 ? 'text-red-700' : 'text-slate-600'}`}>
                            {formatSigned(row.diffPct)}%
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        <div className={`font-semibold ${row.outcome === 'improved' ? 'text-emerald-700' : row.outcome === 'worsened' ? 'text-red-700' : 'text-slate-600'}`}>
                          {outcomeLabel(row.outcome)}
                        </div>
                        <div className="text-slate-500">{row.pctConvention}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 space-y-3">
              <h4 className="text-sm font-bold text-slate-900">Detalle por Segmentos</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Segmentar por</label>
                  <select value={segmentKey} onChange={(e) => setSegmentKey(e.target.value as SegmentKey)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                    {SEGMENT_OPTIONS.map((item) => (
                      <option key={item.key} value={item.key}>{item.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Indicador de impacto</label>
                  <select value={segmentMetric} onChange={(e) => setSegmentMetric(e.target.value as SegmentMetricKey)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                    {SEGMENT_METRIC_OPTIONS.map((item) => (
                      <option key={item.key} value={item.key}>{item.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Buscar segmento</label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={searchSegment}
                      onChange={(e) => setSearchSegment(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm"
                      placeholder="Ej: WH1, Noche, Operario"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-left px-4 py-2">
                      <button type="button" onClick={() => toggleSort('segment')} className="inline-flex items-center gap-1 font-semibold hover:text-slate-900">
                        Segmento <ArrowUpDown className="w-3.5 h-3.5" />
                      </button>
                    </th>
                    <th className="text-right px-4 py-2">
                      <button type="button" onClick={() => toggleSort('periodA')} className="inline-flex items-center gap-1 font-semibold hover:text-slate-900">
                        Periodo A <ArrowUpDown className="w-3.5 h-3.5" />
                      </button>
                    </th>
                    <th className="text-right px-4 py-2">
                      <button type="button" onClick={() => toggleSort('periodB')} className="inline-flex items-center gap-1 font-semibold hover:text-slate-900">
                        Periodo B <ArrowUpDown className="w-3.5 h-3.5" />
                      </button>
                    </th>
                    <th className="text-right px-4 py-2">
                      <button type="button" onClick={() => toggleSort('diffAbs')} className="inline-flex items-center gap-1 font-semibold hover:text-slate-900">
                        Dif. Abs. <ArrowUpDown className="w-3.5 h-3.5" />
                      </button>
                    </th>
                    <th className="text-right px-4 py-2">
                      <button type="button" onClick={() => toggleSort('diffPct')} className="inline-flex items-center gap-1 font-semibold hover:text-slate-900">
                        Dif. % <ArrowUpDown className="w-3.5 h-3.5" />
                      </button>
                    </th>
                    <th className="text-right px-4 py-2">
                      <button type="button" onClick={() => toggleSort('impact')} className="inline-flex items-center gap-1 font-semibold hover:text-slate-900">
                        Impacto <ArrowUpDown className="w-3.5 h-3.5" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSegmentRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        No hay segmentos para mostrar con los filtros actuales.
                      </td>
                    </tr>
                  )}
                  {visibleSegmentRows.map((row) => (
                    <tr key={row.segment} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-medium text-slate-800">{row.segment}</td>
                      <td className="px-4 py-2 text-right">{currentMetricDefinition.format(row.periodA)}</td>
                      <td className="px-4 py-2 text-right">{currentMetricDefinition.format(row.periodB)}</td>
                      <td className={`px-4 py-2 text-right font-semibold ${row.diffAbs > 0 ? 'text-emerald-700' : row.diffAbs < 0 ? 'text-red-700' : 'text-slate-600'}`}>
                        {formatSigned(row.diffAbs)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {row.diffPct === null ? 'N/A' : `${formatSigned(row.diffPct)}%`}
                      </td>
                      <td className="px-4 py-2 text-right font-bold">{formatDecimal(row.impact)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <h4 className="text-sm font-bold text-slate-900 mb-2">Conclusiones y Recomendaciones</h4>
            {hasNoResults ? (
              <p className="text-sm text-slate-600">
                No se detectaron datos para construir diagnostico. Ajusta periodos o filtros y vuelve a comparar.
              </p>
            ) : (
              <ul className="text-sm text-slate-700 space-y-1">
                <li>
                  Riesgos: {executiveSummary?.topDecline ? `atender ${executiveSummary.topDecline.label.toLowerCase()} por su mayor deterioro.` : 'no se detectan riesgos criticos en este corte.'}
                </li>
                <li>
                  Oportunidades: {executiveSummary?.topImprovement ? `replicar practicas del indicador ${executiveSummary.topImprovement.label.toLowerCase()}.` : 'buscar segmentos con potencial de mejora en el desglose.'}
                </li>
                <li>
                  Recomendacion: priorizar segmentos con mayor impacto absoluto en el detalle para ejecutar acciones correctivas.
                </li>
              </ul>
            )}
            <p className="text-xs text-slate-500 mt-3">
              Convencion de porcentaje: cuando Periodo A = 0, se reporta N/A y se prioriza diferencia absoluta para mantener interpretacion comprensible.
            </p>
          </div>
        </>
      )}
    </section>
  );
};

export default ComparativeReportsWidget;
