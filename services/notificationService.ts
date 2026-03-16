export type AppNotificationKind = 'warning' | 'error' | 'success';

export const emitAppNotification = (message: string, kind: AppNotificationKind = 'warning') => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent('app-notification', {
    detail: { message, kind },
  }));
};