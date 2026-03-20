import React, { useEffect, useState } from 'react';
import { Save, UserCircle2, AlertCircle, CheckCircle2, KeyRound, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const UserProfile: React.FC = () => {
  const { user, checkAuth } = useAuth();

  const [operatorCode, setOperatorCode] = useState('');
  const [name, setName] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setOperatorCode(user?.operator_code || '');
    setName(user?.name || '');
  }, [user?.operator_code, user?.name]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setError('');
    setSuccess('');

    const trimmedCode = operatorCode.trim();
    const trimmedName = name.trim();
    const trimmedCurrentPin = currentPin.trim();
    const trimmedNewPin = newPin.trim();
    const trimmedConfirmPin = confirmPin.trim();

    if (!trimmedCode || !trimmedName) {
      setError('Código y nombre son obligatorios.');
      return;
    }

    if (!/^\d+$/.test(trimmedCode)) {
      setError('El código de operario debe contener solo números.');
      return;
    }

    if (trimmedNewPin) {
      if (trimmedNewPin.length < 4) {
        setError('El nuevo PIN debe tener al menos 4 dígitos.');
        return;
      }
      if (!trimmedCurrentPin) {
        setError('Ingresa tu PIN actual para poder cambiarlo.');
        return;
      }
      if (trimmedNewPin !== trimmedConfirmPin) {
        setError('La confirmación del PIN no coincide.');
        return;
      }
    }

    const payload: Record<string, string> = {};

    if (trimmedCode !== user.operator_code) payload.operator_code = trimmedCode;
    if (trimmedName !== user.name) payload.name = trimmedName;

    if (trimmedNewPin) {
      payload.current_pin = trimmedCurrentPin;
      payload.pin = trimmedNewPin;
    }

    if (Object.keys(payload).length === 0) {
      setSuccess('No hay cambios para guardar.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo actualizar el perfil');
      }

      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      await checkAuth();
      setSuccess('Perfil actualizado correctamente.');
    } catch (err: any) {
      setError(err.message || 'Error actualizando perfil');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto bg-slate-50">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <UserCircle2 className="w-6 h-6 text-blue-600" />
            Mi Perfil
          </h2>
          <p className="text-slate-500 mt-1">Actualiza tu código de operario, nombre y PIN sin perder vínculo con tus registros históricos.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>{success}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Código de Operario</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={operatorCode}
                  onChange={(e) => setOperatorCode(e.target.value.replace(/\D/g, ''))}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  maxLength={20}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Nombre</label>
              <div className="relative">
                <UserCircle2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  maxLength={80}
                />
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-3">
              <KeyRound className="w-4 h-4 text-slate-500" />
              Cambiar PIN (opcional)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                type="password"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="PIN actual"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                maxLength={12}
              />
              <input
                type="password"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Nuevo PIN"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                maxLength={12}
              />
              <input
                type="password"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Confirmar nuevo PIN"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                maxLength={12}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {loading ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UserProfile;
