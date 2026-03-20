import { useEffect, useRef } from 'react';

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
  removeEventListener?: (type: 'release', listener: () => void) => void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
};

const getWakeLockApi = () => (navigator as NavigatorWithWakeLock).wakeLock;

export const useScreenWakeLock = (enabled = true): void => {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let disposed = false;

    const handleRelease = () => {
      sentinelRef.current = null;
    };

    const releaseWakeLock = async () => {
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (!sentinel || sentinel.released) return;
      sentinel.removeEventListener?.('release', handleRelease);
      try {
        await sentinel.release();
      } catch {
        // No action needed: releasing can fail if the sentinel was already dropped by the browser.
      }
    };

    const requestWakeLock = async () => {
      const wakeLock = getWakeLockApi();
      if (!wakeLock || document.visibilityState !== 'visible' || sentinelRef.current) return;

      try {
        const sentinel = await wakeLock.request('screen');
        if (disposed) {
          await sentinel.release();
          return;
        }
        sentinel.addEventListener?.('release', handleRelease);
        sentinelRef.current = sentinel;
      } catch {
        // Best effort only. Unsupported browsers or battery saver modes can reject the request.
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void requestWakeLock();
        return;
      }
      void releaseWakeLock();
    };

    void requestWakeLock();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      void releaseWakeLock();
    };
  }, [enabled]);
};

export default useScreenWakeLock;