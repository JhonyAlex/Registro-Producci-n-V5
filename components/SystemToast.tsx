import React from 'react';
import { AlertCircle } from 'lucide-react';
import { AppNotificationKind } from '../services/notificationService';

export interface SystemToastData {
  message: string;
  kind: AppNotificationKind;
}

interface SystemToastProps {
  toast: SystemToastData | null;
}

const SystemToast: React.FC<SystemToastProps> = ({ toast }) => {
  if (!toast) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-[80] max-w-sm w-[calc(100%-2rem)] md:w-auto animate-fade-in">
      <div
        className={`rounded-xl border px-4 py-3 shadow-lg text-sm font-medium flex items-start gap-2 ${
          toast.kind === 'success'
            ? 'bg-green-50 border-green-200 text-green-800'
            : toast.kind === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}
      >
        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>{toast.message}</span>
      </div>
    </div>
  );
};

export default SystemToast;
