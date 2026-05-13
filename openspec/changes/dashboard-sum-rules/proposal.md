# Proposal: Dashboard Sum Rules

## Intent

Allow users to create reusable rules that combine multiple meter/length fields into a single aggregated metric, and enable widgets to optionally activate any rule instead of (or in addition to) a single value field.

**Problem**: Different machines register meters in separate fields (e.g., "metros_real", "metro_bruto", "metros_netos"). A widget can only reference ONE `valueField` at a time. Users need a way to sum all meter fields into one unified metric per widget.

## Scope

### In Scope
- New `DashboardSumRule` type: defines a named rule with multiple source fields, an aggregation function (sum), and a filter/condition
- New `activeRuleId` optional field on `DashboardWidgetConfig` to activate a rule
- Rule evaluation engine: when a widget has `activeRuleId`, resolves the metric by applying the rule's sum across its source fields
- UI in DashboardManager: CRUD for rules (create, edit, delete) + rule selector in widget editor
- UI in Dashboard: widget displays the label of the active rule (if any) alongside the metric value
- Client-side only — rules stored in `DashboardConfig` JSON, no server schema change needed

### Out of Scope
- Server-side validation changes (rules are opaque JSON in `widgets`)
- Rule types beyond SUM (AVG, MIN, MAX, conditional sum — future work)
- Cross-record rules (rules operate within the filtered record set, no cross-dashboard logic)
- Rule sharing across dashboards (each dashboard has its own rules)

## Capabilities

### New Capabilities
- `dashboard-sum-rules`: Named reusable rules that aggregate multiple fields into one metric. Widgets reference rules via `activeRuleId`.

### Modified Capabilities
- None (existing widget aggregation behavior unchanged when no rule is active)

## Approach

### Data Model

```typescript
interface DashboardSumRule {
  id: string;
  name: string;
  description?: string;
  sourceFields: string[];        // e.g., ["meters", "dynamic.metros_real", "dynamic.metro_bruto"]
  aggregation: 'sum';            // v1: only sum, extensible later
  condition?: DashboardRuleCondition; // optional filter (future)
}

interface DashboardRuleCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains';
  value: string | number;
}
```

### Widget Config Change

```diff
interface DashboardWidgetConfig {
  // ... existing fields
+ activeRuleId?: string | null;  // When set, overrides valueField with rule's sum
}
```

### Evaluation Logic

1. When a widget has `activeRuleId`, look up the rule from `dashboard.rules[]`
2. For each record, sum the values of ALL `sourceFields` (using existing `getRecordFieldValue()`)
3. Then apply the widget's `aggregation` (count/sum/avg) on the per-record totals
4. The metric label becomes the rule's `name` instead of the `valueField` label

### UI Changes

**DashboardManager.tsx**:
- New "Rules" tab/section alongside widget editor
- Rule form: name, description, multi-select for source fields (core + dynamic), aggregation picker
- Widget editor: new dropdown "Regla activa" with options: `None` + all rules
- When a rule is selected, `valueField` becomes secondary (still needed for fallback/grouping)

**Dashboard.tsx**:
- New `buildRuleBasedData()` function parallel to `buildKpiData()` / `buildGroupedData()`
- Widget header shows rule name when active: `"Total Metros (Regla: Todos los metros)"`
- Visual indicator (small badge) when rule is active

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `types.ts` | New types | `DashboardSumRule`, `DashboardRuleCondition`, `activeRuleId` on `DashboardWidgetConfig` |
| `utils/dashboardFieldPolicy.ts` | Modified | Export rule evaluation helper `evaluateRuleForRecord()` |
| `components/Dashboard.tsx` | Modified | Rule-based data functions, UI badge for active rule |
| `components/DashboardManager.tsx` | Modified | Rule CRUD UI, rule selector in widget editor |
| `server.ts` | Modified | Server validation accepts `rules` array in dashboard config payload |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Double-counting if same field appears in multiple rules | Medium | Validation prevents duplicate sourceFields within a rule |
| Backward compatibility with existing dashboards | Low | `activeRuleId` is optional, existing configs unchanged |
| Rule evaluation performance with many records | Low | Client-side, same pattern as existing build*Data() functions |

## Rollback Plan

1. Remove `rules` array from `DashboardConfig` interface — existing widgets ignore unknown `activeRuleId`
2. Remove rule UI components from DashboardManager
3. No database migration needed — rules are stored in JSONB column that already exists

## Dependencies

- None (builds on existing dashboard infrastructure)

## Success Criteria

- [ ] User can create a rule that sums 2+ meter fields
- [ ] Widget can activate a rule via dropdown selector
- [ ] Activated widget shows summed metric from all rule source fields
- [ ] Deactivating rule reverts widget to original single-field behavior
- [ ] Existing dashboards without rules continue to work unchanged
