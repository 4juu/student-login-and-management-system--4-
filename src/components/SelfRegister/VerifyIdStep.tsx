import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Camera,
  Check,
  AlertTriangle,
  IdCard,
  QrCode,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { Student } from '../../types/student';
import { findNameInOCRText } from '../../services/nameMatching';
import {
  extractStudentName,
  rankStudents,
  type StudentMatch,
} from '../../services/cardMatch';
import './selfRegister.css';

export interface QrScanResult {
  qrCodeUrl: string;
  qrCodeId: string;
  verified: boolean;
  /** هل الرمز المقروء يطابق رمزاً محفوظاً بمستند الطالب؟ (قد يكون غير محفوظ أصلاً) */
  matchedWithRecord?: boolean;
}

interface VerifyIdStepProps {
  roster: Student[];
  expected?: Student | null;
  linkType?: string;
  onVerified: (student: Student, qr?: QrScanResult | null) => void;
  onCancel: () => void;
}

type Screen = 'choice' | 'camera' | 'processing' | 'result';

interface ProgressState {
  percent: number;
  status: string;
}

// ── عقدة Tesseract واحدة (عربية + إنجليزي) تُحمَّل من CDN كما كان معتمداً ──
let ocrWorker: any = null;
let ocrLogger: ((m: any) => void) | null = null;

const getOcrWorker = async (): Promise<any> => {
  if (ocrWorker) return ocrWorker;
  const { createWorker } = await import('tesseract.js');
  ocrWorker = await createWorker('ara+eng', 1, {
    logger: (m: any) => ocrLogger?.(m),
  });
  await ocrWorker.setParameters({
    tessedit_pageseg_mode: '3',
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  });
  return ocrWorker;
};

const meetProgress = (m: any, set: (p: ProgressState) => void) => {
  const pct = m && typeof m.progress === 'number' ? Math.round(m.progress * 100) : 0;
  const status = (m?.status as string) || '';
  set(
    status === 'loading tesseract core'
      ? { status: 'تحميل محرك القراءة…', percent: 8 + Math.round(pct * 0.12) }
      : status === 'loading language traineddata'
      ? { status: 'تحميل ملف اللغة العربية (مرة واحدة فقط)…', percent: 20 + Math.round(pct * 0.32) }
      : status === 'initializing api' || status === 'initializing language'
      ? { status: 'تهيئة محرك القراءة…', percent: 52 + Math.round(pct * 0.08) }
      : status === 'recognizing text'
      ? { status: 'قراءة الاسم من البطاقة…', percent: 56 + Math.round(pct * 0.44) }
      : { status: 'جاري المعالجة…', percent: Math.min(98, Math.max(4, pct)) },
  );
};

// ── سحب رمز QR من صورة البطاقة عن طريق html5-qrcode (بدون كاميرا) ──
const extractQrInfo = (raw: string): { qrCodeUrl: string; qrCodeId: string } | null => {
  const text = (raw || '').trim();
  if (!text) return null;
  let qrCodeId = '';
  try {
    const u = new URL(text);
    const id = u.searchParams.get('id');
    if (id) qrCodeId = id.trim();
  } catch {
    // ليس رابطاً — قد يكون JSON أو نصاً بسيطاً
  }
  if (!qrCodeId) {
    try {
      const o = JSON.parse(text);
      const v = o?.qrCodeId || o?.qrId || o?.id || o?.studentId || o?.universityId || o?.code;
      if (v) qrCodeId = String(v).trim();
    } catch {
      // ليس JSON — يمكن أن يكون نصاً عادياً
    }
  }
  if (!qrCodeId && /^[A-Za-z0-9_-]{3,100}$/.test(text)) qrCodeId = text;
  if (!qrCodeId) return null;
  return { qrCodeUrl: text, qrCodeId };
};

let qrScannerCleanup: (() => void) | null = null;

const decodeQrFromImage = async (file: File): Promise<{ qrCodeUrl: string; qrCodeId: string } | null> => {
  try {
    const { Html5Qrcode } = await import('html5-qrcode');
    const host = document.createElement('div');
    host.id = 'sel-idcard-qr-decode';
    host.style.display = 'none';
    document.body.appendChild(host);
    qrScannerCleanup = () => { try { host.remove(); } catch {}; qrScannerCleanup = null; };

    const scanner = new Html5Qrcode('sel-idcard-qr-decode', { verbose: false });
    const text: string = await scanner.scanFile(file, false);
    return extractQrInfo(text);
  } catch {
    return null;
  } finally {
    qrScannerCleanup?.();
  }
};

const Stepper = ({ current }: { current: 1 | 2 | 3 }) => {
  const steps = ['صوّر البطاقة', 'تأكيد الاسم', 'المتابعة'];
  return (
    <div className="sel-steps" role="navigation" aria-label="خطوات التحقق">
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const state = n < current ? 'done' : n === current ? 'active' : '';
        return (
          <div key={n} className={`sel-step ${state}`}>
            <div className="sel-step-dot">
              {n < current ? <Check className="w-3.5 h-3.5" /> : n}
            </div>
            <span className="sel-step-label">{label}</span>
          </div>
        );
      })}
    </div>
  );
};

export const VerifyIdStep: React.FC<VerifyIdStepProps> = ({
  roster,
  expected,
  linkType,
  onVerified,
  onCancel,
}) => {
  const [screen, setScreen] = useState<Screen>('choice');

  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [extractedName, setExtractedName] = useState<string | null>(null);
  const [matches, setMatches] = useState<StudentMatch[]>([]);
  const [selected, setSelected] = useState<Student | null>(null);
  const [verify, setVerify] = useState<{ matched: boolean; confidence: number } | null>(null);
  const [qrResult, setQrResult] = useState<QrScanResult | null>(null);

  const [progress, setProgress] = useState<ProgressState>({ percent: 0, status: '' });
  const [error, setError] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const camViewRef = useRef<HTMLDivElement>(null);
  const camScreenRef = useRef<HTMLDivElement>(null);

  const isVerifyMode = !!expected;

  // روابط الحضور: نقبل التطابق عند وجود 3 نتائج متتالية بدرجة عالية — يمنع المطابقة العشوائية
  const ROSTER_AUTO_THRESHOLD = 70;
  const ROSTER_MIN_CONSECUTIVE = 3;

  useEffect(() => {
    return () => {
      stopStream();
      ocrLogger = null;
      if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // قفل التركيز داخل شاشة الكاميرا + إرجاعه بعد الخروج
  useEffect(() => {
    if (screen !== 'camera') return;
    const prev = document.activeElement as HTMLElement | null;
    const screenEl = camScreenRef.current;
    screenEl?.querySelector<HTMLButtonElement>('button')?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !screenEl) return;
      const focusables = Array.from(screenEl.querySelectorAll<HTMLElement>('button'));
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [screen]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  // ── فتح الكاميرا الخلفية ──
  const openCamera = useCallback(async () => {
    setError('');
    setScreen('camera');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setError('الكاميرا غير متاحة على هذا الجهاز');
      setScreen('choice');
    }
  }, []);

  const handleCancelCamera = useCallback(() => {
    stopStream();
    setScreen('choice');
  }, [stopStream]);

  // ── التقاط الإطار وقصّه بدقة من حدود إطار التوجيه الفعلي ──
  const captureAndScan = useCallback(async () => {
    const video = videoRef.current;
    const guide = camViewRef.current?.querySelector('.sel-cam-guide');
    if (!video || !video.videoWidth || !guide) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    const full = document.createElement('canvas');
    full.width = vw;
    full.height = vh;
    const fctx = full.getContext('2d', { willReadFrequently: true })!;
    fctx.drawImage(video, 0, 0, vw, vh);

    // تحويل إحداثيات إطار التوجيه (CSS px) إلى إحداثيات البكسل الأصلية
    // مع مراعاة object-fit: cover (قصّ الأطراف الزائدة)
    const vRect = video.getBoundingClientRect();
    const gRect = guide.getBoundingClientRect();
    const cw = vRect.width || 1;
    const ch = vRect.height || 1;
    const viewA = cw / ch;
    const srcA = vw / vh;

    let sx = 0;
    let sy = 0;
    let sW = vw;
    let sH = vh;
    if (srcA > viewA) {
      sW = vh * viewA;
      sx = (vw - sW) / 2;
    } else {
      sH = vw / viewA;
      sy = (vh - sH) / 2;
    }

    const gx = gRect.left - vRect.left;
    const gy = gRect.top - vRect.top;
    const cropX = sx + (gx / cw) * sW;
    const cropY = sy + (gy / ch) * sH;
    const cropW = (gRect.width / cw) * sW;
    const cropH = (gRect.height / ch) * sH;

    const out = document.createElement('canvas');
    out.width = Math.max(2, Math.round(cropW));
    out.height = Math.max(2, Math.round(cropH));
    const octx = out.getContext('2d')!;
    octx.drawImage(full, cropX, cropY, cropW, cropH, 0, 0, out.width, out.height);

    stopStream();

    const [blob, fullBlob] = await Promise.all([
      new Promise<Blob | null>(res => out.toBlob(b => res(b), 'image/jpeg', 0.95)),
      new Promise<Blob | null>(res => full.toBlob(b => res(b), 'image/jpeg', 0.92)),
    ]);
    if (!blob) {
      setError('تعذّر التقاط الصورة — حاول مرة أخرى');
      setScreen('choice');
      return;
    }
    void scanImage(
      new File([blob], 'card-camera.jpg', { type: 'image/jpeg' }),
      fullBlob ? new File([fullBlob], 'card-full.jpg', { type: 'image/jpeg' }) : null,
    );
  }, [stopStream]);

  // ── قراءة النص + الاستخراج + المطابقة ──
  const scanImage = useCallback(
    async (file: File, fullFile?: File | null) => {
      setError('');
      setScreen('processing');
      setProgress({ percent: 2, status: 'تحضير الصورة…' });

      const url = URL.createObjectURL(file);
      setCapturedUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });

      try {
        ocrLogger = (m: any) => meetProgress(m, setProgress);
        // الاسم: من القصّة المركزية · رمز QR: من الصورة الكاملة (QR بطرف البطاقة لا يُقص)
        const [workerPromise, qrPromise] = [
          getOcrWorker().then(w => w.recognize(file)),
          decodeQrFromImage(fullFile || file),
        ];
        const [{ data }, qr] = await Promise.all([workerPromise as Promise<any>, qrPromise]);
        ocrLogger = null;

        const text: string = data?.text || '';
        const extractedNameVal = extractStudentName(text);
        setExtractedName(extractedNameVal);
        setProgress({ percent: 100, status: 'تمت القراءة — جاري التطابق…' });

        // ✅ سحب رمز QR من صورة البطاقة (إن وُجد) — يُعتبر متحققاً لأنه مقروء من البطاقة نفسها
        if (qr) {
          const matchedWithRecord =
            !!isVerifyMode &&
            !!expected?.qrCodeId &&
            expected.qrCodeId.trim().toLowerCase() === qr.qrCodeId.toLowerCase();
          setQrResult({
            ...qr,
            verified: true,
            matchedWithRecord,
          });
        } else {
          setQrResult(null);
        }

        if (isVerifyMode && expected) {
          const r = findNameInOCRText(expected.name, text);
          setVerify({ matched: r.matched, confidence: Math.round(r.confidence * 100) });
        } else if (roster.length) {
          // المطابقة بالأساس من الاسم المستخرج النظيف (الاسم الفعلي للبطاقة)،
          // وإن لم يُستخرج نعتمد النص الخام — يسمح بتطابق الأسماء ذات الكلمات الزائدة
          let ranked = extractedNameVal ? rankStudents(extractedNameVal, roster) : [];
          if (ranked.length === 0) ranked = rankStudents(text, roster);
          setMatches(ranked);
          setSelected(ranked.length >= ROSTER_MIN_CONSECUTIVE && ranked[0].score >= ROSTER_AUTO_THRESHOLD ? ranked[0].student : null);
        }

        setScreen('result');
      } catch (e: any) {
        ocrLogger = null;
        setError(e?.message ? `تعذّر قراءة البطاقة — ${e.message}` : 'تعذّر قراءة البطاقة، حاول مرة أخرى');
        setScreen('result');
      }
    },
    [isVerifyMode, expected, roster.length],
  );

  const handleReset = () => {
    setScreen('choice');
    setExtractedName(null);
    setMatches([]);
    setSelected(null);
    setVerify(null);
    setQrResult(null);
    setError('');
  };

  const confirmSelected = () => {
    // في وضع التحقق (روابط البصمة) النتيجة تأتي من verify لا من selected
    const student = isVerifyMode ? expected : selected;
    if (student) onVerified(student, qrResult);
  };

  const showStepper = screen !== 'camera';

  // ═══════════════ الكاميرا (شاشة كاملة) ═══════════════
  if (screen === 'camera') {
    return (
      <div className="sel-camera-screen sel-fade" dir="rtl" ref={camScreenRef}>
        <div className="sel-cam-top">
          <button type="button" className="sel-cam-top-btn" onClick={handleCancelCamera} aria-label="رجوع">
            <ArrowRight className="w-5 h-5" />
          </button>
          <div className="text-sm font-bold">تصوير البطاقة الجامعية</div>
          <button type="button" className="sel-cam-top-btn" onClick={onCancel} aria-label="إغلاق">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="sel-cam-view" ref={camViewRef}>
          <video ref={videoRef} autoPlay playsInline muted className="sel-cam-video" />
          <div className="sel-cam-guide">
            <span className="sel-corner sel-corner-tl" />
            <span className="sel-corner sel-corner-tr" />
            <span className="sel-corner sel-corner-bl" />
            <span className="sel-corner sel-corner-br" />
          </div>
          <div className="sel-cam-pill">
            <div className="sel-cam-pill-inner">
              <IdCard className="w-4 h-4" /> ضع البطاقة داخل الإطار مع وضوح الاسم
              <span className="mr-1 inline-flex items-center gap-1 text-[10px] font-extrabold text-white/80">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" /> LIVE
              </span>
            </div>
          </div>
        </div>

        <div className="sel-cam-bottom">
          <button type="button" className="sel-shutter" onClick={captureAndScan} aria-label="التقاط الصورة">
            <span className="sel-shutter-inner" />
          </button>
          <p className="sel-cam-hint">تأكد من إضاءة جيدة وإبعاد الكاميرا عن البطاقة قليلاً، ووضّح الاسم</p>
          {error && <p className="text-xs font-bold text-red-400 text-center">{error}</p>}
        </div>
      </div>
    );
  }

  // ═══════════════ المعالجة (OCR) ═══════════════
  if (screen === 'processing') {
    return (
      <div className="sel-fade">
        {showStepper && <Stepper current={2} />}
        <div className="sel-card text-center">
          <div className="sel-scan-wrap">
            <div className="sel-scan-icon">
              <ScanLine className="w-8 h-8" />
            </div>
            <div className="sel-pulse" />
          </div>
          <h2 className="sel-heading mt-5">جاري قراءة البطاقة…</h2>
          <p className="sel-muted mt-1.5" aria-live="polite">{progress.status}</p>
          <div className="sel-progress mt-5" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="sel-progress-fill" style={{ width: `${Math.min(100, progress.percent)}%` }} />
          </div>
          <p className="mt-2 text-xs font-semibold text-[#93A5C8] tabular-nums">{Math.round(progress.percent)}%</p>
          <p className="sel-cam-hint mt-4">
            {progress.percent < 20
              ? 'أول عملية قد تستغرق دقائق لتحميل محرك اللغة — تحدث مرة واحدة فقط'
              : 'لا تغلق الصفحة حتى اكتمال القراءة'}
          </p>
        </div>
      </div>
    );
  }

  const topChip = isVerifyMode
    ? { text: `التحقق من: ${expected!.name}`, tone: 'sel-chip-violet' }
    : { text: 'تقرير الحضور والغياب', tone: 'sel-chip-blue' };

  // ═══════════════ الشاشة الرئيسية (اختيار) ═══════════════
  if (screen === 'choice') {
    return (
      <div className="sel-fade">
        <Stepper current={1} />
        <div className="sel-card">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-extrabold text-[#F3F7FF]">التحقق من الهوية الجامعية</h2>
            {linkType === 'attendance' && !isVerifyMode && <span className={`sel-chip ${topChip.tone}`}>{topChip.text}</span>}
          </div>

          <p className="sel-muted mb-5">
            صوّر بطاقتك الجامعية مباشرة.
          </p>

          {isVerifyMode && expected?.name && (
            <div className={`sel-chip ${topChip.tone} w-full justify-center mb-5`}>
              <BadgeCheck className="w-4 h-4" />
              <span className="truncate">{topChip.text}</span>
            </div>
          )}

          <div className="space-y-3">
            <button type="button" className="sel-option" onClick={openCamera}>
              <span className="sel-option-icon">
                <Camera className="w-6 h-6" />
              </span>
              <span className="text-right">
                <span className="sel-option-title block">تصوير مباشر</span>
                <span className="sel-option-desc block">افتح الكاميرا ووجّهها نحو البطاقة</span>
              </span>
            </button>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-[#3A1F28] border border-[#5C2B35] rounded-xl text-red-300 text-sm flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="sel-note mt-5">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>تُعالج الصورة داخل جهازك وتُحذف فوراً. لا نخزّن أي صور على خوادمنا.</span>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════ النتيجة ═══════════════
  const topResult = matches[0];
  const autoMatch = matches.length >= ROSTER_MIN_CONSECUTIVE && topResult && topResult.score >= ROSTER_AUTO_THRESHOLD;
  const strongMatch = isVerifyMode ? !!verify?.matched : !!autoMatch;

  return (
    <div className="sel-fade">
      <span role="status" aria-live="polite" className="sr-only">
        {error
          ? 'حصل خطأ أثناء قراءة البطاقة'
          : strongMatch
          ? 'تم التعرف على الهوية بنجاح'
          : 'لم يتم التأكد من الاسم بشكل دقيق'}
      </span>
      <Stepper current={strongMatch ? 3 : 2} />
      <div className="sel-card">
        {error ? (
          <div className="text-center">
            <div className="sel-icon-circle sel-err-soft"><AlertTriangle className="w-8 h-8" /></div>
            <h2 className="sel-heading mt-4 mb-2">حدث خطأ أثناء القراءة</h2>
            <p className="sel-muted mb-5">{error}</p>
            <button type="button" className="sel-btn sel-btn-primary" onClick={handleReset}>
              <RefreshCw className="w-5 h-5" /> إعادة المحاولة
            </button>
          </div>
        ) : strongMatch ? (
          <ResultMatch
            student={isVerifyMode && expected ? expected : topResult!.student}
            score={
              isVerifyMode
                ? verify!.confidence
                : Math.max(0, Math.min(100, topResult!.score))
            }
            onContinue={confirmSelected}
            onRetry={handleReset}
          />
        ) : isVerifyMode ? (
          <div className="text-center">
            <div className="sel-icon-circle sel-warn-soft"><AlertTriangle className="w-8 h-8" /></div>
            <h2 className="sel-heading mt-4 mb-2">تعذّر التحقق من الاسم</h2>
            <p className="sel-muted mb-4">
              الاسم المطلوب على البطاقة هو{' '}
              <span className="font-bold text-[#F3F7FF]">{expected?.name}</span>
            </p>
            {extractedName && (
              <p className="text-sm text-[#93A5C8] mb-5">
                الاسم المقروء من البطاقة: <span className="font-bold text-[#F3F7FF]">{extractedName}</span>
              </p>
            )}
            <button type="button" className="sel-btn sel-btn-primary" onClick={handleReset}>
              <RefreshCw className="w-5 h-5" /> إعادة التصوير
            </button>
            <p className="sel-cam-hint mt-4">تأكد من وضع الإضاءة والوضوح — أو راجع إدارة الكلية إذا استمرت المشكلة</p>
          </div>
        ) : (
          <ResultNoMatch
            extractedName={extractedName}
            onRetry={handleReset}
          />
        )}

        {!error && qrResult && (
          <div
            className={`mt-4 flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${
              qrResult?.matchedWithRecord
                ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                : 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
            }`}
          >
            <QrCode className="w-4 h-4 shrink-0" />
            <span className="truncate">
              {qrResult?.verified
                ? qrResult?.matchedWithRecord
                  ? 'تم التحقق من رمز QR في البطاقة ✓'
                  : isVerifyMode
                  ? 'تم قراءة رمز QR من البطاقة — سجّل جديد دون رمز محفوظ مسبقاً'
                  : 'تم قراءة رمز QR من البطاقة'
                : isVerifyMode
                ? 'اُكتشف رمز QR بالبطاقة لكنه غير مطابق لهذا السجل — يعتمد التحقق على الاسم'
                : 'تم قراءة رمز QR من البطاقة'}
            </span>
          </div>
        )}

        {capturedUrl && !error && !isVerifyMode && !strongMatch && (
          <div className="mt-4 flex items-center justify-center">
            <img
              src={capturedUrl}
              alt="مُصغّر البطاقة المقرؤة"
              className="h-20 w-auto rounded-xl border border-[#22334F] shadow-sm"
              loading="lazy"
            />
          </div>
        )}
      </div>
    </div>
  );
};

/* ──────────────────────────────────────── */
/*  حالة التطابق الناجح                     */
/* ──────────────────────────────────────── */
const ResultMatch: React.FC<{
  student: Student;
  score: number;
  onContinue: () => void;
  onRetry: () => void;
}> = ({ student, score, onContinue, onRetry }) => (
  <div className="text-center">
    <div className="sel-icon-circle sel-ok">
      <Check className="w-8 h-8" />
    </div>
    <h2 className="sel-heading mt-4 mb-1">تم التعرف عليك</h2>
    <p className="sel-muted mb-5">تحقّق من تطابق البيانات ثم أكمل</p>

    <div className="sel-identity mb-5">
      <p className="sel-identity-label">الاسم</p>
      <p className="sel-identity-name">{student.name}</p>
      {student.code && (
        <div className="mt-2 flex items-center justify-between border-t border-[#22355A] pt-2">
          <p className="sel-identity-label">كود الطالب</p>
          <p className="sel-identity-code">{student.code}</p>
        </div>
      )}
    </div>

    <div className="mb-5 flex justify-center">
      <span className="sel-chip sel-chip-green">نسبة التطابق {score}%</span>
    </div>

    <div className="space-y-2">
      <button type="button" className="sel-btn sel-btn-primary" onClick={onContinue}>
        <BadgeCheck className="w-5 h-5" /> نعم، هذه هويتي
      </button>
      <button type="button" className="sel-btn sel-btn-ghost" onClick={onRetry}>
        <RefreshCw className="w-4 h-4" /> إعادة التصوير
      </button>
    </div>
  </div>
);

/* ──────────────────────────────────────── */
/*  حاله عدم التطابق — إعادة التصوير فقط    */
/* ──────────────────────────────────────── */
const ResultNoMatch: React.FC<{
  extractedName: string | null;
  onRetry: () => void;
}> = ({ extractedName, onRetry }) => (
  <div className="text-center">
    <div className="sel-icon-circle sel-warn-soft mx-auto"><AlertTriangle className="w-8 h-8" /></div>
    <h2 className="sel-heading mt-4 mb-2">تعذّر التحقق من الاسم بدقة</h2>
    {extractedName ? (
      <p className="sel-muted mb-5">
        الاسم المقروء: <span className="font-bold text-[#F3F7FF]">{extractedName}</span>
      </p>
    ) : (
      <p className="sel-muted mb-5">لم نتمكن من قراءة الاسم من البطاقة — تأكد من وضوح الإضاءة والصورة.</p>
    )}
    <button type="button" className="sel-btn sel-btn-primary" onClick={onRetry}>
      <RefreshCw className="w-5 h-5" /> إعادة التصوير
    </button>
    <p className="sel-cam-hint mt-4">تأكد من وضوح الاسم على البطاقة ثم أعد الالتقاط.</p>
  </div>
);

export default VerifyIdStep;