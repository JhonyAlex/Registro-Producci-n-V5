import React, { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  LabelList,
} from 'recharts';
import { DashboardConfig, DashboardWidgetConfig, FieldCatalogEntry, ProductionRecord } from '../types';
import { buildCombinedTrendData, buildGroupedData, buildRuleBasedGroupedData, resolveActiveRule } from './Dashboard';
import type { MachineGroup } from '../shared/machineGroups';

interface ReportDataResponse {
  records: ProductionRecord[];
  dashboardConfigs: DashboardConfig[];
  fieldCatalog: FieldCatalogEntry[];
  groups: MachineGroup[];
}

const formatNumber = (val: number): string => {
  if (val >= 1000000) return (val / 1000000).toFixed(2) + 'M';
  if (val >= 1000) return (val / 1000).toFixed(2) + 'K';
  return val.toLocaleString('es-ES', { maximumFractionDigits: 0 });
};

const REPORT_WIDGETS: DashboardWidgetConfig[] = [
  { id: 'machine', title: 'Producción por Máquina', chartType: 'bar', groupBy: 'machine', valueField: 'meters', aggregation: 'sum', spanColumns: 1 },
  { id: 'shift', title: 'Producción por turno', chartType: 'bar', groupBy: 'shift', valueField: 'meters', aggregation: 'sum', spanColumns: 1 },
  { id: 'operator', title: 'Metros por Operario', chartType: 'bar_horizontal', groupBy: 'operator', valueField: 'meters', aggregation: 'sum', spanColumns: 1 },
  { id: 'trend', title: 'Tendencia', chartType: 'combined_trend', groupBy: 'date', valueField: 'meters', secondaryValueField: 'changesCount', aggregation: 'sum', spanColumns: 1 },
];

function resolveReportWidgets(config: DashboardConfig | null): DashboardWidgetConfig[] {
  if (!config?.widgets?.length) return REPORT_WIDGETS;
  return REPORT_WIDGETS.map((fallback) =>
    config.widgets.find((widget) =>
      widget.chartType === fallback.chartType &&
      widget.groupBy === fallback.groupBy &&
      widget.valueField === fallback.valueField
    ) || fallback
  );
}

export const ReportRenderView: React.FC = () => {
  const [data, setData] = useState<ReportDataResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const from = params.get('from');
    const to = params.get('to');

    if (!from || !to) {
      const msg = 'Faltan los parámetros "from" o "to" en la URL.';
      setError(msg);
      (window as any).__REPORT_ERROR__ = msg;
      setLoading(false);
      return;
    }

    fetch(`/api/report/data?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then(async (res) => {
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `Error del servidor HTTP ${res.status}`);
        }
        return res.json() as Promise<ReportDataResponse>;
      })
      .then((reportData) => {
        setData(reportData);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error cargando datos de reporte:', err);
        const msg = err.message || 'Error desconocido';
        setError(msg);
        (window as any).__REPORT_ERROR__ = msg;
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (data && !loading && !error) {
      // Dejar un breve margen para que Recharts complete el renderizado SVG
      const timer = setTimeout(() => {
        (window as any).__REPORT_READY__ = true;
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [data, loading, error]);

  if (loading) {
    return (
      <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#475569' }}>
        <h2>Cargando datos del reporte de producción...</h2>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#dc2626' }}>
        <h2>Error al renderizar el reporte</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const { records, dashboardConfigs, groups } = data;
  const defaultConfig = dashboardConfigs.find((c) => c.isDefault) || dashboardConfigs[0] || null;
  const reportWidgets = resolveReportWidgets(defaultConfig);

  return (
    <div
      id="report-render-root"
      style={{
        width: 1100,
        backgroundColor: '#ffffff',
        padding: 24,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', marginBottom: 20 }}>
        Vista de Renderizado de Gráficas de Producción
      </h1>

      {groups.map((group) => {
        const lineRecords = records.filter((r) => group.machines.includes(r.machine));

        const [machineWidget, shiftWidget, operatorWidget, trendWidget] = reportWidgets;
        const groupedDataFor = (widget: DashboardWidgetConfig) => {
          const activeRule = resolveActiveRule(widget, defaultConfig?.rules);
          return activeRule
            ? buildRuleBasedGroupedData(lineRecords, widget.groupBy || 'machine', activeRule, widget.aggregation)
            : buildGroupedData(lineRecords, widget.groupBy || 'machine', widget.valueField, widget.aggregation);
        };

        // Las mismas funciones de agregación y reglas que consume Dashboard.tsx.
        const machineData = groupedDataFor(machineWidget);
        const shiftData = groupedDataFor(shiftWidget);
        const operatorData = groupedDataFor(operatorWidget);
        const trendRule = resolveActiveRule(trendWidget, defaultConfig?.rules);
        const trendData = buildCombinedTrendData(
          lineRecords,
          trendWidget.groupBy || 'date',
          trendWidget.valueField,
          trendWidget.secondaryValueField || 'changesCount',
          trendWidget.aggregation,
          trendRule
        );

        // Altura calculada para barras horizontales de operarios
        const operatorChartHeight = Math.max(260, operatorData.length * 30 + 40);

        return (
          <div key={group.id} style={{ marginBottom: 40 }}>
            <h2
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: '#1e293b',
                borderBottom: '2px solid #e2e8f0',
                paddingBottom: 6,
                marginBottom: 16,
              }}
            >
              Línea: {group.label} ({lineRecords.length} registros)
            </h2>

            <div style={{ display: 'grid', gridTemplateColumns: '500px 500px', gap: 24 }}>
              {/* Gráfica 1: Producción por Máquina */}
              <div
                id={`chart-${group.id}-1`}
                style={{
                  width: 500,
                  height: 320,
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: 8,
                  padding: '12px 16px',
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>
                  Producción por Máquina · {group.label}
                </div>
                <div style={{ width: 468, height: 260 }}>
                  <BarChart
                    width={468}
                    height={260}
                    data={machineData}
                    margin={{ top: 20, right: 16, left: 0, bottom: 10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                    <Bar
                      dataKey="value"
                      name="Metros"
                      fill="#0ea5e9"
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                    >
                      <LabelList
                        dataKey="value"
                        position="top"
                        formatter={(val: any) => formatNumber(Number(val || 0))}
                        style={{ fill: '#334155', fontSize: 10, fontWeight: 700 }}
                      />
                    </Bar>
                  </BarChart>
                </div>
              </div>

              {/* Gráfica 2: Producción por Turno */}
              <div
                id={`chart-${group.id}-2`}
                style={{
                  width: 500,
                  height: 320,
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: 8,
                  padding: '12px 16px',
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>
                  Producción por turno · {group.label}
                </div>
                <div style={{ width: 468, height: 260 }}>
                  <BarChart
                    width={468}
                    height={260}
                    data={shiftData}
                    margin={{ top: 20, right: 16, left: 0, bottom: 10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                    <Bar
                      dataKey="value"
                      name="Metros"
                      fill="#16a34a"
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                    >
                      <LabelList
                        dataKey="value"
                        position="top"
                        formatter={(val: any) => formatNumber(Number(val || 0))}
                        style={{ fill: '#334155', fontSize: 10, fontWeight: 700 }}
                      />
                    </Bar>
                  </BarChart>
                </div>
              </div>

              {/* Gráfica 3: Metros por Operario */}
              <div
                id={`chart-${group.id}-3`}
                style={{
                  width: 500,
                  height: Math.max(320, operatorChartHeight + 40),
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: 8,
                  padding: '12px 16px',
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>
                  Metros por Operario · {group.label}
                </div>
                <div style={{ width: 468, height: operatorChartHeight }}>
                  <BarChart
                    width={468}
                    height={operatorChartHeight}
                    data={operatorData}
                    layout="vertical"
                    margin={{ top: 10, right: 50, left: 10, bottom: 10 }}
                    barSize={18}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={120}
                      interval={0}
                      tick={{ fontSize: 11, fill: '#334155' }}
                    />
                    <Bar
                      dataKey="value"
                      name="Metros"
                      fill="#0ea5e9"
                      radius={[0, 4, 4, 0]}
                      isAnimationActive={false}
                    >
                      <LabelList
                        dataKey="value"
                        position="right"
                        offset={6}
                        formatter={(val: any) => formatNumber(Number(val || 0))}
                        style={{ fill: '#0f172a', fontSize: 10, fontWeight: 700 }}
                      />
                    </Bar>
                  </BarChart>
                </div>
              </div>

              {/* Gráfica 4: Tendencia (Metros + Cambios) */}
              <div
                id={`chart-${group.id}-4`}
                style={{
                  width: 500,
                  height: 320,
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: 8,
                  padding: '12px 16px',
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>
                  Tendencia · {group.label}
                </div>
                <div style={{ width: 468, height: 260 }}>
                  <ComposedChart
                    width={468}
                    height={260}
                    data={trendData}
                    margin={{ top: 20, right: 16, left: 0, bottom: 10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#64748b' }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#f97316' }} />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '4px' }} />
                    <Bar
                      yAxisId="left"
                      dataKey="primary"
                      name="Metros"
                      fill="#0ea5e9"
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                    >
                      <LabelList
                        dataKey="primary"
                        position="top"
                        formatter={(val: any) => formatNumber(Number(val || 0))}
                        style={{ fill: '#334155', fontSize: 9, fontWeight: 700 }}
                      />
                    </Bar>
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="secondary"
                      name="Cambios"
                      stroke="#f97316"
                      strokeWidth={2.5}
                      dot={{ r: 3 }}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ReportRenderView;
