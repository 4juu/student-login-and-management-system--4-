// Offline outbox: re-upload queued writes when connectivity returns

import { ref, set } from "firebase/database";
import { database } from "./config";
import { AttendanceRecord } from "../types/student";
import { getOutboxEntries, removeOutboxEntry } from "../lib/offlineOutbox";
import { getActiveAcademicYear } from "./academicYear";
import { getYearBasePath, getStagePath, getTeacherDataPath } from "./paths";
import { stripUndefined } from "./localCache";

export const applyOutbox = async (): Promise<void> => {
  const entries = await getOutboxEntries();
  if (entries.length === 0) return;

  console.log(`📦 تطبيق ${entries.length} عنصر من صندوق الأوفلاين...`);
  const year = await getActiveAcademicYear();
  const succeededKeys: string[] = [];

  for (const entry of entries) {
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
        const { compressRecord } = await import('./dataServiceCompressed');
        const compressed = (entry.data as AttendanceRecord[]).map(compressRecord);
        await set(
          ref(database, `${getYearBasePath(year, uid)}/stageData/${sid}/teacherRecords/${tid}/recordsCompressed`),
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
  }

  // نمسح فقط العناصر التي رُفعت بنجاح؛ الباقي يبقى لمحاولة لاحقة
  for (const key of succeededKeys) {
    await removeOutboxEntry(key);
  }
  if (succeededKeys.length === entries.length) {
    console.log('✅ تم رفع صندوق الأوفلاين بالكامل');
  } else {
    console.warn(`⚠️ بقي ${entries.length - succeededKeys.length} عنصر في صندوق الأوفلاين لمحاولة لاحقة`);
  }
};
