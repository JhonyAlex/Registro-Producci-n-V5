import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useInactivityLock } from '../hooks/useInactivityLock';

describe('useInactivityLock', () => {
  it('locks after timeout with no interaction', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useInactivityLock({ timeoutMs: 1000 }));

    expect(result.current.isLocked).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.isLocked).toBe(true);
    vi.useRealTimers();
  });

  it('resets timer on keyboard activity', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useInactivityLock({ timeoutMs: 1000 }));

    act(() => {
      vi.advanceTimersByTime(700);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      vi.advanceTimersByTime(700);
    });

    expect(result.current.isLocked).toBe(false);

    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(result.current.isLocked).toBe(true);
    vi.useRealTimers();
  });

  it('supports explicit lock and unlock transitions', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useInactivityLock({ timeoutMs: 1000 }));

    act(() => {
      result.current.lockNow();
    });

    expect(result.current.isLocked).toBe(true);

    act(() => {
      result.current.unlock();
    });

    expect(result.current.isLocked).toBe(false);
    vi.useRealTimers();
  });
});
