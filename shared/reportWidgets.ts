import type { DashboardConfig, DashboardWidgetConfig } from '../types';

/**
 * La representación del correo es deliberadamente estable. La configuración
 * del Dashboard solo aporta la regla semántica activa para la misma métrica.
 */
export const REPORT_WIDGETS: DashboardWidgetConfig[] = [
  { id: 'machine', title: 'Producción por Máquina', chartType: 'bar', groupBy: 'machine', valueField: 'meters', aggregation: 'sum', spanColumns: 1 },
  { id: 'shift', title: 'Producción por turno', chartType: 'bar', groupBy: 'shift', valueField: 'meters', aggregation: 'sum', spanColumns: 1 },
  { id: 'operator', title: 'Metros por Operario', chartType: 'bar_horizontal', groupBy: 'operator', valueField: 'meters', aggregation: 'sum', spanColumns: 1 },
  { id: 'trend', title: 'Tendencia — Metros vs Cambios de pedido', chartType: 'combined_trend', groupBy: 'date', valueField: 'meters', secondaryValueField: 'changesCount', aggregation: 'sum', spanColumns: 1 },
  { id: 'operator-changes', title: 'Cambios de pedido por Operario', chartType: 'bar_horizontal', groupBy: 'operator', valueField: 'changesCount', aggregation: 'sum', spanColumns: 1, activeRuleId: null },
];

export function resolveReportWidgets(config: DashboardConfig | null): DashboardWidgetConfig[] {
  if (!config?.widgets?.length) return REPORT_WIDGETS;

  return REPORT_WIDGETS.map((fallback) => {
    // El tipo visual del Dashboard (pie/area) puede diferir del del e-mail.
    // La identidad de una métrica es groupBy + valueField.
    const dashboardWidget = config.widgets.find((widget) =>
      widget.groupBy === fallback.groupBy && widget.valueField === fallback.valueField
    );
    return {
      ...fallback,
      activeRuleId: fallback.activeRuleId === null ? null : dashboardWidget?.activeRuleId,
    };
  });
}
