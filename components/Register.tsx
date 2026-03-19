import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { UserPlus, User, Lock, Shield, AlertCircle } from 'lucide-react';

const ROLE_OPTIONS = [
  { value: 'operario', label: 'Operario' },
  { value: 'jefe_turno', label: 'Jefe de Turno' },
  { value: 'jefe_planta', label: 'Jefe de Planta' },
  { value: 'admin', label: 'Administrador' }
] as const;

const Register: React.FC<{ onSwitchToLogin: () => void }> = ({ onSwitchToLogin }) => {
  const { register } = useAuth();
  const [formData, setFormData] = useState({
    operator_code: '',
    name: '',
    pin: '',
    role: 'operario'
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = formData.name.trim();

    if (!formData.operator_code || !trimmedName || !formData.pin) {
      setError('Por favor complete todos los campos');
      return;
    }
    if (formData.pin.length < 4) {
      setError('El PIN debe tener al menos 4 dígitos');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await register({ ...formData, name: trimmedName });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Error al registrar');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8 text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <UserPlus className="w-10 h-10 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Registro Exitoso</h2>
          <p className="text-slate-600 mb-8">
            Tu cuenta ha sido creada. Si no eres el primer usuario (admin), tu cuenta está pendiente de aprobación por un administrador.
          </p>
          <button
            onClick={onSwitchToLogin}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors shadow-lg shadow-blue-600/30"
          >
            Ir al Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 py-12">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="bg-slate-800 p-6 text-center">
          <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <UserPlus className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white">Nuevo Registro</h2>
          <p className="text-slate-300 mt-1">Crea tu cuenta de acceso</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg flex items-center gap-2 text-sm">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Código de Operario</label>
            <div className="relative">
              <User className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={formData.operator_code}
                onChange={(e) => setFormData({ ...formData, operator_code: e.target.value })}
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-medium"
                placeholder="Ej: OP-001"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Nombre Completo</label>
            <div className="relative">
              <User className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-medium"
                placeholder="Ej: Juan Pérez"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Rol Solicitado</label>
            <div className="grid grid-cols-2 gap-2">
              {ROLE_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFormData({ ...formData, role: option.value })}
                  className={`py-3 px-3 rounded-lg border text-sm font-bold transition-colors flex items-center justify-center gap-2 ${formData.role === option.value ? 'bg-slate-800 text-white border-slate-800' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}`}
                >
                  <Shield className="w-4 h-4" />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">PIN (Mín. 4 dígitos)</label>
            <div className="relative">
              <Lock className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={formData.pin}
                  onFocus={() => setFormData({ ...formData, pin: '' })}
                  onClick={() => setFormData({ ...formData, pin: '' })}
                  inputMode="numeric"
                pattern="[0-9]*"
                onChange={(e) => setFormData({ ...formData, pin: e.target.value.replace(/\D/g, '') })}
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono tracking-widest text-lg"
                placeholder="••••"
                maxLength={6}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg transition-colors shadow-lg shadow-slate-800/30 disabled:opacity-70 mt-6"
          >
            {loading ? 'Registrando...' : 'Crear Cuenta'}
          </button>

          <div className="text-center mt-4">
            <button
              type="button"
              onClick={onSwitchToLogin}
              className="text-sm text-slate-500 hover:text-slate-800 hover:underline font-medium"
            >
              ¿Ya tienes cuenta? Inicia sesión
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Register;
