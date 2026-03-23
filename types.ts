export enum MachineType {
  WH1 = 'WH1',
  GIAVE = 'Giave',
  WH3 = 'WH3',
  NEXUS = 'NEXUS',
  SL2 = 'SL2',
  M21 = '21',
  M22 = '22',
  S2DT = 'S2DT',
  PROSLIT = 'PROSLIT'
}

export enum ShiftType {
  MORNING = 'Mañana',
  AFTERNOON = 'Tarde',
  NIGHT = 'Noche'
}

export interface ProductionRecord {
  id: string;
  timestamp: number;
  recordedAt?: string;
  createdByUserId?: string | null;
  lastModifiedByUserId?: string | null;
  date: string; // YYYY-MM-DD
  machine: MachineType;
  meters: number;
  changesCount: number;
  changesComment: string;
  shift: ShiftType;
  boss: string;
  bossUserId?: string | null;
  operator: string; // New field
  operatorUserId?: string | null;
  dynamicFieldsValues?: Record<string, unknown>;
  schemaVersionUsed?: number | null;
}

export type DynamicFieldType = 'number' | 'short_text' | 'select' | 'multi_select';

export interface DynamicFieldRuleSet {
  min?: number;
  max?: number;
  maxLength?: number;
}

export interface MachineFieldDefinition {
  key: string;
  label: string;
  type: DynamicFieldType;
  required: boolean;
  enabled: boolean;
  order: number;
  options?: string[];
  defaultValue?: string | number | string[];
  rules?: DynamicFieldRuleSet;
}

export interface MachineFieldSchemaPayload {
  machine: MachineType;
  version: number;
  fields: MachineFieldDefinition[];
  updatedAt?: string;
  updatedByUserId?: string | null;
}

export interface MachineFieldSchemaHistoryItem {
  id: string;
  action: string;
  createdAt: string;
  userId?: string | null;
  userName?: string | null;
  details: {
    machine: string;
    previousVersion: number;
    nextVersion: number;
    fieldsBefore: MachineFieldDefinition[];
    fieldsAfter: MachineFieldDefinition[];
  };
}

export interface FieldCatalogAssignment {
  machine: string;
  enabled: boolean;
  sortOrder: number;
}

export interface FieldCatalogEntry {
  id: string;
  key: string;
  label: string;
  type: DynamicFieldType;
  required: boolean;
  displayOrder: number;
  options: string[];
  defaultValue?: string | number | string[] | null;
  rules?: DynamicFieldRuleSet;
  assignments: FieldCatalogAssignment[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductionStats {
  totalMeters: number;
  totalChanges: number;
  avgEfficiency: number;
  recordCount: number;
}

export interface FilterState {
  startDate: string;
  endDate: string;
  machine: string;
  boss: string;
  operator: string;
}

export type DashboardFieldType = 'number' | 'text' | 'date';

export type DashboardChartType = 'bar' | 'line' | 'area' | 'pie' | 'combined_trend' | 'kpi';

export type DashboardAggregationType = 'count' | 'sum' | 'avg';

export interface DashboardFieldOption {
  key: string;
  label: string;
  type: DashboardFieldType;
  source: 'core' | 'dynamic';
}

export interface DashboardWidgetConfig {
  id: string;
  title: string;
  chartType: DashboardChartType;
  groupBy?: string; // New field for V2
  valueField: string;
  secondaryValueField?: string;
  aggregation: DashboardAggregationType;
  limit?: number;
}

export interface DashboardConfig {
  id: string;
  name: string;
  description?: string;
  baseField?: string; // Made optional for V2
  relatedFields?: string[]; // Made optional for V2
  widgets: DashboardWidgetConfig[];
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string | null;
}