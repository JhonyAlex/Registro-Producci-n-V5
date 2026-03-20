import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PigmeaLockScreen from '../components/PigmeaLockScreen';

const baseProps = {
  isLocked: true,
  onUnlock: vi.fn(),
  phrase: 'Hoy suma, aunque sea poco.',
  appName: 'Registro Producción Pigmea',
  footerText: 'soporte por Jhony A.',
  logoUrl: '/logo-white.png',
};

describe('PigmeaLockScreen', () => {
  it('unlocks on desktop click', () => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });

    const onUnlock = vi.fn();
    const { container } = render(<PigmeaLockScreen {...baseProps} onUnlock={onUnlock} />);

    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    act(() => {
      fireEvent.click(dialog, { target: dialog, currentTarget: dialog });
      vi.advanceTimersByTime(450);
    });

    expect(onUnlock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('shows required identity texts', () => {
    render(<PigmeaLockScreen {...baseProps} />);

    expect(screen.getByText('Registro Producción Pigmea')).toBeInTheDocument();
    expect(screen.getByText('soporte por Jhony A.')).toBeInTheDocument();
    expect(screen.getByText('Desbloquear')).toBeInTheDocument();
  });
});
