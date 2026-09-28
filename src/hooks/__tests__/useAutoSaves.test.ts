import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../firebase/dataService', () => ({
  saveColleges: vi.fn(async () => undefined),
  saveStages: vi.fn(async () => undefined),
  saveStudents: vi.fn(async () => undefined),
  saveAttendanceRecords: vi.fn(async () => undefined),
  saveSessions: vi.fn(async () => undefined),
  saveActiveSession: vi.fn(async () => undefined),
}));

vi.mock('../../lib/offlineOutbox', () => ({
  hasOutboxEntries: vi.fn(async () => false),
  queueOutbox: vi.fn(async () => undefined),
}));

vi.mock('../../lib/sentry', () => ({
  captureException: vi.fn(),
}));

import { useAutoSaves, type IntentionalDeleteFlags } from '../useAutoSaves';
import { saveAttendanceRecords, saveStudents } from '../../firebase/dataService';
import {
  flushAllPendingSaves,
  cancelAllPendingSaves,
  getPendingPreSavesCount,
} from '../../firebase/saveQueue';
import type { User } from '../../types/user';
import type { AttendanceRecord, Student } from '../../types/student';

const currentUser = { uid: 'admin1', role: 'admin' } as unknown as User;
const flags: IntentionalDeleteFlags = {
  students: false,
  records: false,
  sessions: false,
  colleges: false,
  stages: false,
};
const intentionalDeleteRef = { current: flags };
const getAdminUid = () => 'admin1';
const getTeacherId = () => 't1';
const setAllStagesData = vi.fn();

const baseParams = {
  currentUser,
  dataLoaded: true,
  colleges: [],
  stages: [],
  students: [] as Student[],
  attendanceRecords: [] as AttendanceRecord[],
  sessions: [],
  activeSessionId: null as string | null,
  selectedStageId: 's1' as string | null,
  universityDataLoaded: false,
  intentionalDeleteRef,
  getAdminUid,
  getTeacherId,
  setAllStagesData,
};

const r1 = { id: 'r1' } as AttendanceRecord;
const r2 = { id: 'r2' } as AttendanceRecord;

type Props = { recs: AttendanceRecord[]; stageId: string | null };

const renderRecords = (initial: Props) =>
  renderHook(
    ({ recs, stageId }: Props) =>
      useAutoSaves({ ...baseParams, attendanceRecords: recs, selectedStageId: stageId }),
    { initialProps: initial }
  );

describe('useAutoSaves — الجدولة عبر موديول (لا setTimeout داخل useEffect)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    cancelAllPendingSaves();
    flags.students = false;
    flags.records = false;
    flags.sessions = false;
    flags.colleges = false;
    flags.stages = false;
  });

  afterEach(() => {
    cancelAllPendingSaves();
    vi.useRealTimers();
  });

  it('الحذف يُصفّى فوراً داخل الأثر رغم تغيّر deps (كان المؤقّت يُلغى ويعود السجل)', async () => {
    const { rerender } = renderRecords({ recs: [r1, r2], stageId: 's1' });

    // حذف سجل — handleDeleteRecord يضبط القوة ثم يغيّر الحالة
    flags.records = true;
    rerender({ recs: [r2], stageId: 's1' });

    // النقصان (حذف) ⇒ flushIfDeleted صفّى الطابور داخل الأثر نفسه — لم يبقَ شيء للمؤقّت
    expect(getPendingPreSavesCount()).toBe(0);

    // خروج فوري (handleBackToStages: تفريغ + إلغاء التحديد) لا يُبطل ما بدأ
    rerender({ recs: [], stageId: null });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(saveAttendanceRecords).toHaveBeenCalledTimes(1);
    expect(saveAttendanceRecords).toHaveBeenCalledWith('admin1', 's1', 't1', [r2], true);
    expect(flags.records).toBe(false);
  });

  it('الحذف لا ينتظر 500ms — يُستدعى الحفظ مباشرة بعد التصفية', async () => {
    const { rerender } = renderRecords({ recs: [r1, r2], stageId: 's1' });

    flags.records = true;
    rerender({ recs: [r2], stageId: 's1' });

    // بلا advanceTimers (صفر مللي ثانية) — التصفية الفورية تكفي لبدء السلسلة
    expect(getPendingPreSavesCount()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(saveAttendanceRecords).toHaveBeenCalledWith('admin1', 's1', 't1', [r2], true);
    expect(getPendingPreSavesCount()).toBe(0);
  });

  it('البذرة تمنع echo write عند التحميل ثم يُحفظ التغيير اللاحق', async () => {
    const { rerender } = renderRecords({ recs: [r1, r2], stageId: 's1' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(saveAttendanceRecords).not.toHaveBeenCalled();

    rerender({ recs: [r2], stageId: 's1' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(saveAttendanceRecords).toHaveBeenCalledTimes(1);
    expect(saveAttendanceRecords).toHaveBeenCalledWith('admin1', 's1', 't1', [r2], false);
  });

  it('flushAllPendingSaves ينفّذ الحفظ المعلّق فوراً (مسار زر الرجوع/دخول مرحلة)', async () => {
    const { rerender } = renderRecords({ recs: [r1, r2], stageId: 's1' });
    flags.records = true;
    rerender({ recs: [r2], stageId: 's1' });

    await act(async () => {
      await flushAllPendingSaves();
    });

    expect(saveAttendanceRecords).toHaveBeenCalledWith('admin1', 's1', 't1', [r2], true);
    expect(getPendingPreSavesCount()).toBe(0);
    expect(flags.records).toBe(false);
  });

  it('حذف الطلاب يمرّ بالمسار نفسه مع teacherId لكاش المرحلة', async () => {
    const s1 = { id: 's1x' } as Student;
    const s2 = { id: 's2x' } as Student;
    const { rerender } = renderHook(
      ({ studs }: { studs: Student[] }) =>
        useAutoSaves({ ...baseParams, students: studs }),
      { initialProps: { studs: [s1, s2] } }
    );

    flags.students = true;
    rerender({ studs: [s2] });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(saveStudents).toHaveBeenCalledTimes(1);
    expect(saveStudents).toHaveBeenCalledWith('admin1', 's1', [s2], true, 't1');
    expect(flags.students).toBe(false);
  });
});
