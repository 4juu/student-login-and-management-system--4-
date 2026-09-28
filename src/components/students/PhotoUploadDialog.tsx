import React, { useRef, useState } from 'react';
import { Camera, CheckCircle, Upload, XCircle } from 'lucide-react';
import { Student } from '../../types/student';
import { useFaceAI } from '../../hooks/useFaceAI';
import { EngineOverlay } from '../face/EngineOverlay';
import { faceDetectorService } from '../../services/faceAI/detector';
import { faceEmbedder } from '../../services/faceAI/embedder';
import { enrollPhotoSample } from '../../services/faceAI/photoEnrollment';
import { compressImageFile, decodeDataUri } from '../../lib/image';
import { savePhoto } from '../../firebase/photoService';
import { getActiveAcademicYear } from '../../firebase/dataService';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

interface PhotoUploadDialogProps {
  student: Student;
  students: Student[];
  adminUid: string;
  stageId: string;
  onUpdateStudent: (id: string, updates: Partial<Student>) => void;
  onClose: () => void;
}

type DialogState =
  | { kind: 'pick' }
  | { kind: 'working'; label: string }
  | { kind: 'done'; photo: string; message: string }
  | { kind: 'error'; message: string };

/** رفع صورة الطالب يدوياً من الأدمن — ضغط + كشف وجه + دمج كمرجع بصمة */
export const PhotoUploadDialog: React.FC<PhotoUploadDialogProps> = ({
  student,
  students,
  adminUid,
  stageId,
  onUpdateStudent,
  onClose,
}) => {
  const { ready: engineReady, progress, error, retry } = useFaceAI(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [state, setState] = useState<DialogState>({ kind: 'pick' });
  const [preview, setPreview] = useState<string | null>(null);

  useBodyScrollLock(true);

  const handleFile = async (file: File | undefined) => {
    if (!file || busyRef.current) return;
    busyRef.current = true;
    try {
      setState({ kind: 'working', label: 'ضغط الصورة…' });
      const photo = await compressImageFile(file);
      setPreview(photo);

      setState({ kind: 'working', label: 'البحث عن الوجه في الصورة…' });
      const bitmap = await decodeDataUri(photo);
      const faces = await faceDetectorService.detectImage(bitmap);
      const face = faces[0];
      if (!face) {
        setState({ kind: 'error', message: 'لم نعثر على وجه واضح في الصورة — اختر صورة أخرى' });
        return;
      }

      setState({ kind: 'working', label: 'استخراج البصمة…' });
      const res = await faceEmbedder.embed(bitmap, face.box);
      if ((res.quality.composite ?? 0) < 0.50) {
        setState({
          kind: 'error',
          message: res.quality.brightness < 0.3 ? 'الإضاءة ضعيفة جداً في الصورة' : 'جودة الصورة منخفضة — اختر صورة أوضح',
        });
        return;
      }

      const query = new Float32Array(res.descriptor as ArrayLike<number>);
      const quality = Math.round(((res.quality.composite + 0.8) / 2) * 100) / 100;
      const enrolled = enrollPhotoSample({
        query,
        quality,
        studentId: student.id,
        students,
        existing: student.faceDescriptor,
      });

      if (!enrolled.ok && enrolled.reason === 'tamper') {
        setState({ kind: 'error', message: `هذه الصورة تشبه طالباً مسجلاً مسبقاً (${enrolled.matchedWith})` });
        return;
      }

      const year = await getActiveAcademicYear();
      await savePhoto(year, adminUid, stageId, student.id, photo);

      if (enrolled.ok) {
        onUpdateStudent(student.id, {
          faceDescriptor: enrolled.gallery,
          faceRegisteredAt: new Date().toISOString(),
        });
        setState({
          kind: 'done',
          photo,
          message: enrolled.merged
            ? 'حُفظت الصورة وأُضيفت كمرجع بصمة إضافي'
            : 'حُفظت الصورة وأُنشئت منها بصمة الطالب',
        });
      } else {
        setState({
          kind: 'done',
          photo,
          message: 'حُفظت الصورة — لم تُضف بصمة جديدة (مطابقة لمراجع موجودة)',
        });
      }
    } catch (e) {
      console.error('[photo-upload] فشل رفع الصورة:', e);
      setState({ kind: 'error', message: e instanceof Error ? e.message : 'تعذر معالجة الصورة' });
    } finally {
      busyRef.current = false;
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
      {!engineReady && (
        <div className="w-full max-w-md">
          <EngineOverlay progress={progress} error={error} onRetry={retry} onCancel={onClose} />
        </div>
      )}

      {engineReady && (
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <span className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Camera className="w-5 h-5" />
              </span>
              <div>
                <h3 className="font-bold text-slate-800 text-sm">صورة الطالب</h3>
                <p className="text-xs text-slate-500">{student.name}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="إغلاق"
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 transition"
            >
              &times;
            </button>
          </div>

          <div className="p-5">
            {state.kind === 'working' && (
              <div className="text-center py-6">
                <div className="mx-auto w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mb-3">
                  <Upload className="w-6 h-6 text-indigo-500 animate-pulse" />
                </div>
                <p className="text-sm font-bold text-slate-700">{state.label}</p>
              </div>
            )}

            {state.kind === 'error' && (
              <div className="text-center py-4">
                <div className="mx-auto w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mb-3">
                  <XCircle className="w-6 h-6 text-red-500" />
                </div>
                <p className="text-sm font-bold text-red-600 mb-4">{state.message}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setState({ kind: 'pick' }); setPreview(null); }}
                    className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold transition"
                  >
                    اختيار صورة أخرى
                  </button>
                  <button
                    onClick={onClose}
                    className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold transition"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            )}

            {state.kind === 'done' && (
              <div className="text-center py-4">
                <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mb-3">
                  <CheckCircle className="w-6 h-6 text-emerald-500" />
                </div>
                {preview && (
                  <img
                    src={preview}
                    alt={`صورة ${student.name}`}
                    className="w-28 h-28 object-cover rounded-2xl border border-slate-200 mx-auto mb-3"
                  />
                )}
                <p className="text-sm font-bold text-emerald-600 mb-4">{state.message}</p>
                <button
                  onClick={onClose}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold transition"
                >
                  تم
                </button>
              </div>
            )}

            {state.kind === 'pick' && (
              <>
                {preview && (
                  <img
                    src={preview}
                    alt="معاينة"
                    className="w-32 h-32 object-cover rounded-2xl border border-slate-200 mx-auto mb-4"
                  />
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  aria-label="اختيار صورة الطالب"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    handleFile(f);
                  }}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-extrabold transition flex items-center justify-center gap-2"
                >
                  <Upload className="w-4 h-4" /> اختيار صورة من الجهاز
                </button>
                <p className="text-[11px] text-slate-500 text-center mt-3 leading-relaxed">
                  صورة واضحة للوجه بإضاءة جيدة — تُضغط تلقائياً وتُحفظ كمرجع بصمة إضافي
                </p>
                <button
                  onClick={onClose}
                  className="w-full mt-2 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold transition"
                >
                  إلغاء
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PhotoUploadDialog;
