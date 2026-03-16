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

export enum BossType {
  MARTIN = 'J.Martín',
  NAVARRO = 'J.Navarro',
  CESAR = 'César'
}

export interface ProductionRecord {
  id: string;
  timestamp: number;
  date: string; // YYYY-MM-DD
  machine: MachineType;
  meters: number;
  changesCount: number;
  changesComment: string;
  shift: ShiftType;
  boss: string;
  operator: string; // New field
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

export interface PaginatedRecordsResponse {
  records: ProductionRecord[];
  total: number;
  page: number;
  totalPages: number;
}

export interface DashboardSummary {
  count: number;
  totalMeters: number;
  avgMeters: number;
  totalChanges: number;
  avgChanges: number;
  efficiency: number;
}

export interface DashboardGroupItem {
  name: string;
  value: number;
}

export interface DashboardStats {
  summary: DashboardSummary;
  byMachine: DashboardGroupItem[];
  byOperator: DashboardGroupItem[];
  byShift: DashboardGroupItem[];
  byBoss: DashboardGroupItem[];
  byComment: DashboardGroupItem[];
  byDate: DashboardGroupItem[];
}

export interface AuditLogEntry {
  id: string;
  action: string;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
  actor_id: string | null;
  actor_operator_code: string | null;
  actor_name: string | null;
  actor_role: string | null;
}

export interface PaginatedAuditLogsResponse {
  logs: AuditLogEntry[];
  total: number;
  page: number;
  totalPages: number;
}
