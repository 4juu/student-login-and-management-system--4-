// ============================================================
// 📮 OUTBOX - إعادة رفع الكتابات المؤجلة عند عودة الاتصال
// ============================================================

import { ref, set } from "firebase/database";
import { database } from "./config";
import { getOutboxEntries, removeOutboxEntry } from "../lib/offlineOutbox";
import { getActiveAcademicYear } from "./academicYear";
import { getStagePath, getTeacherDataPath } from "./paths";
import { stripUndefined } from "./localCache";
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
  const succeededKeys: string[] = [];

  // ⚡️ التوازي: رفع كل عناصر الصندوق دفعة واحدة بدل التسلسل
  await Promise.allSettled(
    entries.map(async entry => {
      try {
        if (entry.key.startsWith('students_')) {
          const rest = entry.key.slice('students_'.length);
          const sid = rest.slice(rest.lastIndexOf('_') + 1);
          const uid = rest.slice(0, rest.lastIndexOf('_'));
          await set(
            ref(database, getStagePath(year, uid, sid, 'students')),
            (entry.data as unknown[]).map(stripUndefined as any)
          );
        } else if (entry.key.startsWith('records_')) {
          const rest = entry.key.slice('records_'.length);
          const tid = rest.slice(rest.lastIndexOf('_') + 1);
          const middle = rest.slice(0, rest.lastIndexOf('_'));
          const sid = middle.slice(middle.lastIndexOf('_') + 1);
          const uid = middle.slice(0, middle.lastIndexOf('_'));
          // loadAttendanceRecords يقرأ recordsCompressed أولاً — يجب أن نكتب هنا
          // (dynamic import لتجنب تحميل XLSX في المسار الحرج)
          const { compressRecord } = await import('./dataServiceCompressed');
          const compressed = (entry.data as AttendanceRecord[]).map(compressRecord);
          await set(
            ref(database, getTeacherDataPath(year, uid, sid, tid, 'recordsCompressed')),
            compressed
          );
        } else if (entry.key.startsWith('sessions_')) {
          const rest = entry.key.slice('sessions_'.length);
          const tid = rest.slice(rest.lastIndexOf('_') + 1);
          const middle = rest.slice(0, rest.lastIndexOf('_'));
          const sid = middle.slice(middle.lastIndexOf('_') + 1);
          const uid = middle.slice(0, middle.lastIndexOf('_'));
          await set(
            ref(database, getTeacherDataPath(year, uid, sid, tid, 'sessions')),
            (entry.data as unknown[]).map(stripUndefined as any)
          );
        }
        succeededKeys.push(entry.key);
      } catch (e) {
        console.error('❌ فشل تطبيق عنصر من صندوق الأوفلاين:', entry.key, e);
      }
    })
  );

  // نمسح فقط العناصر التي رُفعت بنجاح؛ الباقي يبقى لمحاولة لاحقة
  for (const key of succeededKeys) {
    await removeOutboxEntry(key);
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
