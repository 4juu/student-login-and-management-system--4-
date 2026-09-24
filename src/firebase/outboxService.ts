// ============================================================
// 📮 OUTBOX - إعادة رفع الكتابات المؤجلة عند عودة الاتصال
// ============================================================

import { ref, update } from "firebase/database";
import { database } from "./config";
import { getOutboxEntries, removeOutboxEntries } from "../lib/offlineOutbox";
import { getActiveAcademicYear } from "./academicYear";
import { getStagePath, getTeacherDataPath } from "./paths";
import { stripUndefined } from "./localCache";
import { captureException } from "../lib/sentry";
import type { AttendanceRecord } from "../types/student";

// ============================================================
// ⚡️ رفع صندوق الأوفلاين بالتوازي (بدل عنصرٍ بعنصر تسلسلياً)
// عند رجوع النت مع صندوق مليء، كل العناصر تُرفع دفعةً واحدة
// مما يختصر زمن الانتظار إلى جزءٍ يسير من الزمن السابق.
// single-flight: نداءات متزامنة (main.tsx + saveQueue online + useOnlineStatus)
// تندمج في جولة رفع واحدة بدل تشغيل عدة جولات متوازية على نفس العناصر.
// ============================================================
let applyFlight: Promise<void> | null = null;
let applyRerun = false;

const doApplyOutbox = async (): Promise<void> => {
  const entries = await getOutboxEntries();
  if (entries.length === 0) return;

  const year = await getActiveAcademicYear();
  // تحميل مرة واحدة قبل الحلقة (بدل await import لكل عنصر)
  const [{ compressRecord }, { buildStudentAttendanceIndexUpdates }] = await Promise.all([
    import('./dataServiceCompressed'),
    import('./attendanceService'),
  ]);

  // تجميع كل العناصر في update() واحد بدل set() لكل عنصر
  const updates: Record<string, unknown> = {};
  const succeededKeys: string[] = [];

  for (const entry of entries) {
    try {
      // المسار المثبّت وقت الطبع يحمي من تغيّر السنة الأكاديمية قبل التصفيية
      if (entry.path) {
        if (entry.key.startsWith('records_')) {
          const raw = entry.data as AttendanceRecord[];
          updates[entry.path] = raw.map(compressRecord);
          // فهرس per-student: اشتق المسار من مسار recordsCompressed
          try {
            const m = entry.path.match(/^(.*)\/stageData\/([^/]+)\/teacherRecords\/([^/]+)\/recordsCompressed$/);
            if (m && m[1]) {
              const [, yearBase, sid, tid] = m;
              const ym = yearBase.match(/^academicYears\/([^/]+)\/userData\/([^/]+)$/);
              if (ym && ym[1] && ym[2] && sid && tid) {
                Object.assign(updates, await buildStudentAttendanceIndexUpdates(ym[1], ym[2], sid, tid, raw));
              }
            }
          } catch (e) {
            console.warn('⚠️ outbox: فشل تحديث فهرس studentAttendance:', e);
            captureException(e, { fn: 'outbox.buildIndex', entryKey: entry.key });
          }
        } else if (entry.key.startsWith('activeSession_')) {
          updates[entry.path] = entry.data ? (entry.data as string) : null;
        } else {
          const payload = Array.isArray(entry.data)
            ? (entry.data as unknown[]).map(stripUndefined as any)
            : entry.data;
          updates[entry.path] = payload;
        }
        succeededKeys.push(entry.key);
        continue;
      }

      if (entry.key.startsWith('students_')) {
        const rest = entry.key.slice('students_'.length);
        const sid = rest.slice(rest.lastIndexOf('_') + 1);
        const uid = rest.slice(0, rest.lastIndexOf('_'));
        updates[getStagePath(year, uid, sid, 'students')] =
          (entry.data as unknown[]).map(stripUndefined as any);
      } else if (entry.key.startsWith('records_')) {
        const rest = entry.key.slice('records_'.length);
        const tid = rest.slice(rest.lastIndexOf('_') + 1);
        const middle = rest.slice(0, rest.lastIndexOf('_'));
        const sid = middle.slice(middle.lastIndexOf('_') + 1);
        const uid = middle.slice(0, middle.lastIndexOf('_'));
        // loadAttendanceRecords يقرأ recordsCompressed أولاً — يجب أن نكتب هنا
        const raw = entry.data as AttendanceRecord[];
        updates[getTeacherDataPath(year, uid, sid, tid, 'recordsCompressed')] = raw.map(compressRecord);
        try {
          Object.assign(updates, await buildStudentAttendanceIndexUpdates(year, uid, sid, tid, raw));
        } catch (e) {
          console.warn('⚠️ outbox: فشل تحديث فهرس studentAttendance:', e);
          captureException(e, { fn: 'outbox.buildIndex', entryKey: entry.key });
        }
      } else if (entry.key.startsWith('sessions_')) {
        const rest = entry.key.slice('sessions_'.length);
        const tid = rest.slice(rest.lastIndexOf('_') + 1);
        const middle = rest.slice(0, rest.lastIndexOf('_'));
        const sid = middle.slice(middle.lastIndexOf('_') + 1);
        const uid = middle.slice(0, middle.lastIndexOf('_'));
        updates[getTeacherDataPath(year, uid, sid, tid, 'sessions')] =
          (entry.data as unknown[]).map(stripUndefined as any);
      } else if (entry.key.startsWith('activeSession_')) {
        const rest = entry.key.slice('activeSession_'.length);
        const tid = rest.slice(rest.lastIndexOf('_') + 1);
        const middle = rest.slice(0, rest.lastIndexOf('_'));
        const sid = middle.slice(middle.lastIndexOf('_') + 1);
        const uid = middle.slice(0, middle.lastIndexOf('_'));
        const path = getTeacherDataPath(year, uid, sid, tid, 'activeSession');
        updates[path] = entry.data ? (entry.data as string) : null;
      }
      succeededKeys.push(entry.key);
    } catch (e) {
      console.error('❌ فشل تطبيق عنصر من صندوق الأوفلاين:', entry.key, e);
      captureException(e, { fn: 'outbox.applyEntry', entryKey: entry.key });
    }
  }

  // رفع كل شيء في round-trip واحد (atomic multi-path update)
  if (Object.keys(updates).length > 0) {
    try {
      await update(ref(database), updates);
    } catch (e) {
      console.error('❌ فشل رفع دفعة صندوق الأوفلاين:', e);
      captureException(e, { fn: 'outbox.batchUpdate', count: succeededKeys.length });
      return; // نُبقي كل العناصر للمحاولة التالية
    }
  }

  // نمسح فقط العناصر التي رُفعت بنجاح؛ الباقي يبقى لمحاولة لاحقة
  if (succeededKeys.length > 0) {
    await removeOutboxEntries(succeededKeys);
  }
  if (succeededKeys.length !== entries.length) {
    console.warn(`⚠️ بقي ${entries.length - succeededKeys.length} عنصر في صندوق الأوفلاين لمحاولة لاحقة`);
  }
};

export const applyOutbox = async (): Promise<void> => {
  if (applyFlight) {
    applyRerun = true;
    return applyFlight;
  }
  applyFlight = (async () => {
    try {
      do {
        applyRerun = false;
        await doApplyOutbox();
      } while (applyRerun);
    } finally {
      applyFlight = null;
    }
  })();
  return applyFlight;
};
