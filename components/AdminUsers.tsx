import React, { useState, useEffect } from 'react';
import { CheckCircle, Unlock, ShieldAlert, UserCheck, Clock, Ban, Users, RefreshCw, Trash2, AlertTriangle, Key, History, Search } from 'lucide-react';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { emitAppNotification } from '../services/notificationService';
import { fetchAuditLogsPage } from '../services/storageService';
import { AuditLogEntry } from '../types';

interface AdminUser {
  id: string;
  operator_code: string;
  name: string;
  role: string;
  status: string;
  failed_attempts: number;
  last_login: string | null;
  created_at: string;
}

const AdminUsers: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [userToDelete, setUserToDelete] = useState<AdminUser | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [userToResetPin, setUserToResetPin] = useState<AdminUser | null>(null);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotalPages, setAuditTotalPages] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditSearchInput, setAuditSearchInput] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditRole, setAuditRole] = useState('');

  const AUDIT_ITEMS_PER_PAGE = 15;

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users', { credentials: 'include' });
      if (!res.ok) throw new Error('Error al cargar la lista de usuarios');
      const data = await res.json();
      setUsers(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchAuditLogs = async (page = auditPage, q = auditSearch, role = auditRole) => {
    setAuditLoading(true);
    setAuditError('');
    try {
      const data = await fetchAuditLogsPage(page, AUDIT_ITEMS_PER_PAGE, q, role);
      setAuditLogs(data.logs);
      setAuditTotal(data.total);
      setAuditTotalPages(Math.max(1, data.totalPages || 1));
    } catch (err: any) {
      setAuditError(err.message || 'Error al cargar historial de actividad');
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    
    const socket = io();
    socket.on('new_pending_user', () => {
      fetchUsers();
    });
    socket.on('user_deleted', () => {
      fetchUsers();
    });

    return () => {
      socket.off('new_pending_user');
      socket.off('user_deleted');
    };
  }, []);

  useEffect(() => {
    fetchAuditLogs(auditPage, auditSearch, auditRole);
  }, [auditPage, auditSearch, auditRole]);

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/admin/users/${id}/approve`, { 
        method: 'POST', 
        credentials: 'include' 
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Error al aprobar usuario');
      }
      await fetchUsers();
    } catch (err: any) {
      emitAppNotification(err.message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnlock = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/admin/users/${id}/unlock`, { 
        method: 'POST', 
        credentials: 'include' 
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Error al desbloquear usuario');
      }
      await fetchUsers();
    } catch (err: any) {
      emitAppNotification(err.message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const closeDeleteModal = () => {
    setUserToDelete(null);
    setDeleteConfirmation('');
  };

  const openDeleteModal = (adminUser: AdminUser) => {
    if (currentUser?.id === adminUser.id) {
      emitAppNotification('No puedes eliminar tu propia cuenta mientras estás autenticado.', 'warning');
      return;
    }

    setUserToDelete(adminUser);
    setDeleteConfirmation('');
  };

  const openResetPinModal = (adminUser: AdminUser) => {
    setUserToResetPin(adminUser);
    setNewPin('');
    setConfirmPin('');
  };

  const closeResetPinModal = () => {
    setUserToResetPin(null);
    setNewPin('');
    setConfirmPin('');
  };

  const handleResetPin = async () => {
    if (!userToResetPin) return;

    if (!/^\d{4,6}$/.test(newPin)) {
      emitAppNotification('El PIN debe tener entre 4 y 6 dígitos numéricos.', 'warning');
      return;
    }

    if (newPin !== confirmPin) {
      emitAppNotification('Los PINs no coinciden.', 'warning');
      return;
    }

    setActionLoading(userToResetPin.id);
    try {
      const res = await fetch(`/api/admin/users/${userToResetPin.id}/reset-pin`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_pin: newPin }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Error al restablecer el PIN');
      }

      emitAppNotification(`PIN de ${userToResetPin.name} restablecido correctamente.`, 'success');
      closeResetPinModal();
    } catch (err: any) {
      emitAppNotification(err.message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!userToDelete) {
      return;
    }

    if (deleteConfirmation.trim() !== userToDelete.operator_code) {
      emitAppNotification('Debes escribir exactamente el código del operario para confirmar el borrado.', 'warning');
      return;
    }

    setActionLoading(userToDelete.id);
    try {
      const res = await fetch(`/api/admin/users/${userToDelete.id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Error al eliminar usuario');
      }

      closeDeleteModal();
      await fetchUsers();
    } catch (err: any) {
      emitAppNotification(err.message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
            <CheckCircle className="w-3 h-3" /> Activo
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-200">
            <Clock className="w-3 h-3" /> Pendiente
          </span>
        );
      case 'locked':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
            <Ban className="w-3 h-3" /> Bloqueado
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-800 border border-slate-200">
            {status}
          </span>
        );
    }
  };

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      'admin': 'Administrador',
      'jefe_planta': 'Jefe de Planta',
      'jefe_turno': 'Jefe de Turno',
      'operario': 'Operario'
    };
    return labels[role] || role;
  };

  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      record_created: 'Registro creado',
      record_updated: 'Registro modificado',
      record_deleted: 'Registro eliminado',
      record_bulk_deleted: 'Eliminación masiva de registros',
      user_registered: 'Usuario registrado',
      user_approved: 'Usuario aprobado',
      user_unlocked: 'Usuario desbloqueado',
      user_deleted: 'Usuario eliminado',
      pin_reset: 'PIN restablecido',
      login_success: 'Inicio de sesión',
      login_failed: 'Intento de acceso fallido',
      account_locked: 'Cuenta bloqueada',
      logout: 'Cierre de sesión',
      session_timeout: 'Sesión expirada',
    };
    return labels[action] || action;
  };

  const formatAuditDetails = (details: AuditLogEntry['details']) => {
    if (!details) return '-';
    if (typeof details !== 'object') return String(details);
    return Object.entries(details)
      .slice(0, 4)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(' | ');
  };

  const handleAuditSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setAuditPage(1);
    setAuditSearch(auditSearchInput.trim());
  };

  const clearAuditFilters = () => {
    setAuditSearchInput('');
    setAuditSearch('');
    setAuditRole('');
    setAuditPage(1);
  };

  const isOnlyAdmin = (adminUser: AdminUser) => {
    if (adminUser.role !== 'admin') {
      return false;
    }

    return users.filter((user) => user.role === 'admin').length === 1;
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
          <p className="font-medium">Cargando usuarios...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto bg-slate-50">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-6 h-6 text-blue-600" />
              Gestión de Usuarios
            </h2>
            <p className="text-slate-500 mt-1">Administra los accesos, aprueba nuevos registros, desbloquea cuentas y elimina usuarios con confirmación explícita.</p>
          </div>
          <button 
            onClick={fetchUsers}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Actualizar
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 p-4 rounded-xl flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 flex-shrink-0" />
            <p className="font-medium">{error}</p>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-sm uppercase tracking-wider">
                  <th className="p-4 font-bold">Código</th>
                  <th className="p-4 font-bold">Nombre</th>
                  <th className="p-4 font-bold">Rol</th>
                  <th className="p-4 font-bold">Estado</th>
                  <th className="p-4 font-bold">Último Acceso</th>
                  <th className="p-4 font-bold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">
                      No hay usuarios registrados en el sistema.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-4 font-mono font-medium text-slate-900">{u.operator_code}</td>
                      <td className="p-4 font-medium text-slate-700">{u.name}</td>
                      <td className="p-4 text-slate-600">{getRoleLabel(u.role)}</td>
                      <td className="p-4">
                        <div className="flex flex-col gap-1 items-start">
                          {getStatusBadge(u.status)}
                          {u.failed_attempts > 0 && u.status !== 'locked' && (
                            <span className="text-[10px] text-red-500 font-medium">
                              {u.failed_attempts} intentos fallidos
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 text-sm text-slate-500">
                        {u.last_login ? new Date(u.last_login).toLocaleString() : 'Nunca'}
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {u.status === 'pending' && (
                            <button
                              onClick={() => handleApprove(u.id)}
                              disabled={actionLoading === u.id}
                              className="flex items-center gap-1 px-3 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 font-medium rounded-lg transition-colors disabled:opacity-50"
                              title="Aprobar Usuario"
                            >
                              <UserCheck className="w-4 h-4" />
                              <span className="hidden sm:inline">Aprobar</span>
                            </button>
                          )}
                          {u.status === 'locked' && (
                            <button
                              onClick={() => handleUnlock(u.id)}
                              disabled={actionLoading === u.id}
                              className="flex items-center gap-1 px-3 py-1.5 bg-orange-50 hover:bg-orange-100 text-orange-700 font-medium rounded-lg transition-colors disabled:opacity-50"
                              title="Desbloquear Cuenta"
                            >
                              <Unlock className="w-4 h-4" />
                              <span className="hidden sm:inline">Desbloquear</span>
                            </button>
                          )}
                          {currentUser?.role === 'admin' && (
                            <button
                              onClick={() => openResetPinModal(u)}
                              disabled={actionLoading === u.id}
                              className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium rounded-lg transition-colors disabled:opacity-50"
                              title="Restablecer PIN"
                            >
                              <Key className="w-4 h-4" />
                              <span className="hidden sm:inline">Restablecer</span>
                            </button>
                          )}
                          <button
                            onClick={() => openDeleteModal(u)}
                            disabled={actionLoading === u.id || currentUser?.id === u.id || isOnlyAdmin(u)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title={
                              currentUser?.id === u.id
                                ? 'No puedes eliminar tu propia cuenta'
                                : isOnlyAdmin(u)
                                  ? 'No puedes eliminar al último administrador'
                                  : 'Eliminar Usuario'
                            }
                          >
                            <Trash2 className="w-4 h-4" />
                            <span className="hidden sm:inline">Eliminar</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 border-b border-slate-200">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                  <History className="w-5 h-5 text-indigo-600" />
                  Historial de Actividad
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  Acciones realizadas por operarios, jefes de turno, jefes de planta y administradores.
                </p>
              </div>
              <button
                onClick={() => fetchAuditLogs()}
                className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Actualizar
              </button>
            </div>

            <form onSubmit={handleAuditSearch} className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-2 relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={auditSearchInput}
                  onChange={(e) => setAuditSearchInput(e.target.value)}
                  placeholder="Buscar por nombre, código, acción o detalles"
                  className="w-full rounded-xl border border-slate-300 pl-9 pr-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <select
                value={auditRole}
                onChange={(e) => {
                  setAuditPage(1);
                  setAuditRole(e.target.value);
                }}
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="">Todos los roles</option>
                <option value="operario">Operario</option>
                <option value="jefe_turno">Jefe de Turno</option>
                <option value="jefe_planta">Jefe de Planta</option>
                <option value="admin">Administrador</option>
              </select>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 px-3 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
                >
                  Buscar
                </button>
                <button
                  type="button"
                  onClick={clearAuditFilters}
                  className="px-3 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-medium hover:bg-slate-200 transition-colors"
                >
                  Limpiar
                </button>
              </div>
            </form>
          </div>

          {auditError && (
            <div className="mx-6 mt-4 bg-red-50 border border-red-200 text-red-600 p-3 rounded-xl text-sm">
              {auditError}
            </div>
          )}

          <div className="px-6 py-3 text-sm text-slate-500 border-b border-slate-100">
            {auditTotal} eventos encontrados
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-sm uppercase tracking-wider">
                  <th className="p-4 font-bold">Fecha</th>
                  <th className="p-4 font-bold">Actor</th>
                  <th className="p-4 font-bold">Rol</th>
                  <th className="p-4 font-bold">Acción</th>
                  <th className="p-4 font-bold">Detalles</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLoading ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-500">Cargando historial...</td>
                  </tr>
                ) : auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-500">No hay eventos para los filtros seleccionados.</td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-4 text-sm text-slate-600 whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="p-4 text-sm text-slate-800 font-medium">
                        {log.actor_name || 'Sistema'}
                        {log.actor_operator_code ? (
                          <span className="ml-2 text-xs text-slate-500 font-mono">({log.actor_operator_code})</span>
                        ) : null}
                      </td>
                      <td className="p-4 text-sm text-slate-600">
                        {log.actor_role ? getRoleLabel(log.actor_role) : '-'}
                      </td>
                      <td className="p-4 text-sm text-indigo-700 font-medium">
                        {getActionLabel(log.action)}
                      </td>
                      <td className="p-4 text-sm text-slate-600 max-w-lg truncate" title={formatAuditDetails(log.details)}>
                        {formatAuditDetails(log.details)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {auditTotalPages > 1 && (
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
              <button
                onClick={() => setAuditPage((prev) => Math.max(1, prev - 1))}
                disabled={auditPage === 1}
                className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors"
              >
                Anterior
              </button>
              <span className="text-sm text-slate-600">Página {auditPage} de {auditTotalPages}</span>
              <button
                onClick={() => setAuditPage((prev) => Math.min(auditTotalPages, prev + 1))}
                disabled={auditPage === auditTotalPages}
                className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors"
              >
                Siguiente
              </button>
            </div>
          )}
        </div>

        {userToDelete && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
              <div className="p-6 border-b border-slate-200 bg-red-50">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600 flex-shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Confirmar eliminación de usuario</h3>
                    <p className="text-sm text-slate-600 mt-1">
                      Esta acción eliminará la cuenta, sus permisos y sus relaciones de visibilidad.
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 space-y-1">
                  <p><span className="font-semibold">Nombre:</span> {userToDelete.name}</p>
                  <p><span className="font-semibold">Código:</span> {userToDelete.operator_code}</p>
                  <p><span className="font-semibold">Rol:</span> {getRoleLabel(userToDelete.role)}</p>
                  <p><span className="font-semibold">Estado:</span> {userToDelete.status}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Escribe <span className="font-bold text-slate-900">{userToDelete.operator_code}</span> para confirmar
                  </label>
                  <input
                    type="text"
                    value={deleteConfirmation}
                    onChange={(e) => setDeleteConfirmation(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    placeholder="Código del operario"
                  />
                </div>
              </div>

              <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  onClick={closeDeleteModal}
                  className="px-4 py-2 rounded-lg text-slate-600 font-medium hover:bg-slate-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleDelete}
                  disabled={actionLoading === userToDelete.id || deleteConfirmation.trim() !== userToDelete.operator_code}
                  className="px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Eliminar usuario
                </button>
              </div>
            </div>
          </div>
        )}

        {userToResetPin && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
              <div className="p-6 border-b border-slate-200 bg-blue-50">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0">
                    <Key className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Restablecer PIN de usuario</h3>
                    <p className="text-sm text-slate-600 mt-1">
                      Establece un nuevo PIN para <span className="font-semibold">{userToResetPin.name}</span>. La sesión activa del usuario será invalidada.
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 space-y-1">
                  <p><span className="font-semibold">Nombre:</span> {userToResetPin.name}</p>
                  <p><span className="font-semibold">Código:</span> {userToResetPin.operator_code}</p>
                  <p><span className="font-semibold">Rol:</span> {getRoleLabel(userToResetPin.role)}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Nuevo PIN (4-6 dígitos)</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="••••"
                    maxLength={6}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Confirmar nuevo PIN</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="••••"
                    maxLength={6}
                  />
                </div>
              </div>

              <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  onClick={closeResetPinModal}
                  className="px-4 py-2 rounded-lg text-slate-600 font-medium hover:bg-slate-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleResetPin}
                  disabled={actionLoading === userToResetPin.id || newPin.length < 4 || newPin.length > 6 || newPin !== confirmPin}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Restablecer PIN
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminUsers;
