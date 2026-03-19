import React, { useEffect, useMemo, useState } from 'react';
import { useInactivityLock } from '../hooks/useInactivityLock';
import { getDailyPhrase } from '../utils/dailyPhrase';
import PigmeaLockScreen from './PigmeaLockScreen';

interface GlobalLockScreenGuardProps {
  children: React.ReactNode;
  timeoutMs?: number;
  appName?: string;
  footerText?: string;
  logoUrl?: string;
}

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_APP_NAME = 'Registro producción pigmea';
const DEFAULT_FOOTER_TEXT = 'soporte por Jhony A.';
const DEFAULT_LOGO_URL = 'https://www.pigmea.es/wp-content/uploads/2018/05/logo-white.png';

const GlobalLockScreenGuard: React.FC<GlobalLockScreenGuardProps> = ({
  children,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  appName = DEFAULT_APP_NAME,
  footerText = DEFAULT_FOOTER_TEXT,
  logoUrl = DEFAULT_LOGO_URL,
}) => {
  const [dayMarker, setDayMarker] = useState(() => new Date().toDateString());
  const { isLocked, unlock } = useInactivityLock({ timeoutMs });

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const nextDayMarker = new Date().toDateString();
      setDayMarker((currentMarker) => (currentMarker === nextDayMarker ? currentMarker : nextDayMarker));
    }, 60000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const phraseOfTheDay = useMemo(() => getDailyPhrase(new Date(dayMarker)), [dayMarker]);

  return (
    <>
      {children}
      <PigmeaLockScreen
        isLocked={isLocked}
        onUnlock={unlock}
        phrase={phraseOfTheDay}
        appName={appName}
        footerText={footerText}
        logoUrl={logoUrl}
      />
    </>
  );
};

export default GlobalLockScreenGuard;
