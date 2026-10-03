import { describe, it, expect, vi, beforeEach } from 'vitest';

const { signInMock, signOutMock, getMock, setMock, refMock } = vi.hoisted(() => {
  const signInMock = vi.fn(async () => ({ user: { uid: 'T1', email: 't@x.com', displayName: 'T' } }));
  const signOutMock = vi.fn(async () => undefined);
  const getMock = vi.fn(
    async (_r: { path: string }): Promise<{ exists: () => boolean; val?: () => unknown }> =>
      ({ exists: () => false })
  );
  const setMock = vi.fn(async () => undefined);
  const refMock = vi.fn((_db: unknown, path: string) => ({ path }));
  return { signInMock, signOutMock, getMock, setMock, refMock };
});

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: signInMock,
  signOut: signOutMock,
  createUserWithEmailAndPassword: vi.fn(),
  updateProfile: vi.fn(),
  updatePassword: vi.fn(),
}));

vi.mock('firebase/database', () => ({
  ref: refMock,
  set: setMock,
  get: getMock,
  update: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
  query: vi.fn(),
  orderByChild: vi.fn(),
  equalTo: vi.fn(),
}));

vi.mock('../config', () => ({ auth: {}, database: {}, secondaryAuth: {} }));

import { signIn } from '../authService';

const profileOf = (over: Record<string, unknown>) => ({
  uid: 'T1',
  email: 't@x.com',
  displayName: 'T',
  role: 'teacher',
  active: true,
  ...over,
});

describe('signIn — بوابات الحساب', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('يحجب حساباً معطّلاً: signOut + رسالة مقصودة + بلا كتابة lastLogin', async () => {
    getMock.mockImplementation(async (r: { path: string }) =>
      r.path === 'users/T1'
        ? { exists: () => true, val: () => profileOf({ active: false }) }
        : { exists: () => false }
    );

    const err = await signIn('t@x.com', 'pw').catch((e: any) => e);
    expect(err.message).toBe('حسابك معطّل — تواصل مع الإدارة');
    expect(err.code).toBe('app/blocked');
    expect(signOutMock).toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });

  it('يحجب حساباً محذوفاً عبر tombstone حتى لو كان Auth صالحاً', async () => {
    getMock.mockImplementation(async (r: { path: string }) => {
      if (r.path === 'deletedAccounts/T1') return { exists: () => true };
      return { exists: () => false };
    });

    const err = await signIn('t@x.com', 'pw').catch((e: any) => e);
    expect(err.message).toBe('هذا الحساب محذوف — تواصل مع الإدارة');
    expect(err.code).toBe('app/blocked');
    expect(signOutMock).toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled(); // لا يُعاد إنشاء البروفايل
  });

  it('فشل قراءة deletedAccounts (قواعد غير مرفوعة) لا يمنع حساباً جديداً', async () => {
    getMock.mockImplementation(async (r: { path: string }) => {
      if (r.path === 'deletedAccounts/T1') throw Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' });
      return { exists: () => false };
    });

    const user = await signIn('t@x.com', 'pw');
    expect(user.role).toBe('teacher');
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/T1' }),
      expect.objectContaining({ active: true })
    );
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('حساب سليم يدخل ويحدّث lastLogin', async () => {
    getMock.mockImplementation(async (r: { path: string }) =>
      r.path === 'users/T1'
        ? { exists: () => true, val: () => profileOf({ active: true }) }
        : { exists: () => false }
    );

    const user = await signIn('t@x.com', 'pw');
    expect(user.uid).toBe('T1');
    expect(user.lastLogin).toBeTruthy();
    expect(signOutMock).not.toHaveBeenCalled();
    expect(setMock).toHaveBeenCalled();
  });
});
