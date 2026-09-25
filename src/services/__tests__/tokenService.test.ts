import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../firebase/config', () => ({
  database: {},
  auth: {},
  default: {},
}));

vi.mock('firebase/database', () => ({
  ref: vi.fn((_db: unknown, path?: string) => ({ path })),
  set: vi.fn(async () => undefined),
  get: vi.fn(async () => ({
    exists: () => false,
    val: () => null,
  })),
  update: vi.fn(async () => undefined),
  query: vi.fn((...args: unknown[]) => ({ args })),
  orderByChild: vi.fn((key: string) => ({ key })),
  equalTo: vi.fn((value: unknown) => ({ value })),
}));

vi.mock('../../firebase/dataService', () => ({
  getActiveAcademicYear: vi.fn(async () => '2025-2026'),
}));

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'TESTTOKEN1234567890'),
}));

import {
  formatRemainingMs,
  validateTestLink,
  validateLink,
  createTestLink,
  createBulkRegistrationLinks,
  getTestLink,
  getServerNow,
  syncServerTimeOffset,
  DEFAULT_TEST_LINK_MS,
  type TestLinkData,
} from '../tokenService';
import { get, set, update } from 'firebase/database';
import { RegistrationLink } from '../../types/registration';

describe('formatRemainingMs', () => {
  it('returns منتهي for non-finite input', () => {
    expect(formatRemainingMs(NaN)).toBe('منتهي');
    expect(formatRemainingMs(Infinity)).toBe('منتهي');
    expect(formatRemainingMs(-1)).toBe('منتهي');
    expect(formatRemainingMs(0)).toBe('منتهي');
  });

  it('formats minutes when < 60 minutes', () => {
    expect(formatRemainingMs(60_000)).toBe('1 دقيقة');
    expect(formatRemainingMs(30 * 60_000)).toBe('30 دقيقة');
    expect(formatRemainingMs(59 * 60_000)).toBe('59 دقيقة');
  });

  it('formats hours when < 24 hours', () => {
    expect(formatRemainingMs(60 * 60_000)).toBe('1 ساعة');
    expect(formatRemainingMs(90 * 60_000)).toBe('1 ساعة و30 دقيقة');
    expect(formatRemainingMs(23 * 60 * 60_000)).toBe('23 ساعة');
  });

  it('formats days when >= 24 hours', () => {
    expect(formatRemainingMs(24 * 60 * 60_000)).toBe('1 يوم');
    expect(formatRemainingMs(48 * 60 * 60_000)).toBe('2 يوم');
    expect(formatRemainingMs(25 * 60 * 60_000)).toBe('1 يوم و1 ساعة');
  });

  it('rounds sub-minute down to at least 1 minute', () => {
    expect(formatRemainingMs(1)).toBe('1 دقيقة');
    expect(formatRemainingMs(30_000)).toBe('1 دقيقة');
  });
});

describe('validateTestLink', () => {
  const base: TestLinkData = {
    token: 'tok',
    adminUid: 'admin',
    stageId: 'stage1',
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + 60_000,
  };

  it('rejects null link', () => {
    const r = validateTestLink(null);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('الرابط غير موجود');
  });

  it('rejects non-finite expiresAt', () => {
    const r = validateTestLink({ ...base, expiresAt: NaN });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('الرابط غير صالح');
  });

  it('rejects expired link', () => {
    const r = validateTestLink({ ...base, expiresAt: Date.now() - 1000 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('انتهت صلاحية الرابط');
  });

  it('accepts valid future link', () => {
    const r = validateTestLink(base);
    expect(r.valid).toBe(true);
    expect(r.reason).toBeUndefined();
  });
});

describe('validateLink (RegistrationLink)', () => {
  const base = {
    token: 't',
    adminUid: 'a',
    stageId: 's',
    type: 'test' as const,
    createdBy: 'a',
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + 60_000,
    used: false,
  } as RegistrationLink;

  it('rejects null', () => {
    expect(validateLink(null).valid).toBe(false);
  });

  it('rejects expired', () => {
    expect(validateLink({ ...base, expiresAt: Date.now() - 1 }).valid).toBe(false);
  });

  it('rejects non-finite expiresAt (NaN never-valid links)', () => {
    expect(validateLink({ ...base, expiresAt: NaN }).valid).toBe(false);
    expect(validateLink({ ...base, expiresAt: NaN }).reason).toBe('الرابط غير صالح');
  });

  it('accepts valid future link even if used=true (single links stay open)', () => {
    expect(validateLink({ ...base, used: true }).valid).toBe(true);
  });
});

describe('createTestLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a test link with token and face-test URL', async () => {
    const result = await createTestLink('admin1', 'stage1');
    expect(result.token).toBe('TESTTOKEN1234567890');
    expect(result.url).toContain('/face-test.html?test=TESTTOKEN1234567890');
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(set).toHaveBeenCalled();
  });

  it('respects custom expiryMs', async () => {
    const day = 24 * 60 * 60 * 1000;
    const result = await createTestLink('admin1', 'stage1', 2 * day);
    const remaining = result.expiresAt - Date.now();
    expect(remaining).toBeLessThanOrEqual(2 * day + 5000);
    expect(remaining).toBeGreaterThan(2 * day - 5000);
  });

  it('falls back to default expiry for invalid expiryMs', async () => {
    const result = await createTestLink('admin1', 'stage1', NaN);
    const remaining = result.expiresAt - Date.now();
    expect(remaining).toBeLessThanOrEqual(DEFAULT_TEST_LINK_MS + 5000);
    expect(remaining).toBeGreaterThan(DEFAULT_TEST_LINK_MS - 5000);
  });
});

describe('getTestLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** syncServerTimeOffset calls get('.info/serverTimeOffset') first — answer by path */
  const mockGetByPath = (linkSnap: unknown) => {
    vi.mocked(get).mockImplementation(async (r: unknown) => {
      const path = (r as { path?: string })?.path ?? '';
      if (path.includes('serverTimeOffset')) {
        return { val: () => 0 } as never;
      }
      return linkSnap as never;
    });
  };

  it('returns null when link does not exist', async () => {
    mockGetByPath({ exists: () => false, val: () => null });
    expect(await getTestLink('missing')).toBeNull();
  });

  it('returns null for non-test type link', async () => {
    mockGetByPath({
      exists: () => true,
      val: () => ({ type: 'single', token: 'x', adminUid: 'a', stageId: 's', createdAt: '', expiresAt: 1 }),
    });
    expect(await getTestLink('single-token')).toBeNull();
  });

  it('returns test link data for valid test link', async () => {
    const data = {
      type: 'test',
      token: 'tok1',
      adminUid: 'admin',
      stageId: 'stage1',
      createdAt: '2026-01-01',
      expiresAt: Date.now() + 100000,
    };
    mockGetByPath({ exists: () => true, val: () => data });
    const result = await getTestLink('tok1');
    expect(result).toEqual({
      token: 'tok1',
      adminUid: 'admin',
      stageId: 'stage1',
      createdAt: '2026-01-01',
      expiresAt: data.expiresAt,
    });
  });
});

describe('getServerNow / syncServerTimeOffset', () => {
  it('getServerNow returns a number close to Date.now with zero offset', () => {
    const before = Date.now();
    const now = getServerNow();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it('syncServerTimeOffset does not throw when Firebase fails', async () => {
    vi.mocked(get).mockRejectedValueOnce(new Error('offline'));
    await expect(syncServerTimeOffset()).resolves.toBeUndefined();
  });
});

describe('createBulkRegistrationLinks — single vs namecheck', () => {
  const students = [{ id: 's1', name: 'أحمد علي حسن', code: 'C1' }];

  const lastUpdatedLink = (): RegistrationLink => {
    const calls = vi.mocked(update).mock.calls;
    const updates = calls[calls.length - 1]![1] as Record<string, RegistrationLink>;
    const keys = Object.keys(updates);
    expect(keys).toHaveLength(1);
    return updates[keys[0]!]!;
  };

  beforeEach(() => {
    vi.mocked(update).mockClear();
  });

  it('defaults to type single with register URL', async () => {
    const res = await createBulkRegistrationLinks('adm1', 'stg1', students);
    expect(res).toHaveLength(1);
    expect(res[0]!.token).toBe('TESTTOKEN1234567890');
    expect(res[0]!.url).toContain('/register.html?reg=TESTTOKEN1234567890');
    const link = lastUpdatedLink();
    expect(link.type).toBe('single');
    expect(link.studentName).toBe('أحمد علي حسن');
    expect(link.studentCode).toBe('C1');
  });

  it('writes type namecheck when requested', async () => {
    const res = await createBulkRegistrationLinks('adm1', 'stg1', students, 7, 'namecheck');
    expect(res).toHaveLength(1);
    expect(lastUpdatedLink().type).toBe('namecheck');
  });

  it('validateLink accepts an unused non-expired namecheck link', () => {
    const link = {
      token: 't',
      adminUid: 'a',
      stageId: 's',
      type: 'namecheck',
      createdBy: 'a',
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + 60_000,
      used: false,
    } as RegistrationLink;
    expect(validateLink(link).valid).toBe(true);
  });
});
