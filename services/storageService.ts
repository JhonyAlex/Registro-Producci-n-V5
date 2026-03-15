import { ProductionRecord } from '../types';
import { COMMON_COMMENTS, COMMON_OPERATORS } from '../constants';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { io } from 'socket.io-client';

const socket = io();

// Local cache to serve synchronous get requests if needed immediately
let localRecordsCache: ProductionRecord[] = [];
let localCommentsCache: string[] = [];
let localOperatorsCache: string[] = [];

// Subscribers for settings updates
type SettingsCallback = (comments: string[], operators: string[]) => void;
const settingsSubscribers: SettingsCallback[] = [];

const notifySettingsSubscribers = () => {
  const comments = localCommentsCache.length > 0 ? localCommentsCache : COMMON_COMMENTS;
  const operators = localOperatorsCache.length > 0 ? localOperatorsCache : COMMON_OPERATORS;
  settingsSubscribers.forEach(cb => cb(comments, operators));
};

// --- API HELPERS ---
const API_BASE = '/api';

const fetchJson = async (url: string, options?: RequestInit) => {
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
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
    const [comments, operators] = await Promise.all([
      fetchJson('/settings/comments').catch(() => []),
      fetchJson('/settings/operators').catch(() => [])
    ]);
    
    localCommentsCache = comments.length > 0 ? comments : COMMON_COMMENTS;
    localOperatorsCache = operators.length > 0 ? operators : COMMON_OPERATORS;
    
    notifySettingsSubscribers();
  } catch (err) {
    console.warn("Settings polling warning:", err);
  }
};

const startPollingSettings = () => {
  if (isPolling) return;
  isPolling = true;
  pollSettings();
  
  socket.on('settings_changed', pollSettings);
};

// Start polling immediately
startPollingSettings();

// --- PUBLIC API ---

// Allow components to subscribe to settings changes (comments/operators)
export const subscribeToSettings = (callback: SettingsCallback) => {
  settingsSubscribers.push(callback);
  // Send immediate current state
  const comments = localCommentsCache.length > 0 ? localCommentsCache : COMMON_COMMENTS;
  const operators = localOperatorsCache.length > 0 ? localOperatorsCache : COMMON_OPERATORS;
  callback(comments, operators);

  // Return unsubscribe function
  return () => {
    const index = settingsSubscribers.indexOf(callback);
    if (index > -1) {
      settingsSubscribers.splice(index, 1);
    }
  };
};

export const getAvailableComments = (): string[] => {
  return localCommentsCache.length > 0 ? localCommentsCache : COMMON_COMMENTS;
};

export const getAvailableOperators = (): string[] => {
  return localOperatorsCache.length > 0 ? localOperatorsCache : COMMON_OPERATORS;
};

export const saveRecord = async (record: ProductionRecord): Promise<void> => {
  try {
    // 1. Save the record to PostgreSQL
    await fetchJson('/records', {
      method: 'POST',
      body: JSON.stringify(record)
    });

    // 2. Handle Custom Comments
    if (record.changesComment) {
      await fetchJson('/settings/comments', {
        method: 'POST',
        body: JSON.stringify({ name: record.changesComment })
      }).catch(err => console.warn("Failed to add comment:", err));
    }

    // 3. Handle Custom Operators & Cleanup Test Data
    if (record.operator) {
      const testOperatorsToRemove = ["Operario 1", "Operario 2"];
      const isTestOp = testOperatorsToRemove.includes(record.operator);
      
      if (!isTestOp) {
         await fetchJson('/settings/operators', {
           method: 'POST',
           body: JSON.stringify({ name: record.operator })
         }).catch(err => console.warn("Failed to add operator:", err));
          
         // Clean up test data if present in our local cache
         const hasTestOps = localOperatorsCache.some(op => testOperatorsToRemove.includes(op));
         if (hasTestOps) {
            for (const testOp of testOperatorsToRemove) {
              await fetchJson(`/settings/operators/${encodeURIComponent(testOp)}`, {
                method: 'DELETE'
              }).catch(() => {});
            }
         }
      } else {
        await fetchJson('/settings/operators', {
          method: 'POST',
          body: JSON.stringify({ name: record.operator })
        }).catch(err => console.warn("Failed to add operator:", err));
      }
    }

    // Trigger a poll to update caches
    pollSettings();

  } catch (e: any) {
    console.error("Error saving record:", e);
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
    pollSettings();
  } catch (e) {
    console.error("Error deleting comment:", e);
  }
};

export const renameCustomComment = async (oldName: string, newName: string): Promise<void> => {
  if (!oldName || !newName || oldName === newName) return;
  try {
    await fetchJson(`/settings/comments/${encodeURIComponent(oldName)}`, {
      method: 'PUT',
      body: JSON.stringify({ newName })
    });
    pollSettings();
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

  fetchRecords();
  
  const handleConnect = () => {
    if (onError) onError('');
    fetchRecords();
  };
  
  const handleDisconnect = () => {
    if (onError) onError('Desconectado del servidor en tiempo real.');
  };

  socket.on('records_changed', fetchRecords);
  socket.on('connect', handleConnect);
  socket.on('disconnect', handleDisconnect);

  return () => {
    isSubscribed = false;
    socket.off('records_changed', fetchRecords);
    socket.off('connect', handleConnect);
    socket.off('disconnect', handleDisconnect);
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

export const exportToExcel = (records: ProductionRecord[]) => {
  const data = records.map(r => ({
    'Fecha': r.date,
    'Turno': r.shift,
    'Jefe de Turno': r.boss,
    'Máquina': r.machine,
    'Operario': r.operator || '',
    'Metros': r.meters,
    'Cambios': r.changesCount,
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
    r.meters.toLocaleString(),
    r.changesCount,
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