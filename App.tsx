import React, { useState, useEffect, useMemo, useRef } from 'react';
import { LayoutDashboard, PlusCircle, List, User, Trash2, Lock, AlertCircle, Filter, X, Cloud, WifiOff, CloudOff, Edit, ChevronDown, ChevronUp, Calendar, Monitor, XCircle, FileDown, FileUp, AlertTriangle, Clock, ChevronLeft, ChevronRight, Database, LogOut, Users, History, ShieldCheck, CheckCircle, RefreshCw, Menu } from 'lucide-react';
import ShiftForm from './components/ShiftForm';
import Dashboard from './components/Dashboard';
import Login from './components/Login';
import Register from './components/Register';
import WaitingRoom from './components/WaitingRoom';
import AdminUsers from './components/AdminUsers';
import AuditLogs from './components/AuditLogs';
import RolePermissionsMatrix from './components/RolePermissionsMatrix';
import UserProfile from './components/UserProfile';
import MachineFieldManager from './components/MachineFieldManager';
import DashboardManager from './components/DashboardManager';
import GlobalLockScreenGuard from './components/GlobalLockScreenGuard';
import { AuthProvider, useAuth } from './context/AuthContext';
import { subscribeToRecords, subscribeToSettings, clearAllRecords, deleteRecord, exportToExcel, exportAllData, importAllData, reconnectDatabase } from './services/storageService';
import { getQueueCount, flushQueue, onQueueChanged } from './services/offlineQueue';
import { socket } from './services/socket';
import { ProductionRecord, FilterState } from './types';
import { MACHINES } from './constants';

type View = 'dashboard' | 'entry' | 'list' | 'profile' | 'admin' | 'audit' | 'permissions' | 'fieldSchemas' | 'dashboardAdmin';
type DeleteMode = 'all' | 'single';

const ITEMS_PER_PAGE = 15;

const AppContent: React.FC = () => {
  const { user, logout } = useAuth();
  const hasPermission = (permissionKey: string) => {
    if (user?.role === 'admin') return true;
    return Boolean(user?.permissions?.some((perm) => perm.key === permissionKey));
  };
  const canAccessUsers = (user?.role === 'admin' || user?.role === 'jefe_planta') && hasPermission('admin.users.read');
  const canAccessAudit = (user?.role === 'admin' || user?.role === 'jefe_planta') && hasPermission('admin.audit.read');
  const canAccessPermissionsMatrix = user?.role === 'admin';
  const canAccessFieldSchemas = (user?.role === 'admin' || user?.role === 'jefe_planta') && hasPermission('settings.field_schemas');
  const canAccessDashboardManager = (user?.role === 'admin' || user?.role === 'jefe_planta') && hasPermission('settings.dashboards');

  const [currentView, setCurrentView] = useState<View>('entry');
  const [records, setRecords] = useState<ProductionRecord[]>([]);
  const [availableBosses, setAvailableBosses] = useState<string[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [dbError, setDbError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Offline sync state ---
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const isSyncingRef = useRef(false);

  const doSync = async (userId: string) => {
    if (!navigator.onLine || isSyncingRef.current || getQueueCount(userId) === 0) return;
    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
      const result = await flushQueue(userId);
      setPendingSyncCount(getQueueCount(userId));
      if (result.synced > 0) {
        const n = result.synced;
        setSyncMessage(`✓ ${n} registro${n > 1 ? 's' : ''} sincronizado${n > 1 ? 's' : ''} correctamente`);
        setTimeout(() => setSyncMessage(''), 5000);
      }
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  };
  
  // Edit Mode State
  const [editingRecord, setEditingRecord] = useState<ProductionRecord | null>(null);
  
  // Filtering State
  const [filters, setFilters] = useState<FilterState>({
    startDate: '',
    endDate: '',
    machine: '',
    boss: '',
    operator: ''
  });
  const [showFilters, setShowFilters] = useState(false);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);

  // More Panel State (mobile/tablet)
  const [showMorePanel, setShowMorePanel] = useState(false);

  // Delete Modal State
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteMode, setDeleteMode] = useState<DeleteMode>('all');
  const [deleteAllStep, setDeleteAllStep] = useState<1 | 2>(1); // 1: Export Warning, 2: Final Confirmation
  const [recordToDelete, setRecordToDelete] = useState<string | null>(null);
  
  // Real-time synchronization
  useEffect(() => {
    const unsubscribe = subscribeToRecords(
      (updatedRecords) => {
        setRecords(updatedRecords);
        // If we get data, we are connected
        if (dbError && dbError.includes('Offline')) setDbError(''); 
      },
      (errorMsg) => {
        setDbError(errorMsg);
      }
    );

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Track pending queue count for current user
  useEffect(() => {
    if (!user) {
      setPendingSyncCount(0);
      return;
    }
    setPendingSyncCount(getQueueCount(user.id));
    return onQueueChanged(() => setPendingSyncCount(getQueueCount(user.id)));
  }, [user?.id]);

  // Auto-sync when online or authenticated (surviving session expiry)
  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    void doSync(userId);
    const handleOnlineSync = () => void doSync(userId);
    window.addEventListener('online', handleOnlineSync);
    socket.on('connect', handleOnlineSync);
    return () => {
      window.removeEventListener('online', handleOnlineSync);
      socket.off('connect', handleOnlineSync);
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const unsubscribe = subscribeToSettings((_comments, _operators, bosses) => {
      setAvailableBosses(bosses);
      setFilters((prev) => (prev.boss && !bosses.includes(prev.boss) ? { ...prev, boss: '' } : prev));
    });

    return () => unsubscribe();
  }, []);

  // Calculate unique operators from existing records for the filter dropdown
  const uniqueOperators = useMemo(() => {
    const ops = new Set(records.map(r => r.operator).filter(Boolean));
    return Array.from(ops).sort();
  }, [records]);

  // Filter Logic
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      const matchDate = (!filters.startDate || r.date >= filters.startDate) && 
                        (!filters.endDate || r.date <= filters.endDate);
      const matchMachine = !filters.machine || r.machine === filters.machine;
      const matchBoss = !filters.boss || r.boss === filters.boss;
      const matchOperator = !filters.operator || r.operator === filters.operator;
      return matchDate && matchMachine && matchBoss && matchOperator;
    });
  }, [records, filters]);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  // Pagination Logic
  const totalPages = Math.ceil(filteredRecords.length / ITEMS_PER_PAGE);
  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredRecords.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredRecords, currentPage]);

  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      // Scroll to top of list container if needed, or just top of window
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Count active filters
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filters.startDate) count++;
    if (filters.endDate) count++;
    if (filters.machine) count++;
    if (filters.boss) count++;
    if (filters.operator) count++;
    return count;
  }, [filters]);

  const handleRecordSaved = () => {
    setEditingRecord(null);
  };

  const handleEdit = (record: ProductionRecord) => {
    setEditingRecord(record);
    setCurrentView('entry');
  };

  const handleCancelEdit = () => {
    setEditingRecord(null);
  };

  const initiateDeleteAll = () => {
    setDeleteMode('all');
    setDeleteAllStep(1); 
    setRecordToDelete(null);
    setShowDeleteModal(true);
  };

  const initiateDeleteSingle = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click
    setDeleteMode('single');
    setRecordToDelete(id);
    setShowDeleteModal(true);
  };

  const handleExportAndContinue = () => {
    exportToExcel(records);
    setDeleteAllStep(2);
  };

  const handleConfirmDelete = () => {
    if (deleteMode === 'all') {
      clearAllRecords();
    } else if (deleteMode === 'single' && recordToDelete) {
      deleteRecord(recordToDelete);
    }
    closeDeleteModal();
  };

  const closeDeleteModal = () => {
    setShowDeleteModal(false);
    setRecordToDelete(null);
    setDeleteAllStep(1);
  };

  const clearFilters = () => {
    setFilters({ startDate: '', endDate: '', machine: '', boss: '', operator: '' });
    setShowFilters(false);
  };

  const applyDateShortcut = (type: 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'lastYear' | 'last3Months') => {
    const today = new Date();
    let start = new Date(today);
    let end = new Date(today);

    const formatDate = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    switch (type) {
      case 'today': break;
      case 'yesterday':
        start.setDate(today.getDate() - 1);
        end.setDate(today.getDate() - 1);
        break;
      case 'thisWeek':
        const dayOfWeek = today.getDay() || 7; 
        start.setDate(today.getDate() - dayOfWeek + 1); 
        break;
      case 'lastWeek':
        const dayCurrent = today.getDay() || 7;
        start.setDate(today.getDate() - dayCurrent - 6); 
        end.setDate(today.getDate() - dayCurrent); 
        break;
      case 'thisMonth':
        start.setDate(1);
        end = new Date(today.getFullYear(), today.getMonth() + 1, 0); 
        break;
      case 'lastMonth':
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        end = new Date(today.getFullYear(), today.getMonth(), 0);
        break;
      case 'thisYear':
        start = new Date(today.getFullYear(), 0, 1);
        end = new Date(today.getFullYear(), 11, 31);
        break;
      case 'lastYear':
        start = new Date(today.getFullYear() - 1, 0, 1);
        end = new Date(today.getFullYear() - 1, 11, 31);
        break;
      case 'last3Months':
        start.setMonth(today.getMonth() - 3);
        break;
    }

    setFilters(prev => ({
      ...prev,
      startDate: formatDate(start),
      endDate: formatDate(end)
    }));
  };

  const changeView = (view: View) => {
    setCurrentView(view);
    if (view !== 'entry') {
      setEditingRecord(null);
    } else if (currentView !== 'entry') {
      setEditingRecord(null);
    }
  };

  const isConnectionLost = !isOnline || (dbError && dbError.includes('Offline'));

  // Safe wrapper for showPicker to handle security restrictions
  const safeShowPicker = (e: React.MouseEvent<HTMLInputElement>) => {
    try {
      if ('showPicker' in e.target) {
        (e.target as any).showPicker();
      }
    } catch (err) {
      // Silently fail if showPicker is blocked by security context (e.g. cross-origin iframe)
      // The user can still click the calendar icon provided by the browser
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      await importAllData(file);
      alert('Datos importados correctamente. La página se recargará.');
      window.location.reload();
    } catch (err) {
      alert('Error al importar los datos. Verifique el formato del archivo.');
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const NavItem = ({ view, icon: Icon, label, mobileOnly = false }: { view: View; icon: any; label: string, mobileOnly?: boolean }) => (
    <button
      onClick={() => changeView(view)}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all w-full xl:w-auto 
        ${mobileOnly ? 'flex-col gap-1 py-1 px-1 justify-center' : ''}
        ${currentView === view 
          ? 'bg-blue-600 text-white shadow-md' 
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
      }`}
    >
      <Icon className={`${mobileOnly ? 'w-6 h-6' : 'w-5 h-5'}`} />
      <span className={`${mobileOnly ? 'text-[10px]' : 'font-medium'}`}>{label}</span>
    </button>
  );

  return (
    <div className="min-h-screen flex flex-col xl:flex-row bg-slate-50 relative">
      {/* ---- Offline / Sync Banner ---- */}
      {(!isOnline || isSyncing || syncMessage) && (
        <div
          className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold shadow-lg
            ${
              syncMessage
                ? 'bg-green-500 text-white'
                : isSyncing
                ? 'bg-blue-600 text-white'
                : 'bg-amber-500 text-white'
            }`}
        >
          {syncMessage ? (
            <><CheckCircle className="w-4 h-4 flex-shrink-0" /><span>{syncMessage}</span></>
          ) : isSyncing ? (
            <><RefreshCw className="w-4 h-4 flex-shrink-0 animate-spin" /><span>Sincronizando registros pendientes…</span></>
          ) : (
            <>
              <WifiOff className="w-4 h-4 flex-shrink-0" />
              <span>
                Sin conexión — puede seguir registrando
                {pendingSyncCount > 0 && ` · ${pendingSyncCount} registro${pendingSyncCount > 1 ? 's' : ''} pendiente${pendingSyncCount > 1 ? 's' : ''} de sincronizar`}
              </span>
            </>
          )}
        </div>
      )}

      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        accept=".json" 
        className="hidden" 
      />
      
      <aside className="hidden xl:flex bg-white border-r border-slate-200 w-64 flex-shrink-0 z-20 h-screen sticky top-0 flex-col">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-blue-900/50">
            R
          </div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight leading-tight">Registro Producción<br/>Pigmea</h1>
        </div>
        
        <div className="p-4 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold">
              {user?.name?.charAt(0).toUpperCase()}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-bold text-slate-800 truncate">{user?.name}</p>
              <p className="text-xs text-slate-500 truncate capitalize">{user?.role.replace('_', ' ')}</p>
            </div>
          </div>
        </div>

        <nav className="p-4 flex flex-col gap-1 flex-1">
          <NavItem view="entry" icon={PlusCircle} label="Registro" />
          <NavItem view="dashboard" icon={LayoutDashboard} label="Dashboard" />
          <NavItem view="list" icon={List} label="Historial" />
          <NavItem view="profile" icon={User} label="Mi Perfil" />
          
          {(canAccessUsers || canAccessAudit || canAccessPermissionsMatrix || canAccessFieldSchemas || canAccessDashboardManager) && (
            <>
              <div className="mt-8 mb-2 px-4">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Administración</h3>
              </div>
              {canAccessUsers && <NavItem view="admin" icon={Users} label="Usuarios" />}
              {canAccessAudit && <NavItem view="audit" icon={History} label="Actividad" />}
              {canAccessFieldSchemas && <NavItem view="fieldSchemas" icon={Monitor} label="Campos" />}
              {canAccessDashboardManager && <NavItem view="dashboardAdmin" icon={LayoutDashboard} label="Dashboards" />}
              {canAccessPermissionsMatrix && <NavItem view="permissions" icon={ShieldCheck} label="Permisos" />}
            </>
          )}
          
          <div className="mt-8 mb-2 px-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Datos</h3>
          </div>
          <button
            onClick={exportAllData}
            className="flex items-center gap-3 px-4 py-3 rounded-lg transition-all w-full text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <Database className="w-5 h-5" />
            <span className="font-medium">Exportar Backup</span>
          </button>
          <button
            onClick={handleImportClick}
            className="flex items-center gap-3 px-4 py-3 rounded-lg transition-all w-full text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <FileUp className="w-5 h-5" />
            <span className="font-medium">Importar Backup</span>
          </button>
        </nav>
        
        <div className="mt-auto p-6">
          <button
            onClick={logout}
            className="w-full mb-4 flex items-center justify-center gap-2 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 font-bold rounded-lg transition-colors border border-red-100"
          >
            <LogOut className="w-4 h-4" />
            Cerrar Sesión
          </button>
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
            <p className="text-xs text-slate-500 font-medium">Estado del Sistema</p>
            <div className={`mt-2 flex items-center gap-2 text-xs font-bold ${
              dbError ? 'text-red-500'
              : !isOnline ? 'text-amber-500'
              : pendingSyncCount > 0 ? 'text-blue-500'
              : 'text-green-600'
            }`}>
              {dbError ? (
                <><AlertCircle className="w-4 h-4" /><span>Error Config</span></>
              ) : !isOnline ? (
                <><WifiOff className="w-4 h-4" /><span>Sin Conexión</span></>
              ) : pendingSyncCount > 0 ? (
                <><RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} /><span>{pendingSyncCount} pendiente{pendingSyncCount > 1 ? 's' : ''}</span></>
              ) : (
                <><Cloud className="w-4 h-4" /><span>Nube Activa</span></>
              )}
            </div>
            <p className="text-[10px] text-slate-400 mt-1 leading-tight">
              {dbError
                ? 'Requiere atención.'
                : !isOnline
                ? 'Guardando localmente.'
                : pendingSyncCount > 0
                ? 'Sincronizando al reconectar.'
                : 'Sincronización en tiempo real.'
              }
            </p>
            {dbError && (
              <button 
                onClick={() => reconnectDatabase()}
                className="mt-3 w-full py-1.5 bg-white border border-slate-200 rounded text-[10px] font-bold text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Reconectar
              </button>
            )}
          </div>
        </div>
      </aside>

      <main className="flex-1 p-4 xl:p-8 overflow-y-auto h-screen pb-28 xl:pb-8">
        <div className="max-w-6xl mx-auto space-y-6">
            {dbError && !dbError.includes('Offline') && (
              <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r shadow-sm animate-fade-in mb-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start">
                  <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 mr-3 flex-shrink-0" />
                  <div>
                    <h3 className="text-sm font-bold text-red-800">Acción Requerida: Configuración de Base de Datos</h3>
                    <p className="text-sm text-red-700 mt-1">{dbError}</p>
                  </div>
                </div>
                <button 
                  onClick={() => reconnectDatabase()}
                  className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold rounded transition-colors"
                >
                  Reconectar
                </button>
              </div>
            </div>
          )}

          {currentView === 'admin' && canAccessUsers && (
            <AdminUsers />
          )}

          {currentView === 'audit' && canAccessAudit && (
            <AuditLogs />
          )}

          {currentView === 'permissions' && canAccessPermissionsMatrix && (
            <RolePermissionsMatrix />
          )}

          {currentView === 'fieldSchemas' && canAccessFieldSchemas && (
            <MachineFieldManager />
          )}

          {currentView === 'dashboardAdmin' && canAccessDashboardManager && (
            <DashboardManager records={filteredRecords} />
          )}

          {currentView === 'profile' && (
            <UserProfile />
          )}

          {(currentView === 'dashboard' || currentView === 'list') && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 animate-fade-in-up overflow-visible transition-all duration-300">
              <div 
                className="p-4 flex justify-between items-center cursor-pointer bg-white hover:bg-slate-50 transition-colors"
                onClick={() => setShowFilters(!showFilters)}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg transition-colors ${showFilters || activeFiltersCount > 0 ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                    <Filter className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                      Filtros de Datos
                      {activeFiltersCount > 0 && (
                        <span className="bg-blue-600 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">
                          {activeFiltersCount} Activos
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-slate-400 hidden sm:block">
                      {showFilters ? 'Configura los criterios de búsqueda' : 'Haz clic para desplegar opciones'}
                    </p>
                  </div>
                </div>
                <div className="text-slate-400">
                  {showFilters ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </div>
              </div>
              
              {showFilters && (
                <div className="p-5 border-t border-slate-100 bg-slate-50/50">
                  
                  <div className="mb-4 flex gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-400 flex items-center gap-1 mr-2">
                      <Clock className="w-3 h-3" /> Accesos rápidos:
                    </span>
                    <button onClick={() => applyDateShortcut('today')} className="text-xs px-3 py-1 bg-white border border-slate-200 rounded-full hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors text-slate-600 font-medium">Hoy</button>
                    <button onClick={() => applyDateShortcut('yesterday')} className="text-xs px-3 py-1 bg-white border border-slate-200 rounded-full hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors text-slate-600 font-medium">Ayer</button>
                    <button onClick={() => applyDateShortcut('thisWeek')} className="text-xs px-3 py-1 bg-white border border-slate-200 rounded-full hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors text-slate-600 font-medium">Esta Sem.</button>
                    <button onClick={() => applyDateShortcut('lastWeek')} className="text-xs px-3 py-1 bg-white border border-slate-200 rounded-full hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors text-slate-600 font-medium">Sem. Ant.</button>
                    <button onClick={() => applyDateShortcut('thisMonth')} className="text-xs px-3 py-1 bg-white border border-slate-200 rounded-full hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors text-slate-600 font-medium">Este Mes</button>
                    <button onClick={() => applyDateShortcut('lastMonth')} className="text-xs px-3 py-1 bg-white border border-slate-200 rounded-full hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors text-slate-600 font-medium">Mes Pasado</button>
                    <button onClick={() => applyDateShortcut('last3Months')} className="text-xs px-3 py-1 bg-white border border-slate-200 rounded-full hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors text-slate-600 font-medium">3 Meses</button>
                    <button onClick={() => applyDateShortcut('thisYear')} className="text-xs px-3 py-1 bg-white border border-slate-200 rounded-full hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors text-slate-600 font-medium">Este Año</button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                    
                    <div className="relative">
                      <label className="block text-xs font-bold text-slate-500 mb-1.5 ml-1">Desde</label>
                      <div className="relative">
                        <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input 
                          type="date" 
                          className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all shadow-sm cursor-pointer"
                          value={filters.startDate} 
                          onChange={e => setFilters({...filters, startDate: e.target.value})}
                          onClick={safeShowPicker}
                        />
                      </div>
                    </div>

                    <div className="relative">
                      <label className="block text-xs font-bold text-slate-500 mb-1.5 ml-1">Hasta</label>
                      <div className="relative">
                        <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input 
                          type="date" 
                          className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all shadow-sm cursor-pointer"
                          value={filters.endDate} 
                          onChange={e => setFilters({...filters, endDate: e.target.value})} 
                          onClick={safeShowPicker}
                        />
                      </div>
                    </div>

                    <div className="relative">
                      <label className="block text-xs font-bold text-slate-500 mb-1.5 ml-1">Máquina</label>
                      <div className="relative">
                        <Monitor className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <select 
                          className="w-full pl-9 pr-8 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all appearance-none shadow-sm cursor-pointer"
                          value={filters.machine} 
                          onChange={e => setFilters({...filters, machine: e.target.value})}
                        >
                          <option value="">Todas</option>
                          {MACHINES.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>

                    <div className="relative">
                      <label className="block text-xs font-bold text-slate-500 mb-1.5 ml-1">Jefe de Turno</label>
                      <div className="relative">
                        <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <select 
                          className="w-full pl-9 pr-8 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all appearance-none shadow-sm cursor-pointer"
                          value={filters.boss} 
                          onChange={e => setFilters({...filters, boss: e.target.value})}
                        >
                          <option value="">Todos</option>
                          {availableBosses.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                        <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>
                    
                    <div className="relative">
                      <label className="block text-xs font-bold text-slate-500 mb-1.5 ml-1">Operario</label>
                      <div className="relative">
                        <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <select 
                          className="w-full pl-9 pr-8 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all appearance-none shadow-sm cursor-pointer"
                          value={filters.operator} 
                          onChange={e => setFilters({...filters, operator: e.target.value})}
                        >
                          <option value="">Todos</option>
                          {uniqueOperators.map(op => <option key={op} value={op}>{op}</option>)}
                        </select>
                        <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>

                    <div className="flex items-end lg:col-span-5">
                       <button 
                         onClick={clearFilters} 
                         disabled={activeFiltersCount === 0}
                         className={`w-full py-2.5 px-4 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-sm border
                           ${activeFiltersCount > 0 
                             ? 'bg-red-50 text-red-600 border-red-100 hover:bg-red-100' 
                             : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                           }`}
                       >
                         <XCircle className="w-4 h-4" />
                         Limpiar Filtros
                       </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {currentView === 'entry' && (
            <div className="animate-fade-in-up">
              <div className="mb-6 flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">
                    {editingRecord ? 'Editar Registro' : 'Registro de Turno'}
                  </h2>
                  <p className="text-slate-500 text-sm">
                    {editingRecord ? 'Modificando datos existentes.' : 'Ingresa los datos de producción.'}
                  </p>
                </div>
                <div className="xl:hidden">
                   <Cloud className="w-5 h-5 text-green-500" />
                </div>
              </div>
              <ShiftForm 
                onRecordSaved={handleRecordSaved} 
                editingRecord={editingRecord}
                onCancelEdit={handleCancelEdit}
              />
              
              {!editingRecord && (
                <div className="mt-8 mb-20 xl:mb-0">
                  <div className="flex justify-between items-end mb-4">
                     <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Últimos Registros</h3>
                     <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                       <span className="w-2 h-2 rounded-full bg-green-500"></span> 
                       Sincronizado
                     </span>
                  </div>
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 divide-y divide-slate-100">
                    {records.slice(0, 3).map(r => (
                      <div key={r.id} className="p-4 flex justify-between items-center cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => handleEdit(r)}>
                        <div>
                          <span className="font-bold text-slate-800 block">{r.machine}</span>
                          <span className="text-xs text-slate-500">{r.shift} • {r.boss}</span>
                        </div>
                        <div className="text-right">
                          {Object.keys(r.dynamicFieldsValues || {}).length > 0
                            ? Object.entries(r.dynamicFieldsValues || {}).slice(0, 2).map(([k, v]) => (
                                <span key={k} className="font-mono font-bold text-blue-600 block text-sm">
                                  {k}: {Array.isArray(v) ? v.join(', ') : String(v)}
                                </span>
                              ))
                            : <>
                                <span className="font-mono font-bold text-blue-600 block">{r.meters.toLocaleString()} m</span>
                                <span className="text-xs text-slate-400">{r.changesCount} cambios</span>
                              </>
                          }
                        </div>
                      </div>
                    ))}
                    {records.length === 0 && (
                      <div className="p-4 text-center text-slate-400 italic text-sm">Sin registros hoy</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {currentView === 'dashboard' && (
            <div className="animate-fade-in">
              <Dashboard
                records={filteredRecords}
                canManageDashboards={canAccessDashboardManager}
                onOpenAdmin={canAccessDashboardManager ? () => changeView('dashboardAdmin') : undefined}
              />
            </div>
          )}

          {currentView === 'list' && (
            <div className="animate-fade-in mb-20 xl:mb-0">
              <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Historial</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm bg-slate-200 px-3 py-1 rounded-full text-slate-600 font-medium inline-block">
                      {filteredRecords.length} registros totales
                    </span>
                    <span className="text-xs text-slate-400">
                      (Página {currentPage} de {totalPages || 1})
                    </span>
                  </div>
                </div>
                
                {records.length > 0 && (
                  <button 
                    onClick={initiateDeleteAll}
                    className="flex items-center gap-2 text-red-600 bg-red-50 hover:bg-red-100 px-4 py-2 rounded-lg transition-colors text-sm font-bold border border-red-100"
                  >
                    <Trash2 className="w-4 h-4" />
                    Borrar Todo
                  </button>
                )}
              </div>
              
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col min-h-[500px]">
                <div className="overflow-x-auto flex-1">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-4">Fecha y Hora</th>
                        <th className="px-6 py-4">Turno</th>
                        <th className="px-6 py-4">Máq.</th>
                        <th className="px-6 py-4">Operario</th>
                        <th className="px-6 py-4 text-right">Metros</th>
                        <th className="px-6 py-4 text-center hidden sm:table-cell">Cambios</th>
                        <th className="px-6 py-4 hidden sm:table-cell">Comentarios</th>
                        <th className="px-6 py-4 text-center">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paginatedRecords.map((r) => (
                        <tr 
                          key={r.id} 
                          onClick={() => handleEdit(r)}
                          className="hover:bg-blue-50 transition-colors group cursor-pointer active:bg-blue-100"
                        >
                          <td className="px-6 py-4 text-slate-600 whitespace-nowrap">
                            <div className="font-bold text-slate-800">
                              {new Date(r.recordedAt || r.timestamp).toLocaleString('es-ES')}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5">Turno: {r.date}</div>
                          </td>
                          <td className="px-6 py-4 text-slate-600 whitespace-nowrap">
                            <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-bold border border-slate-200">
                              {r.shift}
                            </span>
                          </td>
                          <td className="px-6 py-4 font-medium text-slate-800">
                            <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded border border-blue-100 text-xs font-bold">
                              {r.machine}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-slate-600 font-medium">
                            {r.operator || '-'}
                          </td>
                          <td className="px-6 py-4 text-right font-mono text-slate-700">
                            {Object.keys(r.dynamicFieldsValues || {}).length > 0
                              ? <div className="text-left space-y-0.5">
                                  {Object.entries(r.dynamicFieldsValues || {}).map(([k, v]) => (
                                    <div key={k} className="text-xs whitespace-nowrap">
                                      <span className="text-slate-400">{k}:</span>{' '}
                                      <span className="font-medium">{Array.isArray(v) ? v.join(', ') : String(v)}</span>
                                    </div>
                                  ))}
                                </div>
                              : r.meters.toLocaleString()
                            }
                          </td>
                          <td className="px-6 py-4 text-center text-slate-600 hidden sm:table-cell">
                            {Object.keys(r.dynamicFieldsValues || {}).length > 0 ? '—' : r.changesCount}
                          </td>
                          <td className="px-6 py-4 text-slate-500 max-w-xs truncate hidden sm:table-cell" title={r.changesComment}>
                            {r.changesComment}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button 
                                onClick={(e) => { e.stopPropagation(); handleEdit(r); }}
                                className="p-2 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-all"
                                title="Editar registro"
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={(e) => initiateDeleteSingle(r.id, e)}
                                className="p-2 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-full transition-all"
                                title="Borrar registro"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {paginatedRecords.length === 0 && (
                    <div className="p-12 text-center text-slate-400">
                      {records.length > 0 ? 'No hay resultados con los filtros actuales.' : 'Base de datos vacía.'}
                    </div>
                  )}
                </div>

                {/* Pagination Footer */}
                {totalPages > 1 && (
                  <div className="border-t border-slate-100 p-4 bg-slate-50 flex items-center justify-between">
                     <button
                       onClick={() => goToPage(currentPage - 1)}
                       disabled={currentPage === 1}
                       className="p-2 rounded-lg bg-white border border-slate-200 text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors flex items-center gap-2 text-sm font-bold"
                     >
                       <ChevronLeft className="w-4 h-4" />
                       Anterior
                     </button>
                     
                     <div className="text-sm font-medium text-slate-600 hidden sm:block">
                        Página {currentPage} de {totalPages}
                     </div>

                     <button
                       onClick={() => goToPage(currentPage + 1)}
                       disabled={currentPage === totalPages}
                       className="p-2 rounded-lg bg-white border border-slate-200 text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors flex items-center gap-2 text-sm font-bold"
                     >
                       Siguiente
                       <ChevronRight className="w-4 h-4" />
                     </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Bottom Nav — Mobile/Tablet */}
      <nav className="xl:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 pb-safe z-40 flex justify-around items-center px-1 shadow-[0_-4px_10px_rgba(0,0,0,0.05)] h-[70px]">
        <NavItem view="entry" icon={PlusCircle} label="Registro" mobileOnly />
        <NavItem view="dashboard" icon={LayoutDashboard} label="Dashboard" mobileOnly />
        <NavItem view="list" icon={List} label="Historial" mobileOnly />
        <NavItem view="profile" icon={User} label="Mi Perfil" mobileOnly />
        <button
          onClick={() => setShowMorePanel(true)}
          className="flex flex-col items-center gap-1 py-1 px-3 justify-center rounded-lg transition-all text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          <Menu className="w-6 h-6" />
          <span className="text-[10px]">Más</span>
        </button>
      </nav>

      {/* Right Side Panel — opciones adicionales móvil/tablet */}
      {showMorePanel && (
        <>
          {/* Overlay */}
          <div
            className="xl:hidden fixed inset-0 bg-slate-900/50 z-50 backdrop-blur-sm"
            onClick={() => setShowMorePanel(false)}
          />
          {/* Panel */}
          <div className="xl:hidden fixed top-0 right-0 bottom-0 w-72 bg-white z-50 flex flex-col shadow-2xl animate-slide-in-right">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-blue-900/50">R</div>
                <div>
                  <p className="text-sm font-bold text-slate-800 leading-tight">{user?.name}</p>
                  <p className="text-xs text-slate-500 capitalize">{user?.role.replace('_', ' ')}</p>
                </div>
              </div>
              <button
                onClick={() => setShowMorePanel(false)}
                className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-1">
              {(canAccessUsers || canAccessAudit || canAccessPermissionsMatrix || canAccessFieldSchemas || canAccessDashboardManager) && (
                <>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider px-3 pt-2 pb-1">Administración</p>
                  {canAccessUsers && (
                    <button onClick={() => { setShowMorePanel(false); setCurrentView('admin'); }} className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all w-full ${ currentView === 'admin' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100' }`}>
                      <Users className="w-5 h-5" /><span className="font-medium">Usuarios</span>
                    </button>
                  )}
                  {canAccessAudit && (
                    <button onClick={() => { setShowMorePanel(false); setCurrentView('audit'); }} className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all w-full ${ currentView === 'audit' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100' }`}>
                      <History className="w-5 h-5" /><span className="font-medium">Actividad</span>
                    </button>
                  )}
                  {canAccessFieldSchemas && (
                    <button onClick={() => { setShowMorePanel(false); setCurrentView('fieldSchemas'); }} className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all w-full ${ currentView === 'fieldSchemas' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100' }`}>
                      <Monitor className="w-5 h-5" /><span className="font-medium">Campos</span>
                    </button>
                  )}
                  {canAccessDashboardManager && (
                    <button onClick={() => { setShowMorePanel(false); setCurrentView('dashboardAdmin'); }} className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all w-full ${ currentView === 'dashboardAdmin' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100' }`}>
                      <LayoutDashboard className="w-5 h-5" /><span className="font-medium">Dashboards</span>
                    </button>
                  )}
                  {canAccessPermissionsMatrix && (
                    <button onClick={() => { setShowMorePanel(false); setCurrentView('permissions'); }} className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all w-full ${ currentView === 'permissions' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100' }`}>
                      <ShieldCheck className="w-5 h-5" /><span className="font-medium">Permisos</span>
                    </button>
                  )}
                </>
              )}

              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider px-3 pt-4 pb-1">Datos</p>
              <button
                onClick={() => { setShowMorePanel(false); exportAllData(); }}
                className="flex items-center gap-3 px-4 py-3 rounded-lg transition-all w-full text-slate-600 hover:bg-slate-100"
              >
                <Database className="w-5 h-5" /><span className="font-medium">Exportar Backup</span>
              </button>
              <button
                onClick={() => { setShowMorePanel(false); handleImportClick(); }}
                className="flex items-center gap-3 px-4 py-3 rounded-lg transition-all w-full text-slate-600 hover:bg-slate-100"
              >
                <FileUp className="w-5 h-5" /><span className="font-medium">Importar Backup</span>
              </button>
            </div>

            <div className="p-4 border-t border-slate-100">
              <button
                onClick={() => { setShowMorePanel(false); logout(); }}
                className="w-full flex items-center justify-center gap-2 py-3 bg-red-50 hover:bg-red-100 text-red-600 font-bold rounded-lg transition-colors border border-red-100"
              >
                <LogOut className="w-4 h-4" />
                Cerrar Sesión
              </button>
            </div>
          </div>
        </>
      )}

      {/* --- OFFLINE BLOCKING OVERLAY REMOVED --- */}

      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-scale-in">
            {deleteMode === 'all' && deleteAllStep === 1 ? (
              <>
                <div className="bg-yellow-50 p-6 flex flex-col items-center text-center border-b border-yellow-100">
                   <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mb-3 text-yellow-600">
                     <AlertTriangle className="w-6 h-6" />
                   </div>
                   <h3 className="text-lg font-bold text-slate-900">Advertencia de Seguridad</h3>
                   <p className="text-sm text-slate-600 mt-2">
                     Estás a punto de borrar <strong>TODA</strong> la base de datos ({records.length} registros).
                   </p>
                   <p className="text-sm text-slate-500 mt-1">
                     Se recomienda encarecidamente descargar una copia de seguridad en Excel antes de continuar.
                   </p>
                </div>
                <div className="p-6 space-y-3">
                   <button 
                     onClick={handleExportAndContinue}
                     className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-green-600 text-white font-bold hover:bg-green-700 shadow-md transition-colors"
                   >
                     <FileDown className="w-5 h-5" />
                     Descargar Excel
                   </button>
                   
                   <div className="flex gap-3 pt-2">
                     <button 
                       onClick={closeDeleteModal}
                       className="flex-1 px-4 py-3 rounded-lg text-slate-600 font-bold bg-slate-100 hover:bg-slate-200 transition-colors"
                     >
                       Cancelar
                     </button>
                     <button 
                       onClick={() => setDeleteAllStep(2)}
                       className="flex-1 px-4 py-3 rounded-lg text-red-600 font-medium hover:bg-red-50 transition-colors text-sm underline decoration-red-200"
                     >
                       Saltar y Borrar
                     </button>
                   </div>
                </div>
              </>
            ) : deleteMode === 'all' && deleteAllStep === 2 ? (
              <>
                <div className="bg-red-50 p-6 flex flex-col items-center text-center border-b border-red-100">
                  <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-3 text-red-600 animate-pulse">
                    <Trash2 className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-red-900">¿Estás absolutamente seguro?</h3>
                  <p className="text-sm text-red-700 mt-2 font-medium">
                    Esta acción NO se puede deshacer.
                  </p>
                  <p className="text-sm text-red-600 mt-1">
                    Todos los registros se perderán permanentemente.
                  </p>
                </div>
                <div className="p-6 flex gap-3">
                  <button 
                    onClick={closeDeleteModal}
                    className="flex-1 px-4 py-3 rounded-lg text-slate-600 font-bold bg-slate-100 hover:bg-slate-200 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={handleConfirmDelete}
                    className="flex-1 px-4 py-3 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 shadow-lg shadow-red-200 transition-colors"
                  >
                    SÍ, BORRAR TODO
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="bg-slate-50 p-6 flex flex-col items-center text-center border-b border-slate-100">
                  <div className="w-12 h-12 bg-slate-200 rounded-full flex items-center justify-center mb-3 text-slate-500">
                    <Trash2 className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">¿Confirmar eliminación?</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    Este registro se eliminará permanentemente.
                  </p>
                </div>
                <div className="p-6 grid grid-cols-2 gap-3">
                  <button 
                    onClick={closeDeleteModal}
                    className="px-4 py-3 rounded-lg text-slate-600 font-bold hover:bg-slate-100 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={handleConfirmDelete}
                    className="px-4 py-3 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 shadow-md transition-colors"
                  >
                    Borrar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

const App: React.FC = () => {
  const { user, loading } = useAuth();
  const [authView, setAuthView] = useState<'login' | 'register'>('login');

  let appView: React.ReactNode;

  if (loading) {
    appView = (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  } else if (!user) {
    appView = authView === 'login' ? (
      <Login onSwitchToRegister={() => setAuthView('register')} />
    ) : (
      <Register onSwitchToLogin={() => setAuthView('login')} />
    );
  } else if (user.status === 'pending') {
    appView = <WaitingRoom />;
  } else {
    appView = <AppContent />;
  }

  return (
    <>{appView}</>
  );
};

const AppWrapper: React.FC = () => {
  return (
    <AuthProvider>
      <GlobalLockScreenGuard>
        <App />
      </GlobalLockScreenGuard>
    </AuthProvider>
  );
};

export default AppWrapper;