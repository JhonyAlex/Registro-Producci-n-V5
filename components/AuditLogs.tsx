import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, Filter, Calendar, User, Activity, ShieldAlert, ChevronLeft, ChevronRight } from 'lucide-react';

interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  details: Record<string, any> | null;
  ip_address: string | null;
  created_at: string;
  user_name: string | null;
  user_operator_code: string | null;
  user_role: string | null;
}

interface FilterUser {
  id: string;
  name: string;
  operator_code: string;
  role: string;
}

interface AuditResponse {
  logs: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  filters: {
    actions: string[];
    users: FilterUser[];
  };
}

const roleLabel = (role: string | null) => {
  if (!role) return 'Sistema';
  const labels: Record<string, string> = {
    admin: 'Administrador',
    jefe_planta: 'Jefe de Planta',
    jefe_turno: 'Jefe de Turno',
    operario: 'Operario'
  };
  return labels[role] || role;
};

const actionLabel = (action: string) => {
  const labels: Record<string, string> = {
    login_success: 'Inicio de sesión',
    login_failed: 'Login fallido',
    logout: 'Cierre de sesión',
    session_timeout: 'Sesión expirada',
    user_registered: 'Usuario registrado',
    user_approved: 'Usuario aprobado',
    user_unlocked: 'Usuario desbloqueado',
    account_locked: 'Cuenta bloqueada',
    record_upserted: 'Registro creado/actualizado',
    record_deleted: 'Registro eliminado',
    records_cleared: 'Registros eliminados',
    comment_added: 'Comentario agregado',
    comment_deleted: 'Comentario eliminado',
    comment_renamed: 'Comentario renombrado',
    operator_added: 'Operario agregado',
    operator_deleted: 'Operario eliminado',
    operator_renamed: 'Operario renombrado',
    backup_exported: 'Backup exportado',
    backup_imported: 'Backup importado'
  };
  return labels[action] || action.replace(/_/g, ' ');
};

const formatDetails = (details: Record<string, any> | null) => {
  if (!details || Object.keys(details).length === 0) return '-';
  try {
    return JSON.stringify(details);
  } catch {
    return '-';
  }
};

const AuditLogs: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [actions, setActions] = useState<string[]>([]);
  const [users, setUsers] = useState<FilterUser[]>([]);

  const [query, setQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [selectedAction, setSelectedAction] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (selectedAction) params.set('action', selectedAction);
    if (selectedUserId) params.set('userId', selectedUserId);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    return params.toString();
  }, [query, selectedAction, selectedUserId, startDate, endDate, page]);

  const fetchLogs = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/audit-logs?${queryString}`, { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudieron cargar los logs de actividad');
      }
      const data: AuditResponse = await res.json();
      setLogs(data.logs || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
      setActions(data.filters?.actions || []);
      setUsers(data.filters?.users || []);
    } catch (err: any) {
      setError(err.message || 'Error inesperado al cargar actividad');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [queryString]);

  const applySearch = () => {
    setPage(1);
    setQuery(searchInput);
  };

  const clearFilters = () => {
    setSearchInput('');
    setQuery('');
    setSelectedAction('');
    setSelectedUserId('');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto bg-slate-50">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Activity className="w-6 h-6 text-blue-600" />
              Registro de Actividad
            </h2>
            <p className="text-slate-500 mt-1">Consulta quién hizo qué acción y cuándo ocurrió.</p>
          </div>
          <button
            onClick={fetchLogs}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Actualizar
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 md:p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
            <div className="xl:col-span-2">
              <label className="block text-xs font-bold text-slate-500 mb-1">Buscar</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applySearch();
                    }}
                    placeholder="Usuario, acción, IP, detalles"
                    className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <button
                  onClick={applySearch}
                  className="px-3 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors"
                >
                  Buscar
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Acción</label>
              <div className="relative">
                <Filter className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <select
                  value={selectedAction}
                  onChange={(e) => {
                    setSelectedAction(e.target.value);
                    setPage(1);
                  }}
                  className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">Todas</option>
                  {actions.map((action) => (
                    <option key={action} value={action}>{actionLabel(action)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Usuario</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <select
                  value={selectedUserId}
                  onChange={(e) => {
                    setSelectedUserId(e.target.value);
                    setPage(1);
                  }}
                  className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">Todos</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.name} ({u.operator_code})</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Desde / Hasta</label>
              <div className="grid grid-cols-2 gap-2">
                <div className="relative">
                  <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      setPage(1);
                    }}
                    className="w-full pl-9 pr-2 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div className="relative">
                  <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      setPage(1);
                    }}
                    className="w-full pl-9 pr-2 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <p className="text-sm text-slate-500">{total} eventos encontrados</p>
            <button
              onClick={clearFilters}
              className="text-sm font-medium text-slate-600 hover:text-slate-900 underline decoration-slate-300"
            >
              Limpiar filtros
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 p-4 rounded-xl flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 flex-shrink-0" />
            <p className="font-medium">{error}</p>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider text-xs">
                  <th className="p-4 font-bold">Cuándo</th>
                  <th className="p-4 font-bold">Quién</th>
                  <th className="p-4 font-bold">Rol</th>
                  <th className="p-4 font-bold">Qué hizo</th>
                  <th className="p-4 font-bold">Detalles</th>
                  <th className="p-4 font-bold">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!loading && logs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">No hay registros para los filtros aplicados.</td>
                  </tr>
                )}

                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors align-top">
                    <td className="p-4 whitespace-nowrap text-slate-600">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="p-4">
                      <div className="font-semibold text-slate-800">{log.user_name || 'Sistema'}</div>
                      <div className="text-xs text-slate-500">{log.user_operator_code || '-'}</div>
                    </td>
                    <td className="p-4 text-slate-600">{roleLabel(log.user_role)}</td>
                    <td className="p-4">
                      <span className="inline-flex px-2 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-100 text-xs font-bold">
                        {actionLabel(log.action)}
                      </span>
                    </td>
                    <td className="p-4 text-slate-600 max-w-md">
                      <div className="line-clamp-2" title={formatDetails(log.details)}>{formatDetails(log.details)}</div>
                    </td>
                    <td className="p-4 text-slate-500 font-mono text-xs">{log.ip_address || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-slate-100 p-4 bg-slate-50 flex items-center justify-between">
            <button
              onClick={() => canGoPrev && setPage((p) => p - 1)}
              disabled={!canGoPrev}
              className="p-2 rounded-lg bg-white border border-slate-200 text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors flex items-center gap-2 text-sm font-bold"
            >
              <ChevronLeft className="w-4 h-4" />
              Anterior
            </button>

            <span className="text-sm text-slate-600">
              Página {page} de {totalPages}
            </span>

            <button
              onClick={() => canGoNext && setPage((p) => p + 1)}
              disabled={!canGoNext}
              className="p-2 rounded-lg bg-white border border-slate-200 text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors flex items-center gap-2 text-sm font-bold"
            >
              Siguiente
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuditLogs;
