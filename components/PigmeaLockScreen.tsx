import React, { useEffect, useRef, useState } from 'react';

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
const SCREEN_OPEN_DURATION_MS = 420;

const supportsCoarsePointer = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

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
  const [viewportHeight, setViewportHeight] = useState<number>(
    typeof window !== 'undefined' ? window.innerHeight : 900
  );

  const screenRef = useRef<HTMLDivElement | null>(null);
  const startYRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const unlockRequestedRef = useRef(false);

  const visible = isLocked || isOpening;

  const requestUnlock = () => {
    if (unlockRequestedRef.current) return;
    unlockRequestedRef.current = true;
    setIsOpening(true);
    window.setTimeout(() => {
      onUnlock();
      setIsOpening(false);
      setDragOffset(0);
      unlockRequestedRef.current = false;
    }, SCREEN_OPEN_DURATION_MS);
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
    screenRef.current?.focus();
  }, [visible]);

  // Negative translateY = moves screen upward off viewport
  const translateY = isOpening ? -viewportHeight : -dragOffset;

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
    if (distance >= SWIPE_UNLOCK_THRESHOLD_PX || velocity >= SWIPE_VELOCITY_THRESHOLD) {
      requestUnlock();
    } else {
      setDragOffset(0);
    }
    startYRef.current = null;
    startTimeRef.current = null;
  };

  const handleDesktopClick: React.MouseEventHandler<HTMLDivElement> = () => {
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
      ref={screenRef}
      tabIndex={0}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pigmea-lock-title"
      aria-describedby="pigmea-lock-description"
      onClick={handleDesktopClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[9999] overflow-hidden outline-none bg-gradient-to-b from-slate-950 via-slate-900 to-slate-800 text-white flex flex-col items-center justify-center px-6 text-center"
      style={{
        transform: `translate3d(0, ${translateY}px, 0)`,
        transitionProperty: 'transform',
        transitionDuration: isOpening ? `${SCREEN_OPEN_DURATION_MS}ms` : '180ms',
        transitionTimingFunction: isOpening ? 'cubic-bezier(0.16, 1, 0.3, 1)' : 'ease-out',
        touchAction: isMobilePointer ? 'none' : 'auto',
      }}
    >
      <div className="pigmea-lock-travel-bg" aria-hidden="true" />

      {/* Logo */}
      {!hasLogoError ? (
        <img
          src={logoUrl}
          alt="Logo oficial de Pigmea"
          className="relative z-10 w-40 h-auto md:w-52 drop-shadow-[0_8px_30px_rgba(255,255,255,0.15)]"
          loading="eager"
          onError={() => setHasLogoError(true)}
          draggable={false}
        />
      ) : (
        <div className="relative z-10 w-40 h-16 flex items-center justify-center md:w-52">
          <span className="text-2xl font-bold tracking-widest opacity-80">PIGMEA</span>
        </div>
      )}

      {/* App name */}
      <h1
        id="pigmea-lock-title"
        className="relative z-10 mt-6 text-2xl md:text-3xl font-bold tracking-tight select-none"
      >
        {appName}
      </h1>

      {/* Daily motivational phrase */}
      <p
        id="pigmea-lock-description"
        className="relative z-10 mt-3 text-sm md:text-base text-slate-300 max-w-md select-none"
      >
        {phrase}
      </p>

      {/* Unlock button */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); requestUnlock(); }}
        className="relative z-10 mt-8 px-6 py-3 rounded-full border border-white/40 bg-white/10 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 text-sm font-medium transition-colors select-none"
        aria-label="Desbloquear pantalla"
      >
        Desbloquear
      </button>

      {/* Mobile swipe hint */}
      {isMobilePointer && (
        <>
          <p className="relative z-10 mt-6 text-xs text-slate-400 select-none" aria-hidden="true">
            Desliza hacia arriba para desbloquear
          </p>
          <div className="relative z-10 mt-3 w-16 h-1.5 rounded-full bg-white/40" aria-hidden="true" />
        </>
      )}

      {/* Footer */}
      <p className="absolute z-10 bottom-5 text-xs text-slate-400 select-none">{footerText}</p>
    </div>
  );
};

export default PigmeaLockScreen;
