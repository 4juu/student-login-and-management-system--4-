// صور الطلاب — تُخزَّن كـ data URI داخل RTDB (مجاني 100% — بلا Firebase Storage)
import { get, ref, remove, set } from 'firebase/database';
import { database } from './config';
import { getStagePath } from './paths';
import { isValidPhotoDataUri } from '../lib/image';

const photosPath = (year: string, adminUid: string, stageId: string) =>
  getStagePath(year, adminUid, stageId, 'photos');

export async function savePhoto(
  year: string,
  adminUid: string,
  stageId: string,
  studentId: string,
  dataUri: string,
): Promise<void> {
  if (!stageId || !studentId) throw new Error('بيانات الصورة ناقصة');
  if (!isValidPhotoDataUri(dataUri)) throw new Error('صيغة الصورة غير مدعومة');
  await set(ref(database, `${photosPath(year, adminUid, stageId)}/${studentId}`), dataUri);
}

export async function loadPhoto(
  year: string,
  adminUid: string,
  stageId: string,
  studentId: string,
): Promise<string | null> {
  if (!stageId || !studentId) return null;
  const snap = await get(ref(database, `${photosPath(year, adminUid, stageId)}/${studentId}`));
  const value = snap.val();
  return isValidPhotoDataUri(value) ? value : null;
}

export async function removePhoto(
  year: string,
  adminUid: string,
  stageId: string,
  studentId: string,
): Promise<void> {
  if (!stageId || !studentId) return;
  await remove(ref(database, `${photosPath(year, adminUid, stageId)}/${studentId}`));
}
