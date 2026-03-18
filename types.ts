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