import {
  DashboardConfig,
  FieldCatalogEntry,
  MachineFieldDefinition,
  MachineFieldSchemaHistoryItem,
  MachineFieldSchemaPayload,
  MachineType,
  ProductionRecord,
} from '../types';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { socket } from './socket';
import { addToQueue } from './offlineQueue';

export interface UserOption {
  id: string;
  name: string;
  role: string;
}

export interface AdminCreateUserPayload {
  operator_code: string;
  name: string;
  pin: string;
  role: string;
}

// Local cache to serve synchronous get requests if needed immediately
let localRecordsCache: ProductionRecord[] = [];
let localCommentsCache: string[] = [];
let localOperatorsCache: string[] = [];
let localBossesCache: string[] = [];
let localOperatorOptionsCache: UserOption[] = [];
let localBossOptionsCache: UserOption[] = [];
let settingsIntervalId: number | null = null;
let settingsBrowserListenersAttached = false;

const SETTINGS_SYNC_INTERVAL_MS = 15000;
const RECORDS_SYNC_INTERVAL_MS = 10000;

// Subscribers for settings updates
type SettingsCallback = (
  comments: string[],
  operators: string[],
  bosses: string[],
  operatorOptions: UserOption[],
  bossOptions: UserOption[]
) => void;
const settingsSubscribers: SettingsCallback[] = [];

const buildGlobalCommentsList = (): string[] => {
  const merged = new Map<string, string>();
  localCommentsCache.forEach((raw) => {
    const normalized = String(raw || '').trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, normalized);
    }
  });

  return Array.from(merged.values()).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
};

const notifySettingsSubscribers = () => {
  const comments = buildGlobalCommentsList();
  const operators = localOperatorsCache;
  const bosses = localBossesCache;
  const operatorOptions = localOperatorOptionsCache;
  const bossOptions = localBossOptionsCache;
  settingsSubscribers.forEach(cb => cb(comments, operators, bosses, operatorOptions, bossOptions));
};

// --- API HELPERS ---
const API_BASE = '/api';
const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;

interface NumericOverflowCandidate {
  path: string;
  value: number;
}

const findInt32OverflowCandidates = (input: unknown): NumericOverflowCandidate[] => {
  const candidates: NumericOverflowCandidate[] = [];
  const visited = new WeakSet<object>();

  const visit = (value: unknown, path: string) => {
    if (typeof value === 'number') {
      if (Number.isInteger(value) && (value > INT32_MAX || value < INT32_MIN)) {
        candidates.push({ path, value });
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    if (!value || typeof value !== 'object') {
      return;
    }

    if (visited.has(value as object)) {
      return;
    }
    visited.add(value as object);

    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      visit(entry, `${path}.${key}`);
    });
  };

  visit(input, 'record');
  return candidates;
};

const fetchJson = async (url: string, options?: RequestInit) => {
  const method = (options?.method || 'GET').toUpperCase();
  const isReadRequest = method === 'GET' || method === 'HEAD';
  const res = await fetch(`${API_BASE}${url}`, {
    cache: isReadRequest ? 'no-store' : options?.cache,
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(isReadRequest
        ? {
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
          }
        : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error ${res.status}`);
  }
  return res.json();
};

// --- REAL-TIME LISTENERS INITIALIZATION (Polling) ---

let isPolling = false;

const pollSettings = async () => {
  try {
    const [comments, userOptions] = await Promise.all([
      fetchJson('/settings/comments').catch(() => []),
      fetchJson('/settings/user-options').catch(() => ({ operators: [], bosses: [], operatorOptions: [], bossOptions: [] }))
    ]);
    
    localCommentsCache = Array.isArray(comments) ? comments : [];
    localOperatorsCache = Array.isArray(userOptions?.operators) ? userOptions.operators : [];
    localBossesCache = Array.isArray(userOptions?.bosses) ? userOptions.bosses : [];
    localOperatorOptionsCache = Array.isArray(userOptions?.operatorOptions) ? userOptions.operatorOptions : [];
    localBossOptionsCache = Array.isArray(userOptions?.bossOptions) ? userOptions.bossOptions : [];
    
    notifySettingsSubscribers();
  } catch (err) {
    console.warn("Settings polling warning:", err);
  }
};

const handleSettingsVisibilitySync = () => {
  if (document.visibilityState === 'visible') {
    void pollSettings();
  }
};

const triggerSettingsSync = () => {
  void pollSettings();
};

const startPollingSettings = () => {
  if (isPolling) return;
  isPolling = true;
  triggerSettingsSync();
  
  socket.on('connect', triggerSettingsSync);
  socket.on('settings_changed', triggerSettingsSync);
  socket.on('user_status_changed', triggerSettingsSync);
  socket.on('user_deleted', triggerSettingsSync);

  if (settingsIntervalId === null) {
    settingsIntervalId = window.setInterval(triggerSettingsSync, SETTINGS_SYNC_INTERVAL_MS);
  }

  if (!settingsBrowserListenersAttached) {
    window.addEventListener('online', triggerSettingsSync);
    window.addEventListener('focus', triggerSettingsSync);
    document.addEventListener('visibilitychange', handleSettingsVisibilitySync);
    settingsBrowserListenersAttached = true;
  }
};

const stopPollingSettings = () => {
  if (!isPolling) return;
  isPolling = false;

  socket.off('connect', triggerSettingsSync);
  socket.off('settings_changed', triggerSettingsSync);
  socket.off('user_status_changed', triggerSettingsSync);
  socket.off('user_deleted', triggerSettingsSync);

  if (settingsIntervalId !== null) {
    window.clearInterval(settingsIntervalId);
    settingsIntervalId = null;
  }

  if (settingsBrowserListenersAttached) {
    window.removeEventListener('online', triggerSettingsSync);
    window.removeEventListener('focus', triggerSettingsSync);
    document.removeEventListener('visibilitychange', handleSettingsVisibilitySync);
    settingsBrowserListenersAttached = false;
  }
};

export const setSettingsSyncEnabled = (enabled: boolean) => {
  if (enabled) {
    startPollingSettings();
    return;
  }
  stopPollingSettings();
};

// --- PUBLIC API ---

// Allow components to subscribe to settings changes (comments/operators)
export const subscribeToSettings = (callback: SettingsCallback) => {
  settingsSubscribers.push(callback);
  // Send immediate current state
  const comments = buildGlobalCommentsList();
  const operators = localOperatorsCache;
  const bosses = localBossesCache;
  const operatorOptions = localOperatorOptionsCache;
  const bossOptions = localBossOptionsCache;
  callback(comments, operators, bosses, operatorOptions, bossOptions);

  // Return unsubscribe function
  return () => {
    const index = settingsSubscribers.indexOf(callback);
    if (index > -1) {
      settingsSubscribers.splice(index, 1);
    }
  };
};

export const getAvailableComments = (): string[] => {
  return buildGlobalCommentsList();
};

export const refreshSettings = async (): Promise<void> => {
  await pollSettings();
};

export const getCustomComments = async (): Promise<string[]> => {
  const comments = await fetchJson('/settings/comments');
  return Array.isArray(comments) ? comments : [];
};

export const createCustomComment = async (name: string): Promise<void> => {
  const normalized = String(name || '').trim();
  if (!normalized) return;
  await fetchJson('/settings/comments', {
    method: 'POST',
    body: JSON.stringify({ name: normalized }),
  });
  await pollSettings();
};

export const getAvailableOperators = (): string[] => {
  return localOperatorsCache;
};

export const getAvailableBosses = (): string[] => {
  return localBossesCache;
};

export const getOperatorOptions = (): UserOption[] => {
  return localOperatorOptionsCache;
};

export const getBossOptions = (): UserOption[] => {
  return localBossOptionsCache;
};

export const getMachineFieldSchema = async (machine: MachineType): Promise<MachineFieldSchemaPayload> => {
  return fetchJson(`/settings/machine-fields/${encodeURIComponent(machine)}`);
};

export const saveMachineFieldSchema = async (
  machine: MachineType,
  fields: MachineFieldDefinition[],
  expectedVersion: number
): Promise<MachineFieldSchemaPayload> => {
  return fetchJson(`/settings/machine-fields/${encodeURIComponent(machine)}`, {
    method: 'PUT',
    body: JSON.stringify({ fields, expectedVersion }),
  });
};

export const getMachineFieldSchemaHistory = async (
  machine: MachineType
): Promise<MachineFieldSchemaHistoryItem[]> => {
  return fetchJson(`/settings/machine-fields/${encodeURIComponent(machine)}/history`);
};

export const getFieldCatalog = async (): Promise<FieldCatalogEntry[]> => {
  return fetchJson('/settings/field-catalog');
};

export const createCatalogField = async (data: {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
  defaultValue?: string | number | string[];
  rules?: Record<string, number>;
  machines: MachineType[];
}): Promise<FieldCatalogEntry> => {
  return fetchJson('/settings/field-catalog', {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

export const updateCatalogField = async (
  id: string,
  data: {
    key: string;
    label: string;
    type: string;
    required: boolean;
    options: string[];
    defaultValue?: string | number | string[];
    rules?: Record<string, number>;
    machines: MachineType[];
  }
): Promise<FieldCatalogEntry> => {
  return fetchJson(`/settings/field-catalog/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
};

export const reorderFieldCatalog = async (orderedIds: string[]): Promise<FieldCatalogEntry[]> => {
  return fetchJson('/settings/field-catalog/reorder', {
    method: 'PUT',
    body: JSON.stringify({ orderedIds }),
  });
};

export const deleteCatalogField = async (id: string): Promise<void> => {
  await fetchJson(`/settings/field-catalog/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
};

export const getDashboardConfigs = async (): Promise<DashboardConfig[]> => {
  return fetchJson('/settings/dashboard-configs');
};

export const getDashboardConfig = async (id: string): Promise<DashboardConfig> => {
  return fetchJson(`/settings/dashboard-configs/${encodeURIComponent(id)}`);
};

export const createAdminUser = async (data: AdminCreateUserPayload): Promise<any> => {
  return fetchJson('/admin/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

export const createDashboardConfig = async (data: {
  name: string;
  description?: string;
  baseField?: string;
  relatedFields?: string[];
  widgets: DashboardConfig['widgets'];
  isDefault: boolean;
}): Promise<DashboardConfig> => {
  return fetchJson('/settings/dashboard-configs', {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

export const updateDashboardConfig = async (
  id: string,
  data: {
    name: string;
    description?: string;
    baseField?: string;
    relatedFields?: string[];
    widgets: DashboardConfig['widgets'];
    isDefault: boolean;
  }
): Promise<DashboardConfig> => {
  return fetchJson(`/settings/dashboard-configs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
};

export const deleteDashboardConfig = async (id: string): Promise<void> => {
  await fetchJson(`/settings/dashboard-configs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
};

export const subscribeToMachineFieldSchema = (
  machine: MachineType,
  callback: (schema: MachineFieldSchemaPayload) => void,
  onError?: (error: string) => void
) => {
  let isActive = true;

  const refresh = async () => {
    try {
      const schema = await getMachineFieldSchema(machine);
      if (isActive) {
        callback(schema);
      }
    } catch (error: any) {
      if (isActive && onError) {
        onError(error?.message || 'No se pudo sincronizar el esquema de campos.');
      }
    }
  };

  const onSchemaChanged = (payload: { machine?: string }) => {
    if (!payload?.machine || payload.machine === machine) {
      void refresh();
    }
  };

  void refresh();
  socket.on('connect', refresh);
  socket.on('settings_changed', refresh);
  socket.on('machine_schema_changed', onSchemaChanged);

  return () => {
    isActive = false;
    socket.off('connect', refresh);
    socket.off('settings_changed', refresh);
    socket.off('machine_schema_changed', onSchemaChanged);
  };
};

export interface SaveResult {
  /** True when the record could not reach the server and was queued
   *  in localStorage for later synchronization. */
  offline?: boolean;
}

export const saveRecord = async (
  record: ProductionRecord,
  userId?: string
): Promise<SaveResult> => {
  // If no network at all, queue immediately without even trying
  if (!navigator.onLine) {
    if (userId) addToQueue(userId, record);
    return { offline: true };
  }

  try {
    const overflowCandidates = findInt32OverflowCandidates(record);
    console.groupCollapsed('[saveRecord] POST /api/records payload');
    console.log('record.id:', record.id);
    console.log('record.machine:', record.machine);
    console.log('record.schemaVersionUsed:', record.schemaVersionUsed);
    console.log('record.timestamp:', record.timestamp);
    console.log('record payload:', record);
    if (overflowCandidates.length > 0) {
      console.warn('Potential int32 overflow candidates in payload:', overflowCandidates);
    } else {
      console.log('No int32 overflow candidates detected in frontend payload.');
    }
    console.groupEnd();

    // 1. Save the record to PostgreSQL
    await fetchJson('/records', {
      method: 'POST',
      body: JSON.stringify(record),
    });

    // 2. Handle Custom Comments
    if (record.changesComment) {
      await fetchJson('/settings/comments', {
        method: 'POST',
        body: JSON.stringify({ name: record.changesComment, skipAudit: true }),
      }).catch(err => console.warn("Failed to add comment:", err));
    }

    // Trigger a poll to update caches
    pollSettings();
    return {};

  } catch (e: any) {
    console.error("Error saving record:", e);
    const overflowCandidates = findInt32OverflowCandidates(record);
    console.groupCollapsed('[saveRecord] POST /api/records failed');
    console.error('Backend error message:', e?.message || e);
    console.log('record.id:', record.id);
    console.log('record.machine:', record.machine);
    console.log('record.schemaVersionUsed:', record.schemaVersionUsed);
    console.log('record.timestamp:', record.timestamp);
    console.log('record payload:', record);
    if (overflowCandidates.length > 0) {
      console.warn('Potential int32 overflow candidates in payload:', overflowCandidates);
    }
    console.groupEnd();

    // On network / connectivity errors: queue locally instead of showing an error
    const isConnectivityError =
      !navigator.onLine ||
      e.message?.includes('Failed to fetch') ||
      e.message?.includes('NetworkError') ||
      e.message?.includes('Network request failed') ||
      e.message?.includes('Load failed');

    if (isConnectivityError && userId) {
      addToQueue(userId, record);
      return { offline: true };
    }

    throw e;
  }
};

export const deleteRecord = async (id: string): Promise<void> => {
  try {
    await fetchJson(`/records/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  } catch (e) {
    console.error("Error deleting record:", e);
    alert("Error al borrar. Verifique su conexión.");
  }
};

// --- COMMENT MANAGEMENT ---
export const deleteCustomComment = async (commentToDelete: string): Promise<void> => {
  try {
    await fetchJson(`/settings/comments/${encodeURIComponent(commentToDelete)}`, {
      method: 'DELETE'
    });
    await pollSettings();
  } catch (e) {
    console.error("Error deleting comment:", e);
    throw new Error("No se pudo borrar la incidencia.");
  }
};

export const renameCustomComment = async (oldName: string, newName: string): Promise<void> => {
  if (!oldName || !newName || oldName === newName) return;
  try {
    await fetchJson(`/settings/comments/${encodeURIComponent(oldName)}`, {
      method: 'PUT',
      body: JSON.stringify({ newName })
    });
    await pollSettings();
  } catch (e) {
    console.error("Error renaming comment globally:", e);
    throw new Error("No se pudo renombrar el comentario.");
  }
};

// --- OPERATOR MANAGEMENT ---
export const deleteCustomOperator = async (operatorToDelete: string): Promise<void> => {
  try {
    await fetchJson(`/settings/operators/${encodeURIComponent(operatorToDelete)}`, {
      method: 'DELETE'
    });
    pollSettings();
  } catch (e) {
    console.error("Error deleting operator:", e);
  }
};

export const renameCustomOperator = async (oldName: string, newName: string): Promise<void> => {
  if (!oldName || !newName || oldName === newName) return;
  try {
    await fetchJson(`/settings/operators/${encodeURIComponent(oldName)}`, {
      method: 'PUT',
      body: JSON.stringify({ newName })
    });
    pollSettings();
  } catch (e) {
    console.error("Error renaming operator globally:", e);
    throw new Error("No se pudo renombrar el operario.");
  }
};

export const clearAllRecords = async (): Promise<void> => {
  try {
    await fetchJson('/records', {
      method: 'DELETE'
    });
  } catch (e) {
    console.error("Error clearing records:", e);
    throw e;
  }
};

export const subscribeToRecords = (
  callback: (records: ProductionRecord[]) => void,
  onError?: (errorMsg: string) => void
) => {
  let isSubscribed = true;

  const fetchRecords = async () => {
    try {
      const records = await fetchJson('/records');
      
      // Sort locally to ensure records without timestamp are still loaded
      records.sort((a: any, b: any) => {
        const timeA = a.timestamp || new Date(a.date || 0).getTime();
        const timeB = b.timestamp || new Date(b.date || 0).getTime();
        return timeB - timeA;
      });
      
      if (isSubscribed) {
        localRecordsCache = records;
        callback(records);
        if (onError) onError('');
      }
    } catch (error: any) {
      console.error("API Error:", error);
      let msg = "Error de conexión con la base de datos.";
      if (error.message === 'Database unavailable') msg = "Servicio no disponible (Offline).";
      if (isSubscribed && onError) onError(msg);
    }
  };

  const triggerRecordsSync = () => {
    void fetchRecords();
  };

  const handleVisibilitySync = () => {
    if (document.visibilityState === 'visible') {
      triggerRecordsSync();
    }
  };

  triggerRecordsSync();
  
  const handleConnect = () => {
    if (onError) onError('');
    triggerRecordsSync();
  };
  
  const handleDisconnect = () => {
    if (onError) onError('Desconectado del servidor en tiempo real.');
  };

  const intervalId = window.setInterval(triggerRecordsSync, RECORDS_SYNC_INTERVAL_MS);

  socket.on('records_changed', triggerRecordsSync);
  socket.on('connect', handleConnect);
  socket.on('disconnect', handleDisconnect);
  window.addEventListener('online', triggerRecordsSync);
  window.addEventListener('focus', triggerRecordsSync);
  document.addEventListener('visibilitychange', handleVisibilitySync);

  return () => {
    isSubscribed = false;
    window.clearInterval(intervalId);
    socket.off('records_changed', triggerRecordsSync);
    socket.off('connect', handleConnect);
    socket.off('disconnect', handleDisconnect);
    window.removeEventListener('online', triggerRecordsSync);
    window.removeEventListener('focus', triggerRecordsSync);
    document.removeEventListener('visibilitychange', handleVisibilitySync);
  };
};

// --- IMPORT / EXPORT ---

export const exportAllData = async () => {
  try {
    const data = await fetchJson('/export');
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Pigmea_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Error exporting all data:", e);
    alert("Error al exportar los datos.");
  }
};

export const importAllData = async (file: File): Promise<void> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);
        
        await fetchJson('/import', {
          method: 'POST',
          body: JSON.stringify(data)
        });
        
        pollSettings();
        resolve();
      } catch (err) {
        console.error("Error parsing or importing file:", err);
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
};

const METER_EXPORT_ALIASES = ['metros', 'metro', 'meters'];
const CHANGE_EXPORT_ALIASES = ['cambiopedido', 'cambio_pedido', 'cambios', 'changescount', 'changes'];
const normalizeExportKey = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const resolveExportAlias = (record: ProductionRecord, aliases: string[], coreFallback: number): number => {
  const aliasSet = new Set(aliases.map(normalizeExportKey));
  for (const [k, v] of Object.entries(record.dynamicFieldsValues || {})) {
    if (aliasSet.has(normalizeExportKey(k))) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return coreFallback;
};

export const exportToExcel = (records: ProductionRecord[]) => {
  const data = records.map(r => ({
    'Fecha': r.date,
    'Turno': r.shift,
    'Jefe de Turno': r.boss,
    'Máquina': r.machine,
    'Operario': r.operator || '',
    'Metros': resolveExportAlias(r, METER_EXPORT_ALIASES, r.meters),
    'Cambios': resolveExportAlias(r, CHANGE_EXPORT_ALIASES, r.changesCount),
    'Comentarios/Incidencias': r.changesComment
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Producción");
  
  const wscols = [
    {wch: 12}, {wch: 10}, {wch: 15}, {wch: 10}, {wch: 15}, {wch: 12}, {wch: 10}, {wch: 30}
  ];
  worksheet['!cols'] = wscols;

  XLSX.writeFile(workbook, `Reporte_Produccion_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

export const exportToPDF = (records: ProductionRecord[]) => {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.setTextColor(40);
  doc.text("Reporte de Producción - Registro Jefe de Turnos", 14, 22);
  
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`Fecha de generación: ${new Date().toLocaleDateString()}`, 14, 30);

  const tableColumn = ["Fecha", "Turno", "Jefe", "Máquina", "Operario", "Mts", "Cambios", "Incidencias"];
  const tableRows = records.map(r => [
    r.date,
    r.shift,
    r.boss,
    r.machine,
    r.operator || '-',
    resolveExportAlias(r, METER_EXPORT_ALIASES, r.meters).toLocaleString(),
    resolveExportAlias(r, CHANGE_EXPORT_ALIASES, r.changesCount),
    r.changesComment
  ]);

  (doc as any).autoTable({
    head: [tableColumn],
    body: tableRows,
    startY: 40,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [41, 128, 185], textColor: 255 }, 
    alternateRowStyles: { fillColor: [245, 245, 245] }
  });

  doc.save(`Reporte_Produccion_${new Date().toISOString().slice(0, 10)}.pdf`);
};

export const reconnectDatabase = async () => {
  // Try to fetch records to test connection
  try {
    await fetchJson('/records');
    console.log("Network enabled successfully");
  } catch (e) {
    console.error("Error enabling network:", e);
  }
};