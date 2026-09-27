import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/offlineOutbox', () => ({
  hasOutboxEntries: vi.fn(async () => false),
  queueOutbox: vi.fn(async () => undefined),
}));

vi.mock('../../lib/sentry', () => ({
  captureException: vi.fn(),
}));

import {
  debouncedPreSave,
  flushAllPendingSaves,
  cancelAllPendingSaves,
  getPendingPreSavesCount,
  debouncedSave,
} from '../saveQueue';

describe('saveQueue — الطبقة الأولى (pre-save)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cancelAllPendingSaves();
  });

  afterEach(() => {
    cancelAllPendingSaves();
    vi.useRealTimers();
  });

  it('يشغّل الحفظ المؤجّل بعد 500ms', () => {
    const fn = vi.fn();
    debouncedPreSave('k1', fn);
    expect(getPendingPreSavesCount()).toBe(1);
    vi.advanceTimersByTime(499);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getPendingPreSavesCount()).toBe(0);
  });

  it('يجمع الاستدعاءات بنفس المفتاح — آخر دالة تنتصر', () => {
    const first = vi.fn();
    const second = vi.fn();
    debouncedPreSave('same', first);
    vi.advanceTimersByTime(300);
    debouncedPreSave('same', second);
    vi.advanceTimersByTime(500);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('مفاتيح مختلفة تعمل مستقلة', () => {
    const a = vi.fn();
    const b = vi.fn();
    debouncedPreSave('key-a', a);
    debouncedPreSave('key-b', b);
    vi.advanceTimersByTime(500);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('flushAllPendingSaves يشغّل الطبقة الأولى فوراً ثم طبقة الحفظ التابعة لها', async () => {
    const saveFn = vi.fn(async () => undefined);
    debouncedPreSave('pending', () => {
      debouncedSave('inner', saveFn);
    });

    await flushAllPendingSaves();

    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(getPendingPreSavesCount()).toBe(0);
  });

  it('cancelAllPendingSaves يلغي الطبقة الأولى', () => {
    const fn = vi.fn();
    debouncedPreSave('cancelled', fn);
    cancelAllPendingSaves();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
    expect(getPendingPreSavesCount()).toBe(0);
  });

  it('beforeunload يشغّل الطبقة الأولى ويعيد طبقة ثانية فوراً', async () => {
    const saveFn = vi.fn(async () => undefined);
    debouncedPreSave('unload', () => {
      debouncedSave('unload-inner', saveFn);
    });

    window.dispatchEvent(new Event('beforeunload'));
    expect(getPendingPreSavesCount()).toBe(0);

    // سلسلة وعدّات ميكروتاسك (نجاح أول محاولة — بلا مؤقّتات)
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(saveFn).toHaveBeenCalledTimes(1);
  });
});
