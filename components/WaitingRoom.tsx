import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Clock, RefreshCw, LogOut } from 'lucide-react';
import { socket } from '../services/socket';

const WaitingRoom: React.FC = () => {
  const { user, checkAuth, logout } = useAuth();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const handleStatusChange = (data: { userId: string, status: string }) => {
      if (user && data.userId === user.id && data.status === 'active') {
        // Status changed to active, re-check auth to get updated user object
        void checkAuth();
      }
    };

    const handleReconnect = () => {
      void checkAuth();
    };

    socket.on('user_status_changed', handleStatusChange);
    socket.on('connect', handleReconnect);

    return () => {
      socket.off('user_status_changed', handleStatusChange);
      socket.off('connect', handleReconnect);
    };
  }, [user, checkAuth]);

  const handleManualCheck = async () => {
    setChecking(true);
    await checkAuth();
    setTimeout(() => setChecking(false), 1000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8 text-center relative overflow-hidden">
        {/* Background decorative elements */}
        <div className="absolute top-0 left-0 w-full h-2 bg-yellow-400"></div>
        
        <div className="w-24 h-24 bg-yellow-50 rounded-full flex items-center justify-center mx-auto mb-6 relative">
          <Clock className="w-12 h-12 text-yellow-500 animate-pulse" />
          <div className="absolute top-0 right-0 w-6 h-6 bg-white rounded-full flex items-center justify-center shadow-sm">
            <div className="w-4 h-4 bg-yellow-400 rounded-full animate-ping"></div>
          </div>
        </div>
        
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Cuenta Pendiente</h2>
        <p className="text-slate-600 mb-8 leading-relaxed">
          Hola <strong className="text-slate-800">{user?.name}</strong>. Tu cuenta ({user?.operator_code}) ha sido registrada correctamente, pero requiere la aprobación de un administrador para acceder al sistema.
        </p>

        <div className="bg-slate-50 rounded-xl p-4 mb-8 border border-slate-100">
          <p className="text-sm text-slate-500 font-medium">
            Por favor, contacta a tu Jefe de Planta o Administrador para que apruebe tu acceso.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <button
            onClick={handleManualCheck}
            disabled={checking}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 disabled:opacity-70"
          >
            <RefreshCw className={`w-5 h-5 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Verificando...' : 'Verificar Estado'}
          </button>
          
          <button
            onClick={logout}
            className="w-full py-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Cerrar Sesión
          </button>
        </div>
      </div>
    </div>
  );
};

export default WaitingRoom;
