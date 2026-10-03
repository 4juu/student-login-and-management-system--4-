import { describe, it, expect, vi, beforeEach } from 'vitest';

const { removeMock, setMock, refMock } = vi.hoisted(() => {
  const removeMock = vi.fn(async (..._args: unknown[]) => undefined);
  const setMock = vi.fn(async (..._args: unknown[]) => undefined);
  const refMock = vi.fn((_db: unknown, path: string) => ({ path }));
  return { removeMock, setMock, refMock };
});

vi.mock('firebase/database', () => ({
  ref: refMock,
  set: setMock,
  remove: removeMock,
  get: vi.fn(async () => ({ exists: () => false })),
  update: vi.fn(async () => undefined),
  query: vi.fn(),
  orderByChild: vi.fn(),
  equalTo: vi.fn(),
}));

vi.mock('../config', () => ({ auth: {}, database: {}, secondaryAuth: {} }));

import { deleteTeacherAccount } from '../authService';

describe('deleteTeacherAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('يحذف users وteacherAccounts ويسجل deletedAccounts دون لمس userData', async () => {
    await deleteTeacherAccount('T1');

    const removedPaths = removeMock.mock.calls.map(c => (c[0] as { path: string }).path);
    expect(removedPaths).toEqual(['users/T1', 'teacherAccounts/T1']);
    expect(removedPaths).not.toContain('userData/T1');

    const setPaths = setMock.mock.calls.map(c => (c[0] as { path: string }).path);
    expect(setPaths).toEqual(['deletedAccounts/T1']);
  });

  it('يرمي رسالة تحمل سبب Firebase الحقيقي عند الرفض', async () => {
    removeMock.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' }));

    await expect(deleteTeacherAccount('T2')).rejects.toThrow('PERMISSION_DENIED');
  });
});
