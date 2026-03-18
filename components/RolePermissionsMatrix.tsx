import React, { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, RefreshCw, Save, ShieldAlert } from 'lucide-react';

interface MatrixResponse {
  roles: string[];
  permissionKeys: string[];
  matrix: Record<string, Record<string, boolean>>;
}

const PERMISSION_LABELS: Record<string, string> = {
  'records.read': 'Ver registros',
  'records.write': 'Crear y editar registros',
  'records.delete': 'Eliminar un registro',
  'records.delete_all': 'Eliminar todos los registros',
  'settings.read': 'Ver comentarios y operarios',
  'settings.manage': 'Gestionar comentarios y operarios',
  'settings.field_schemas': 'Gestionar campos dinámicos por máquina',
  'admin.users.read': 'Ver usuarios',
  'admin.users.approve': 'Aprobar usuarios',
  'admin.users.unlock': 'Desbloquear usuarios',
  'admin.users.delete': 'Eliminar usuarios',
  'admin.audit.read': 'Ver auditoría',
  'backup.export': 'Exportar backup',
  'backup.import': 'Importar backup'
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  jefe_planta: 'Jefe de Planta',
  jefe_turno: 'Jefe de Turno',
  operario: 'Operario'
};

const groupedPermissionKeys = (keys: string[]) => {
  const groups = {
    Registros: keys.filter((key) => key.startsWith('records.')),
    Configuracion: keys.filter((key) => key.startsWith('settings.')),
    Usuarios: keys.filter((key) => key.startsWith('admin.users.')),
    Auditoria: keys.filter((key) => key.startsWith('admin.audit.')),
    Backup: keys.filter((key) => key.startsWith('backup.'))
  };

  return Object.entries(groups).filter(([, value]) => value.length > 0);
};

const RolePermissionsMatrix: React.FC = () => {
  const [roles, setRoles] = useState<string[]>([]);
  const [permissionKeys, setPermissionKeys] = useState<string[]>([]);
  const [matrix, setMatrix] = useState<Record<string, Record<string, boolean>>>({});
  const [loading, setLoading] = useState(true);
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchMatrix = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/admin/role-permissions', { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo cargar la matriz de permisos');
      }
      const data: MatrixResponse = await res.json();
      setRoles(data.roles || []);
      setPermissionKeys(data.permissionKeys || []);
      setMatrix(data.matrix || {});
    } catch (err: any) {
      setError(err.message || 'Error al cargar permisos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMatrix();
  }, []);

  const roleRows = useMemo(() => roles.filter((role) => role !== 'admin'), [roles]);
  const permissionGroups = useMemo(() => groupedPermissionKeys(permissionKeys), [permissionKeys]);

  const togglePermission = (role: string, key: string) => {
    setMatrix((prev) => ({
      ...prev,
      [role]: {
        ...(prev[role] || {}),
        [key]: !prev?.[role]?.[key]
      }
    }));
  };

  const saveRole = async (role: string) => {
    setSavingRole(role);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/admin/role-permissions/${role}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: matrix[role] || {} })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo guardar la matriz');
      }
      setSuccess(`Permisos guardados para ${ROLE_LABELS[role] || role}.`);
    } catch (err: any) {
      setError(err.message || 'Error guardando permisos');
    } finally {
      setSavingRole(null);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
          <p className="font-medium">Cargando matriz de permisos...</p>
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
              <ShieldCheck className="w-6 h-6 text-blue-600" />
              Matriz de Permisos por Rol
            </h2>
            <p className="text-slate-500 mt-1">Define qué puede hacer cada rol dentro del sistema.</p>
          </div>
          <button
            onClick={fetchMatrix}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Recargar
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 p-4 rounded-xl flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 flex-shrink-0" />
            <p className="font-medium">{error}</p>
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 p-4 rounded-xl">
            <p className="font-medium">{success}</p>
          </div>
        )}

        {permissionGroups.map(([groupName, keys]) => (
          <div key={groupName} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800">{groupName}</h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left border-collapse">
                <thead>
                  <tr className="bg-white border-b border-slate-100 text-slate-500 uppercase tracking-wider text-xs">
                    <th className="px-6 py-3 font-bold">Permiso</th>
                    {roleRows.map((role) => (
                      <th key={role} className="px-6 py-3 font-bold text-center">{ROLE_LABELS[role] || role}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {keys.map((key) => (
                    <tr key={key} className="hover:bg-slate-50">
                      <td className="px-6 py-4 font-medium text-slate-700">{PERMISSION_LABELS[key] || key}</td>
                      {roleRows.map((role) => (
                        <td key={`${role}-${key}`} className="px-6 py-4 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(matrix?.[role]?.[key])}
                            onChange={() => togglePermission(role, key)}
                            className="h-4 w-4 accent-blue-600 cursor-pointer"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 md:p-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {roleRows.map((role) => (
              <button
                key={role}
                onClick={() => saveRole(role)}
                disabled={savingRole !== null}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {savingRole === role ? 'Guardando...' : `Guardar ${ROLE_LABELS[role] || role}`}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-3">El rol Administrador conserva acceso total por seguridad.</p>
        </div>
      </div>
    </div>
  );
};

export default RolePermissionsMatrix;
