import React, { useState, useEffect } from 'react';
import { CheckCircle, Unlock, ShieldAlert, UserCheck, Clock, Ban, Users, RefreshCw, Trash2, Edit3, Key } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { socket } from '../services/socket';
import { createAdminUser } from '../services/storageService';

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

const ROLE_OPTIONS = [
  { value: 'operario', label: 'Operario' },
  { value: 'jefe_turno', label: 'Jefe de Turno' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'jefe_planta', label: 'Jefe de Planta' },
  { value: 'admin', label: 'Administrador' }
] as const;

const AdminUsers: React.FC = () => {
  const { user: currentUser } = useAuth();
  const hasPermission = (permissionKey: string) => {
    if (currentUser?.role === 'admin') return true;
    return Boolean(currentUser?.permissions?.some((perm) => perm.key === permissionKey));
  };

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm, setCreateForm] = useState({
    operator_code: '',
    name: '',
    pin: '',
    role: 'operario'
  });

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

  useEffect(() => {
    fetchUsers();

    const syncUsers = () => {
      void fetchUsers();
    };

    socket.on('connect', syncUsers);
    socket.on('new_pending_user', syncUsers);
    socket.on('user_status_changed', syncUsers);
    socket.on('user_deleted', syncUsers);
    socket.on('settings_changed', syncUsers);

    return () => {
      socket.off('connect', syncUsers);
      socket.off('new_pending_user', syncUsers);
      socket.off('user_status_changed', syncUsers);
      socket.off('user_deleted', syncUsers);
      socket.off('settings_changed', syncUsers);
    };
  }, []);

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
      alert(err.message);
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
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteUser = async (id: string, name: string) => {
    const confirmed = window.confirm(`¿Eliminar al usuario ${name}? Esta acción no se puede deshacer.`);
    if (!confirmed) return;

    setActionLoading(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Error al eliminar usuario');
      }
      await fetchUsers();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleChangePassword = async (target: AdminUser) => {
    const newPin = window.prompt(`Nuevo PIN para ${target.name} (4 dígitos):`, '');
    if (newPin === null) return;
    const cleanPin = newPin.trim();
    if (!cleanPin) {
      alert('El PIN no puede estar vacío.');
      return;
    }
    if (cleanPin.length !== 4) {
      alert('El PIN debe tener 4 dígitos.');
      return;
    }
    if (!/^\d+$/.test(cleanPin)) {
      alert('El PIN debe contener solo números.');
      return;
    }

    setActionLoading(target.id);
    try {
      const res = await fetch(`/api/admin/users/${target.id}/password`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: cleanPin })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Error al cambiar la contraseña');
      }
      alert(`Contraseña de ${target.name} actualizada exitosamente.`);
    } catch (err: any) {
      alert(err.message || 'Error al cambiar la contraseña');
    } finally {
      setActionLoading(null);
    }
  };

  const handleEditUser = async (target: AdminUser) => {
    const newOperatorCode = window.prompt(`Nuevo código para ${target.name}`, target.operator_code);
    if (newOperatorCode === null) return;

    const newName = window.prompt(`Nuevo nombre para ${target.name}`, target.name);
    if (newName === null) return;

    const newRole = window.prompt('Nuevo rol (admin, jefe_planta, supervisor, jefe_turno, operario)', target.role);
    if (newRole === null) return;

    const newStatus = window.prompt('Nuevo estado (active, pending, locked)', target.status);
    if (newStatus === null) return;

    const newPin = window.prompt('Nuevo PIN (dejar vacío para no cambiar)', '');
    if (newPin === null) return;

    const payload: Record<string, string> = {};
    const cleanOperatorCode = newOperatorCode.trim();
    const cleanName = newName.trim();
    const cleanRole = newRole.trim();
    const cleanStatus = newStatus.trim();
    const cleanPin = newPin.trim();

    if (!cleanOperatorCode || !cleanName || !cleanRole || !cleanStatus) {
      alert('Código, nombre, rol y estado son obligatorios.');
      return;
    }

    if (!/^\d+$/.test(cleanOperatorCode)) {
      alert('El código de operario debe contener solo números.');
      return;
    }

    if (cleanPin && !/^\d+$/.test(cleanPin)) {
      alert('El PIN debe contener solo números.');
      return;
    }

    if (cleanPin && cleanPin.length !== 4) {
      alert('El PIN debe tener 4 dígitos.');
      return;
    }

    if (cleanOperatorCode !== target.operator_code) payload.operator_code = cleanOperatorCode;
    if (cleanName !== target.name) payload.name = cleanName;
    if (cleanRole !== target.role) payload.role = cleanRole;
    if (cleanStatus !== target.status) payload.status = cleanStatus;
    if (cleanPin) payload.pin = cleanPin;

    if (Object.keys(payload).length === 0) {
      alert('No hay cambios para guardar.');
      return;
    }

    setActionLoading(target.id);
    try {
      const res = await fetch(`/api/admin/users/${target.id}/profile`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Error al editar usuario');
      }
      await fetchUsers();
    } catch (err: any) {
      alert(err.message || 'Error al editar usuario');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();

    const operatorCode = createForm.operator_code.trim();
    const name = createForm.name.trim();
    const pin = createForm.pin.trim();

    if (!operatorCode || !name || !pin || !createForm.role) {
      setError('Completa código, nombre, PIN y rol para crear el usuario.');
      return;
    }
    if (!/^\d+$/.test(operatorCode)) {
      setError('El código de operario debe contener solo números.');
      return;
    }
    if (!/^\d+$/.test(pin)) {
      setError('El PIN debe contener solo números.');
      return;
    }
    if (pin.length !== 4) {
      setError('El PIN debe tener 4 dígitos.');
      return;
    }

    setCreateLoading(true);
    setError('');
    try {
      await createAdminUser({
        operator_code: operatorCode,
        name,
        pin,
        role: createForm.role,
      });
      setCreateForm({ operator_code: '', name: '', pin: '', role: 'operario' });
      await fetchUsers();
    } catch (err: any) {
      setError(err.message || 'No se pudo crear el usuario');
    } finally {
      setCreateLoading(false);
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
      'supervisor': 'Supervisor',
      'jefe_turno': 'Jefe de Turno',
      'operario': 'Operario'
    };
    return labels[role] || role;
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
            <p className="text-slate-500 mt-1">Administra los accesos, aprueba nuevos registros y desbloquea cuentas.</p>
          </div>
          <button 
            onClick={fetchUsers}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Actualizar
          </button>
        </div>

        {hasPermission('admin.users.create') && (
          <form onSubmit={handleCreateUser} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Crear usuario desde administración</h3>
              <p className="text-sm text-slate-500 mt-1">El usuario se crea activo de inmediato, sin pasar por sala de espera.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Código de Operario</label>
                <input
                  type="text"
                  value={createForm.operator_code}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, operator_code: e.target.value.replace(/\D/g, '') }))}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  placeholder="Ej: 1001"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Nombre</label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  placeholder="Nombre completo"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">PIN</label>
                <input
                  type="password"
                  value={createForm.pin}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, pin: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  placeholder="4 dígitos"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Rol</label>
                <select
                  value={createForm.role}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, role: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                >
                  {ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={createLoading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors disabled:opacity-60"
              >
                {createLoading ? 'Creando usuario...' : 'Crear usuario'}
              </button>
            </div>
          </form>
        )}

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
                          {u.status === 'pending' && hasPermission('admin.users.approve') && (
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
                          {u.status === 'locked' && hasPermission('admin.users.unlock') && (
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
                          {hasPermission('admin.users.change_password') && (
                            <button
                              onClick={() => handleChangePassword(u)}
                              disabled={actionLoading === u.id}
                              className="flex items-center gap-1 px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 font-medium rounded-lg transition-colors disabled:opacity-50"
                              title="Cambiar contraseña"
                            >
                              <Key className="w-4 h-4" />
                              <span className="hidden sm:inline">PIN</span>
                            </button>
                          )}
                          {currentUser?.role === 'admin' && (
                            <button
                              onClick={() => handleEditUser(u)}
                              disabled={actionLoading === u.id}
                              className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium rounded-lg transition-colors disabled:opacity-50"
                              title="Editar usuario"
                            >
                              <Edit3 className="w-4 h-4" />
                              <span className="hidden sm:inline">Editar</span>
                            </button>
                          )}
                          {hasPermission('admin.users.delete') && currentUser?.id !== u.id && (
                            <button
                              onClick={() => handleDeleteUser(u.id, u.name)}
                              disabled={actionLoading === u.id}
                              className="flex items-center gap-1 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 font-medium rounded-lg transition-colors disabled:opacity-50"
                              title="Eliminar Usuario"
                            >
                              <Trash2 className="w-4 h-4" />
                              <span className="hidden sm:inline">Eliminar</span>
                            </button>
                          )}
                          {u.status === 'active' && !(hasPermission('admin.users.delete') && currentUser?.id !== u.id) && (
                            <span className="text-sm text-slate-400 italic px-2">
                              Sin acciones
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminUsers;
