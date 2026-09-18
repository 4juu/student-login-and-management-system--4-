import { useState, useEffect, useRef, useCallback } from 'react';
import { useFaceAI } from '../../hooks/useFaceAI';
import { EngineOverlay } from './EngineOverlay';
import { getTestLink, validateTestLink, type TestLinkData } from '../../services/tokenService';
import { loadStageStudentsCached } from '../SelfRegister/SelfEnrollPage';
import { hasValidDescriptor, MATCH_LOOSE, MIN_RECOG_CONFIDENCE } from '../../services/faceAI/descriptors';
import { findBestMatchIndexed, buildGallery } from '../../services/faceAI/gallery';
import { faceDetectorService, grabVideoFrame } from '../../services/faceAI/detector';
import { faceEmbedder } from '../../services/faceAI/embedder';
import { openCameraStream } from '../../services/faceAI/camera';
import type { Student } from '../../types/student';
import { ScanFace, CheckCircle, XCircle, AlertTriangle, RefreshCw, Camera } from 'lucide-react';
import '../SelfRegister/selfRegister.css';

interface FaceTestPageProps {
  testToken: string;
  onExit: () => void;
  onReEnroll: (stageId: string, adminUid: string) => void;
}

type TestStatus = 'loading' | 'invalid' | 'no-face' | 'pending' | 'ready' | 'scanning' | 'success' | 'failed';

export function FaceTestPage({ testToken, onExit, onReEnroll }: FaceTestPageProps) {
  const { ready: engineReady, progress, error: engineError, retry } = useFaceAI();
  const [status, setStatus] = useState<TestStatus>('loading');
  const [linkData, setLinkData] = useState<TestLinkData | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [matchedName, setMatchedName] = useState('');
  const [feedback, setFeedback] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runningRef = useRef(false);
  const loopTimerRef = useRef<number | null>(null);

  // تحميل بيانات الرابط وطلاب المرحلة
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const link = await getTestLink(testToken);
        if (cancelled) return;
        if (!link || !validateTestLink(link).valid) {
          setStatus('invalid');
          return;
        }
        setLinkData(link);
        // تحميل الطلاب — نستخدم adminUid من الرابط
        const s = await loadStageStudentsCached(link.adminUid, new Date().getFullYear().toString(), link.stageId);
        if (cancelled) return;
        setStudents(s);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('invalid');
      }
    })();
    return () => { cancelled = true; };
  }, [testToken]);

  // فتح الكاميرا والبدء بالمسح
  const startScan = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setStatus('scanning');
    setFeedback('جاري فتح الكاميرا...');

    try {
      const stream = await openCameraStream('user');
      streamRef.current = stream;
      if (!videoRef.current) {
        const v = document.createElement('video');
        v.srcObject = stream;
        v.autoplay = true;
        v.playsInline = true;
        v.muted = true;
        videoRef.current = v;
        await v.play();
      } else {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setFeedback('وجّه وجهك للكاميرا...');
      runLoop();
    } catch {
      setFeedback('فشل فتح الكاميرا — تحقق من الصلاحيات');
      setStatus('failed');
      runningRef.current = false;
    }
  }, []);

  const runLoop = useCallback(() => {
    const tick = async () => {
      if (!runningRef.current || !engineReady || !videoRef.current) {
        if (runningRef.current) loopTimerRef.current = window.setTimeout(tick, 100);
        return;
      }
      const video = videoRef.current;
      if (video.readyState < 2 || !video.videoWidth) {
        loopTimerRef.current = window.setTimeout(tick, 100);
        return;
      }
      try {
        const detections = faceDetectorService.detect(video, performance.now());
        if (detections.length === 0) {
          loopTimerRef.current = window.setTimeout(tick, 16);
          return;
        }
        // نأخذ أكبر وجه
        const face = detections[0];
        const bmp = await grabVideoFrame(video, faceEmbedder.recommendedMaxWidth);
        if (!bmp) { loopTimerRef.current = window.setTimeout(tick, 16); return; }
        const scale = bmp.width / video.videoWidth;
        const results = await faceEmbedder.embedBatch(bmp, [{
          x: face.box.x * scale, y: face.box.y * scale,
          width: face.box.width * scale, height: face.box.height * scale,
        }]);
        bmp.close();
        if (!results || results.length === 0) { loopTimerRef.current = window.setTimeout(tick, 16); return; }
        const res = results[0];
        const embedding = new Float32Array(res.descriptor);

        // مقارنة مع جميع الطلاب الذين لديهم بصمة موافق عليها
        const approvedStudents = students.filter(s =>
          hasValidDescriptor(s.faceDescriptor) && s.selfRegistrationApproved === true
        );
        if (approvedStudents.length === 0) {
          setStatus('no-face');
          setFeedback('لا يوجد طلاب بصماتهم موافق عليها بالمرحلة');
          stopScan();
          return;
        }
        const gallery = buildGallery(approvedStudents);
        const match = findBestMatchIndexed(embedding, gallery, MATCH_LOOSE, res.quality.composite);
        if (match && match.confidence >= MIN_RECOG_CONFIDENCE) {
          setMatchedName(match.item.id);
          setStatus('success');
          setFeedback('تم التعرف بنجاح — بصمتك تعمل!');
          stopScan();
          return;
        }
        // ما يتعرف — نستمر
        setFeedback('لم يتم التعرف — جرّب إضاءة أفضل أو اقترب قليلاً...');
      } catch { /* تجاهل */ }
      loopTimerRef.current = window.setTimeout(tick, 16);
    };
    tick();
  }, [engineReady, students]);

  const stopScan = useCallback(() => {
    runningRef.current = false;
    if (loopTimerRef.current) { clearTimeout(loopTimerRef.current); loopTimerRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => () => stopScan(), [stopScan]);

  const studentName = matchedName ? students.find(s => s.id === matchedName)?.name ?? '' : '';

  return (
    <div dir="rtl" className="sel-bg min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* حالة التحميل */}
        {status === 'loading' && (
          <div className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-[3px] border-blue-500 border-t-transparent" />
            <p className="text-[var(--sel-muted)]">جاري التحقق من الرابط...</p>
          </div>
        )}

        {/* رابط غير صالح */}
        {status === 'invalid' && (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10">
              <XCircle className="h-8 w-8 text-red-400" />
            </div>
            <h2 className="text-lg font-bold text-[var(--sel-text)] mb-2">الرابط غير صالح</h2>
            <p className="text-sm text-[var(--sel-muted)] mb-4">الرابط منتهي أو غير موجود. احصل على رابط جديد من الإدارة.</p>
            <button onClick={onExit} className="px-4 py-2 rounded-lg bg-[var(--sel-accent)] text-white font-medium text-sm">العودة</button>
          </div>
        )}

        {/* جاهز للاختبار */}
        {(status === 'ready' || status === 'failed') && (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#1458E2] to-[#2B7BFF] shadow-[0_8px_20px_rgba(20,88,226,0.3)]">
              <ScanFace className="h-8 w-8 text-white" />
            </div>
            <h2 className="text-lg font-bold text-[var(--sel-text)] mb-2">اختبار بصمة الوجه</h2>
            <p className="text-sm text-[var(--sel-muted)] mb-1">هذه صفحة لاختبار بصمة وجهك</p>
            <div className="bg-[var(--sel-bg-note)] border border-[var(--sel-line-note)] rounded-lg p-3 mb-4">
              <p className="text-xs text-[var(--sel-note-text)] leading-6">
                <AlertTriangle className="inline h-3.5 w-3.5 ml-1 text-amber-400" />
                لكي يعمل الاختبار، يجب أن تكون بصمتك <strong className="text-amber-300">محفوظة في النظام وموافق عليها</strong> من قبل الإدارة.
                إذا لم تسجل بصمتك بعد، استخدم رابط التسجيل أولاً.
              </p>
            </div>
            {feedback && status === 'failed' && (
              <p className="text-sm text-red-400 mb-3">{feedback}</p>
            )}
            <button
              onClick={startScan}
              disabled={!engineReady}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-[#1458E2] to-[#2B7BFF] text-white font-bold text-sm shadow-lg hover:shadow-xl transition disabled:opacity-50"
            >
              <Camera className="inline h-4 w-4 ml-2" />
              فتح الكاميرا واختبار البصمة
            </button>
            <button onClick={onExit} className="mt-3 text-sm text-[var(--sel-muted)] hover:text-[var(--sel-text)] transition">العودة</button>
          </div>
        )}

        {/* جاري المسح */}
        {status === 'scanning' && (
          <div className="text-center">
            <div className="relative mx-auto mb-4 w-48 h-48 rounded-2xl overflow-hidden border-2 border-blue-500/50">
              <video ref={el => {
                if (el && !videoRef.current) {
                  videoRef.current = el;
                  if (streamRef.current) { el.srcObject = streamRef.current; el.play(); }
                }
              }} autoPlay playsInline muted className="w-full h-full object-cover" />
              <div className="absolute inset-0 border-2 border-blue-400/30 rounded-2xl animate-pulse" />
            </div>
            <p className="text-sm text-[var(--sel-muted)] mb-3">{feedback}</p>
            <button onClick={() => { stopScan(); setStatus('ready'); }} className="text-sm text-[var(--sel-muted)] hover:text-red-400 transition">إلغاء</button>
          </div>
        )}

        {/* نجاح */}
        {status === 'success' && (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-green-500/10">
              <CheckCircle className="h-8 w-8 text-green-400" />
            </div>
            <h2 className="text-lg font-bold text-green-300 mb-2">البصمة تعمل!</h2>
            <p className="text-sm text-[var(--sel-muted)] mb-1">تم التعرف على وجهك بنجاح</p>
            {studentName && <p className="text-sm text-[var(--sel-accent-soft)] mb-4">مرحباً {studentName}</p>}
            <button onClick={() => { setStatus('ready'); setFeedback(''); setMatchedName(''); }} className="px-4 py-2 rounded-lg bg-[var(--sel-accent)] text-white font-medium text-sm">اختبار مرة ثانية</button>
            <button onClick={onExit} className="mt-2 block mx-auto text-sm text-[var(--sel-muted)] hover:text-[var(--sel-text)] transition">العودة</button>
          </div>
        )}

        {/* لا توجد بصمة */}
        {status === 'no-face' && (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10">
              <AlertTriangle className="h-8 w-8 text-amber-400" />
            </div>
            <h2 className="text-lg font-bold text-amber-300 mb-2">بصمتك غير محفوظة</h2>
            <p className="text-sm text-[var(--sel-muted)] mb-4">لم يتم العثور على بصمة وجه موافق عليها في هذه المرحلة.</p>
            {linkData && (
              <button
                onClick={() => onReEnroll(linkData.stageId, linkData.adminUid)}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-[#1458E2] to-[#2B7BFF] text-white font-bold text-sm shadow-lg"
              >
                <ScanFace className="inline h-4 w-4 ml-2" />
                سجّل بصمتك الآن
              </button>
            )}
            <button onClick={onExit} className="mt-3 text-sm text-[var(--sel-muted)] hover:text-[var(--sel-text)] transition">العودة</button>
          </div>
        )}

        {engineError && (
          <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-center">
            <p className="text-xs text-red-400">{engineError}</p>
            <button onClick={retry} className="mt-2 text-xs text-red-300 hover:text-red-200">
              <RefreshCw className="inline h-3 w-3 ml-1" /> إعادة المحاولة
            </button>
          </div>
        )}

        {!engineReady && status !== 'loading' && status !== 'invalid' && (
          <div className="mt-4">
            <EngineOverlay progress={progress} error={engineError} onRetry={retry} onCancel={onExit} />
          </div>
        )}
      </div>
    </div>
  );
}
