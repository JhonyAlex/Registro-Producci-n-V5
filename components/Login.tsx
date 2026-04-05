import React, { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Lock, User, AlertCircle } from 'lucide-react';

const OPERATOR_CODE_LENGTH = 3;
const PIN_LENGTH = 4;

const Login: React.FC<{ onSwitchToRegister: () => void }> = ({ onSwitchToRegister }) => {
  const { login } = useAuth();
  const [operatorCode, setOperatorCode] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const pinInputRef = useRef<HTMLInputElement>(null);

  // Auto-advance to PIN field when operator code is complete
  const handleOperatorCodeChange = (value: string) => {
    const cleaned = value.replace(/\D/g, '').slice(0, OPERATOR_CODE_LENGTH);
    setOperatorCode(cleaned);
    if (cleaned.length === OPERATOR_CODE_LENGTH) {
      pinInputRef.current?.focus();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!operatorCode || !pin) {
      setError('Por favor ingrese código y PIN');
      return;
    }
    if (!/^\d+$/.test(operatorCode)) {
      setError('El código de operario debe contener solo números');
      return;
    }
    if (operatorCode.length !== OPERATOR_CODE_LENGTH) {
      setError('El código de operario debe tener 3 dígitos');
      return;
    }
    if (pin.length !== PIN_LENGTH) {
      setError('El PIN debe tener 4 dígitos');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await login(operatorCode, pin);
    } catch (err: any) {
      setError(err.message || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="bg-blue-600 p-6 text-center">
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Registro Producción Pigmea</h1>
          <h2 className="text-blue-100 mt-1 font-medium">Acceso al Sistema</h2>
          <p className="text-blue-100/90 mt-1">Ingrese sus credenciales para continuar</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg flex items-center gap-2 text-sm">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Código de Operario (3 dígitos)</label>
            <div className="relative">
              <User className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={operatorCode}
                onChange={(e) => handleOperatorCodeChange(e.target.value)}
                inputMode="numeric"
                pattern="[0-9]*"
                enterKeyHint="next"
                maxLength={OPERATOR_CODE_LENGTH}
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-medium"
                placeholder="Ej: 123"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">PIN de Acceso</label>
            <div className="relative">
              <Lock className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                ref={pinInputRef}
                type="password"
                value={pin}
                onFocus={() => {
                  setPin('');
                }}
                onClick={() => {
                  setPin('');
                }}
                inputMode="numeric"
                pattern="[0-9]*"
                enterKeyHint="done"
                maxLength={PIN_LENGTH}
                onChange={(e) => {
                  const cleanedPin = e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
                  setPin(cleanedPin);
                }}
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-center tracking-[0.5em] text-xl"
                placeholder="••••"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors shadow-lg shadow-blue-600/30 disabled:opacity-70"
          >
            {loading ? 'Verificando...' : 'Ingresar'}
          </button>

          <div className="text-center mt-4">
            <button
              type="button"
              onClick={onSwitchToRegister}
              className="text-sm text-blue-600 hover:underline font-medium"
            >
              ¿No tienes cuenta? Regístrate aquí
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Login;
