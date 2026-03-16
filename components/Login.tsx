import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Lock, User, AlertCircle } from 'lucide-react';

const Login: React.FC<{ onSwitchToRegister: () => void }> = ({ onSwitchToRegister }) => {
  const { login } = useAuth();
  const [operatorCode, setOperatorCode] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const savedNotice = sessionStorage.getItem('auth_notice');
    if (savedNotice) {
      setNotice(savedNotice);
      sessionStorage.removeItem('auth_notice');
    }
  }, []);

  const handleNumberClick = (num: string) => {
    if (pin.length < 6) {
      setPin(prev => prev + num);
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!operatorCode || !pin) {
      setError('Por favor ingrese código y PIN');
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
          <h2 className="text-2xl font-bold text-white">Acceso al Sistema</h2>
          <p className="text-blue-100 mt-1">Ingrese sus credenciales para continuar</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {notice && (
            <div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-lg flex items-center gap-2 text-sm">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{notice}</span>
            </div>
          )}

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
                value={operatorCode}
                onChange={(e) => setOperatorCode(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-medium"
                placeholder="Ej: OP-001"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">PIN de Acceso</label>
            <div className="relative">
              <Lock className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={pin}
                readOnly
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-center tracking-[0.5em] text-xl"
                placeholder="••••"
              />
            </div>
            
            {/* Numeric Keypad */}
            <div className="grid grid-cols-3 gap-3 mt-4">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handleNumberClick(num.toString())}
                  className="py-4 bg-slate-100 hover:bg-slate-200 rounded-lg text-xl font-bold text-slate-700 transition-colors active:bg-slate-300"
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPin('')}
                className="py-4 bg-red-50 hover:bg-red-100 rounded-lg text-sm font-bold text-red-600 transition-colors"
              >
                Limpiar
              </button>
              <button
                type="button"
                onClick={() => handleNumberClick('0')}
                className="py-4 bg-slate-100 hover:bg-slate-200 rounded-lg text-xl font-bold text-slate-700 transition-colors active:bg-slate-300"
              >
                0
              </button>
              <button
                type="button"
                onClick={handleBackspace}
                className="py-4 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-bold text-slate-700 transition-colors"
              >
                ←
              </button>
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
