import React, { useEffect, useMemo, useRef, useState } from 'react';

interface PigmeaLockScreenProps {
  isLocked: boolean;
  onUnlock: () => void;
  phrase: string;
  appName: string;
  footerText: string;
  logoUrl: string;
}

const SWIPE_UNLOCK_THRESHOLD_PX = 120;
const SWIPE_VELOCITY_THRESHOLD = 0.5;
const CURTAIN_OPEN_DURATION_MS = 420;

const supportsCoarsePointer = () => {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
};

const PigmeaLockScreen: React.FC<PigmeaLockScreenProps> = ({
  isLocked,
  onUnlock,
  phrase,
  appName,
  footerText,
  logoUrl,
}) => {
  const [isOpening, setIsOpening] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [hasLogoError, setHasLogoError] = useState(false);
  const [isMobilePointer, setIsMobilePointer] = useState<boolean>(supportsCoarsePointer());
  const [viewportHeight, setViewportHeight] = useState<number>(typeof window !== 'undefined' ? window.innerHeight : 900);

  const curtainRef = useRef<HTMLDivElement | null>(null);
  const startYRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const unlockRequestedRef = useRef(false);

  const visible = isLocked || isOpening;

  const requestUnlock = () => {
    if (unlockRequestedRef.current) return;
    unlockRequestedRef.current = true;
    setIsOpening(true);
    setDragOffset(viewportHeight);
    window.setTimeout(() => {
      onUnlock();
      setIsOpening(false);
      setDragOffset(0);
      unlockRequestedRef.current = false;
    }, CURTAIN_OPEN_DURATION_MS);
  };

  useEffect(() => {
    if (!isLocked) {
      setDragOffset(0);
      startYRef.current = null;
      startTimeRef.current = null;
    }
  }, [isLocked]);

  useEffect(() => {
    if (!visible) return;
    const updatePointerMode = () => setIsMobilePointer(supportsCoarsePointer());
    const updateViewportHeight = () => setViewportHeight(window.innerHeight);
    updatePointerMode();
    updateViewportHeight();
    window.addEventListener('resize', updateViewportHeight, { passive: true });
    return () => {
      window.removeEventListener('resize', updateViewportHeight);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    curtainRef.current?.focus();
  }, [visible]);

  const curtainTranslate = useMemo(() => {
    if (isOpening) return -viewportHeight;
    return -dragOffset;
  }, [dragOffset, isOpening, viewportHeight]);

  const handlePointerDown: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (!isMobilePointer || !isLocked || isOpening) return;
    startYRef.current = event.clientY;
    startTimeRef.current = performance.now();
  };

  const handlePointerMove: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (!isMobilePointer || !isLocked || isOpening || startYRef.current === null) return;
    const delta = Math.max(0, startYRef.current - event.clientY);
    setDragOffset(Math.min(delta, viewportHeight));
  };

  const handlePointerUp: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (!isMobilePointer || !isLocked || isOpening || startYRef.current === null) return;

    const elapsedMs = Math.max(1, performance.now() - (startTimeRef.current ?? performance.now()));
    const distance = Math.max(0, startYRef.current - event.clientY);
    const velocity = distance / elapsedMs;

    const shouldUnlock = distance >= SWIPE_UNLOCK_THRESHOLD_PX || velocity >= SWIPE_VELOCITY_THRESHOLD;

    if (shouldUnlock) {
      requestUnlock();
    } else {
      setDragOffset(0);
    }

    startYRef.current = null;
    startTimeRef.current = null;
  };

  const handleDesktopClick: React.MouseEventHandler<HTMLDivElement> = (event) => {
    if (isMobilePointer || !isLocked || isOpening) return;
    requestUnlock();
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (!isLocked || isOpening) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      requestUnlock();
    }
  };

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pigmea-lock-title"
      aria-describedby="pigmea-lock-description"
      onClick={handleDesktopClick}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-800 text-white flex flex-col items-center justify-center px-6 text-center">
        <img
          src={logoUrl}
          alt="Logo oficial de Pigmea"
          className="w-40 h-auto md:w-52 drop-shadow-[0_8px_30px_rgba(255,255,255,0.15)]"
          loading="eager"
          onError={() => setHasLogoError(true)}
        />
        {hasLogoError && (
          <p className="mt-3 text-xs text-slate-300" aria-live="polite">
            No fue posible cargar el logo remoto en este momento.
          </p>
        )}
        <h1 id="pigmea-lock-title" className="mt-6 text-2xl md:text-3xl font-bold tracking-tight">
          {appName}
        </h1>
        <p id="pigmea-lock-description" className="mt-3 text-sm md:text-base text-slate-200 max-w-md">
          {phrase}
        </p>
        <button
          type="button"
          onClick={requestUnlock}
          className="mt-6 px-5 py-2.5 rounded-full border border-white/40 bg-white/10 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          aria-label="Desbloquear pantalla"
        >
          Desbloquear
        </button>
        <p className="absolute bottom-4 text-xs text-slate-300">{footerText}</p>
      </div>

      <div
        ref={curtainRef}
        tabIndex={0}
        onClick={handleDesktopClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        className="absolute inset-0 bg-[linear-gradient(145deg,#0f172a,#1e293b)] flex flex-col items-center justify-end pb-12 px-6 text-center text-white outline-none transition-transform"
        style={{
          transform: `translate3d(0, ${curtainTranslate}px, 0)`,
          transitionDuration: isOpening ? `${CURTAIN_OPEN_DURATION_MS}ms` : '180ms',
          transitionTimingFunction: isOpening ? 'cubic-bezier(0.16, 1, 0.3, 1)' : 'ease-out',
          touchAction: isMobilePointer ? 'none' : 'auto',
        }}
        aria-label="Pantalla de bloqueo"
      >
        <div className="mb-auto mt-16">
          <h2 className="text-xl md:text-2xl font-bold tracking-tight">{appName}</h2>
          <p className="text-sm md:text-base text-slate-200">
            Empuja hacia arriba para desbloquear
          </p>
          {!isMobilePointer && (
            <p className="mt-2 text-xs text-slate-300">Haz clic para desbloquear en web</p>
          )}
        </div>
        <p className="mb-4 text-xs text-slate-300">{footerText}</p>
        <div className="w-16 h-1.5 rounded-full bg-white/60" aria-hidden="true" />
      </div>
    </div>
  );
};

export default PigmeaLockScreen;
