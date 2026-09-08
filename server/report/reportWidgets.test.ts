import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { DashboardConfig } from '../../types';
import { REPORT_WIDGETS, resolveReportWidgets } from '../../shared/reportWidgets';

describe('resolveReportWidgets', () => {
  it('mantiene la visualización del correo pero hereda activeRuleId por groupBy y valueField', () => {
    const config: DashboardConfig = {
      id: 'dashboard-principal',
      name: 'Dashboard Principal',
      isDefault: true,
      widgets: [
        { id: 'shift-pie', title: 'Turno', chartType: 'pie', groupBy: 'shift', valueField: 'meters', aggregation: 'sum', activeRuleId: 'sum-giave-film-papel' },
        { id: 'trend-area', title: 'Tendencia', chartType: 'area', groupBy: 'date', valueField: 'meters', aggregation: 'sum', activeRuleId: 'sum-giave-film-papel' },
      ],
    };

    const widgets = resolveReportWidgets(config);
    assert.equal(widgets.find((widget) => widget.id === 'shift')?.chartType, 'bar');
    assert.equal(widgets.find((widget) => widget.id === 'shift')?.activeRuleId, 'sum-giave-film-papel');
    assert.equal(widgets.find((widget) => widget.id === 'trend')?.chartType, 'combined_trend');
    assert.equal(widgets.find((widget) => widget.id === 'trend')?.activeRuleId, 'sum-giave-film-papel');
    assert.deepEqual(
      {
        valueField: widgets.find((widget) => widget.id === 'trend')?.valueField,
        secondaryValueField: widgets.find((widget) => widget.id === 'trend')?.secondaryValueField,
      },
      { valueField: 'meters', secondaryValueField: 'changesCount' }
    );
  });

  it('incluye cinco gráficas por línea y no aplica regla de metros a cambios por operario', () => {
    assert.equal(REPORT_WIDGETS.length, 5);
    const widgets = resolveReportWidgets({
      id: 'dashboard-principal',
      name: 'Dashboard Principal',
      isDefault: true,
      widgets: [{ id: 'changes', title: 'Cambios', chartType: 'bar', groupBy: 'operator', valueField: 'changesCount', aggregation: 'sum', activeRuleId: 'meters-rule' }],
    });
    const changes = widgets.find((widget) => widget.id === 'operator-changes');
    assert.deepEqual(
      { groupBy: changes?.groupBy, valueField: changes?.valueField, aggregation: changes?.aggregation, activeRuleId: changes?.activeRuleId },
      { groupBy: 'operator', valueField: 'changesCount', aggregation: 'sum', activeRuleId: null }
    );
  });
});
