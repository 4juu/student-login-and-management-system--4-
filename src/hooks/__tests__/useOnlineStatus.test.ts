import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('firebase/database', () => ({
  ref: vi.fn((_db: unknown, path: string) => ({ path })),
  onValue: vi.fn((_ref: unknown, cb: (snap: { val: () => boolean }) => void) => {
    // fire connected=true immediately
    cb({ val: () => true });
    return vi.fn(); // unsubscribe
  }),
  goOnline: vi.fn(),
}));

vi.mock('../../firebase/config', () => ({
  database: {},
}));

vi.mock('../../firebase/dataService', () => ({
  applyOutbox: vi.fn(async () => undefined),
  flushAllPendingSaves: vi.fn(async () => undefined),
  hasPendingWrites: vi.fn(async () => false),
  retryFailedSaves: vi.fn(async () => undefined),
}));

import { useOnlineStatus } from '../useOnlineStatus';
import { onValue, goOnline } from 'firebase/database';
import { applyOutbox, flushAllPendingSaves, hasPendingWrites, retryFailedSaves } from '../../firebase/dataService';

describe('useOnlineStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns isOffline=false and syncDone=true when navigator online and Firebase connected', () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.isOffline).toBe(false);
    expect(result.current.syncDone).toBe(true);
  });

  it('returns isOffline=true when navigator.onLine is false', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.isOffline).toBe(true);
  });

  it('subscribes to .info/connected via onValue', () => {
    renderHook(() => useOnlineStatus());
    expect(onValue).toHaveBeenCalled();
  });

  it('calls syncNow (applyOutbox + flushAllPendingSaves) when transitioning offline→online', async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    const { result, rerender } = renderHook(() => useOnlineStatus());
    expect(result.current.isOffline).toBe(true);
    expect(result.current.syncDone).toBe(false);

    // go online — await microtasks so async syncNow completes
    await act(async () => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: true,
      });
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
      await Promise.resolve();
    });
    rerender();

    expect(result.current.isOffline).toBe(false);
    expect(goOnline).toHaveBeenCalled();
    expect(retryFailedSaves).toHaveBeenCalled();
    expect(applyOutbox).toHaveBeenCalled();
    expect(flushAllPendingSaves).toHaveBeenCalled();
  });

  it('keeps syncDone=false while offline', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.syncDone).toBe(false);
  });

  it('responds to window offline event', () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.isOffline).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.isOffline).toBe(true);
    expect(result.current.syncDone).toBe(false);
  });

  it('responds to window online event', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.isOffline).toBe(true);

    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: true,
      });
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current.isOffline).toBe(false);
  });

  it('sets syncDone=true when hasPendingWrites returns false (after poll backoff)', async () => {
    vi.useFakeTimers();
    vi.mocked(hasPendingWrites).mockResolvedValue(false);

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    const { result, rerender } = renderHook(() => useOnlineStatus());
    expect(result.current.syncDone).toBe(false);

    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: true,
      });
      window.dispatchEvent(new Event('online'));
    });
    rerender();

    // أول استطلاع بعد POLL_MIN_MS (2000ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    expect(hasPendingWrites).toHaveBeenCalled();
    expect(result.current.syncDone).toBe(true);
  });
});
