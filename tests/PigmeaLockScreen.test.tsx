import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PigmeaLockScreen from '../components/PigmeaLockScreen';

const baseProps = {
  isLocked: true,
  onUnlock: vi.fn(),
  phrase: 'Hoy suma, aunque sea poco.',
  appName: 'Registro producción pigmea',
  footerText: 'soporte por Jhony A.',
  logoUrl: 'https://www.pigmea.es/wp-content/uploads/2018/05/logo-white.png',
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

    expect(screen.getAllByText('Registro producción pigmea').length).toBeGreaterThan(0);
    expect(screen.getAllByText('soporte por Jhony A.').length).toBeGreaterThan(0);
    expect(screen.getByText('Empuja hacia arriba para desbloquear')).toBeInTheDocument();
  });
});
