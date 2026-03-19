import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseInactivityLockOptions {
  timeoutMs?: number;
}

export interface InactivityLockState {
  isLocked: boolean;
  lockNow: () => void;
  unlock: () => void;
  resetInactivity: () => void;
}

const DEFAULT_TIMEOUT_MS = 60000;
const POINTER_MOVE_THROTTLE_MS = 1200;

export const useInactivityLock = ({ timeoutMs = DEFAULT_TIMEOUT_MS }: UseInactivityLockOptions = {}): InactivityLockState => {
  const [isLocked, setIsLocked] = useState(false);
  const timerRef = useRef<number | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const lastPointerMoveRef = useRef<number>(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const lockNow = useCallback(() => {
    clearTimer();
    setIsLocked(true);
  }, [clearTimer]);

  const startTimer = useCallback(() => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      setIsLocked(true);
    }, timeoutMs);
  }, [clearTimer, timeoutMs]);

  const resetInactivity = useCallback(() => {
    if (isLocked) return;
    lastActivityRef.current = Date.now();
    startTimer();
  }, [isLocked, startTimer]);

  const unlock = useCallback(() => {
    setIsLocked(false);
    lastActivityRef.current = Date.now();
    startTimer();
  }, [startTimer]);

  useEffect(() => {
    const handleActivityEvent = (event: Event) => {
      if (event.type === 'pointermove') {
        const now = Date.now();
        if (now - lastPointerMoveRef.current < POINTER_MOVE_THROTTLE_MS) {
          return;
        }
        lastPointerMoveRef.current = now;
      }
      if (!isLocked) {
        resetInactivity();
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible' || isLocked) return;
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= timeoutMs) {
        lockNow();
      } else {
        startTimer();
      }
    };

    const eventOptions: AddEventListenerOptions = { passive: true };
    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'focus'];

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, handleActivityEvent, eventOptions);
    });
    document.addEventListener('visibilitychange', handleVisibility);

    if (!isLocked) {
      startTimer();
    }

    return () => {
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, handleActivityEvent);
      });
      document.removeEventListener('visibilitychange', handleVisibility);
      clearTimer();
    };
  }, [clearTimer, isLocked, lockNow, resetInactivity, startTimer, timeoutMs]);

  return {
    isLocked,
    lockNow,
    unlock,
    resetInactivity,
  };
};
