import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Camera,
  Check,
  CheckCircle2,
  AlertTriangle,
  IdCard,
  Images,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { Student } from '../../types/student';
import { findNameInOCRText } from '../../services/nameMatching';
import {
  MATCH_THRESHOLD,
  extractStudentName,
  nameSimilarity,
  rankByNameInput,
  rankStudents,
  type StudentMatch,
} from '../../services/cardMatch';
import './selfRegister.css';

const CARD_RATIO = 85.6 / 53.98;

interface VerifyIdStepProps {
  roster: Student[];
  expected?: Student | null;
  linkType?: string;
  onVerified: (student: Student) => void;
  onCancel: () => void;
}

type Screen = 'choice' | 'camera' | 'processing' | 'result';

interface ProgressState {
  percent: number;
  status: string;
}

// ── عقدة Tesseract واحدة يُعاد استخدامها (تُحمِّل العربية مرة واحدة فقط) ──
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
  const [manualName, setManualName] = useState('');
  const [manualMatches, setManualMatches] = useState<StudentMatch[]>([]);
  const [verify, setVerify] = useState<{ matched: boolean; confidence: number } | null>(null);

  const [progress, setProgress] = useState<ProgressState>({ percent: 0, status: '' });
  const [error, setError] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isVerifyMode = !!expected;

  useEffect(() => {
    return () => {
      stopStream();
      ocrLogger = null;
      if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setError('الكاميرا غير متاحة على هذا الجهاز — استخدم خيار «رفع من الجهاز»');
      setScreen('choice');
    }
  }, []);

  const handleCancelCamera = useCallback(() => {
    stopStream();
    setScreen('choice');
  }, [stopStream]);

  // ── التقاط الإطار وقصّه حسب حدود إطار التوجيه ──
  const captureAndScan = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    const full = document.createElement('canvas');
    full.width = vw;
    full.height = vh;
    const fctx = full.getContext('2d', { willReadFrequently: true })!;
    fctx.drawImage(video, 0, 0, vw, vh);

    const gw = vw * 0.82;
    const gh = gw / CARD_RATIO;
    const sx = (vw - gw) / 2;
    const sy = Math.max(0, Math.min(vh - gh, (vh - gh) / 2));

    const out = document.createElement('canvas');
    out.width = Math.round(gw);
    out.height = Math.round(gh);
    const octx = out.getContext('2d')!;
    octx.drawImage(full, sx, sy, gw, gh, 0, 0, out.width, out.height);

    stopStream();

    const blob: Blob | null = await new Promise(res => out.toBlob(b => res(b), 'image/jpeg', 0.95));
    if (!blob) {
      setError('تعذّر التقاط الصورة — حاول مرة أخرى');
      setScreen('choice');
      return;
    }
    void scanImage(new File([blob], 'card-camera.jpg', { type: 'image/jpeg' }));
  }, [stopStream]);

  // ── قراءة النص + الاستخراج + المطابقة ──
  const scanImage = useCallback(
    async (file: File) => {
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
        const worker = await getOcrWorker();
        const { data } = await worker.recognize(file);
        ocrLogger = null;

        const text: string = data?.text || '';
        setExtractedName(extractStudentName(text));
        setProgress({ percent: 100, status: 'تمت القراءة — جاري التطابق…' });

        if (isVerifyMode && expected) {
          const r = findNameInOCRText(expected.name, text);
          setVerify({ matched: r.matched, confidence: Math.round(r.confidence * 100) });
        } else if (roster.length) {
          const ranked = rankStudents(text, roster);
          setMatches(ranked);
          setSelected(ranked[0] && ranked[0].score >= MATCH_THRESHOLD ? ranked[0].student : null);
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

  const handleGallerySelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('الرجاء اختيار صورة فقط');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('الصورة كبيرة جداً (أقصى حد 10 MB)');
      return;
    }
    setError('');
    void scanImage(file);
  };

  const handleManualChange = (v: string) => {
    setManualName(v);
    setManualMatches(rankByNameInput(v, roster));
    setSelected(null);
    if (v.trim() && roster.length) {
      const exact = roster.find(s => nameSimilarity(v, s.name) >= MATCH_THRESHOLD);
      if (exact) setSelected(exact);
    }
  };

  const handleReset = () => {
    setScreen('choice');
    setExtractedName(null);
    setMatches([]);
    setSelected(null);
    setManualName('');
    setManualMatches([]);
    setVerify(null);
    setError('');
  };

  const confirmSelected = () => {
    if (selected) onVerified(selected);
  };

  const showStepper = screen !== 'camera';

  // ═══════════════ الكاميرا (شاشة كاملة) ═══════════════
  if (screen === 'camera') {
    return (
      <div className="sel-camera-screen sel-fade" dir="rtl">
        <div className="sel-cam-top">
          <button type="button" className="sel-cam-top-btn" onClick={handleCancelCamera} aria-label="رجوع">
            <ArrowRight className="w-5 h-5" />
          </button>
          <div className="text-sm font-bold">تصوير البطاقة الجامعية</div>
          <button type="button" className="sel-cam-top-btn" onClick={onCancel} aria-label="إغلاق">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="sel-cam-view">
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
            </div>
          </div>
        </div>

        <div className="sel-cam-bottom">
          <button type="button" className="sel-shutter" onClick={captureAndScan} aria-label="التقاط الصورة">
            <span className="sel-shutter-inner" />
          </button>
          <p className="sel-cam-hint">تأكد من إضاءة جيدة وإبعاد الكاميرا عن البطاقة قليلاً</p>
          {error && <p className="text-xs font-bold text-red-600 text-center">{error}</p>}
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
          <p className="sel-muted mt-1.5">{progress.status}</p>
          <div className="sel-progress mt-5" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="sel-progress-fill" style={{ width: `${Math.min(100, progress.percent)}%` }} />
          </div>
          <p className="mt-2 text-xs font-semibold text-[#7A8CA8] tabular-nums">{Math.round(progress.percent)}%</p>
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
            <h2 className="text-lg font-extrabold text-[#0D1B3D]">التحقق من الهوية الجامعية</h2>
            {linkType === 'attendance' && !isVerifyMode && <span className={`sel-chip ${topChip.tone}`}>{topChip.text}</span>}
          </div>

          <p className="sel-muted mb-5">
            صوّر بطاقتك الجامعية أو ارفعها — نستخرج اسمك ونطابقه مع قاعدة البيانات. الخطوة الأولى من ثلاث.
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
                <span className="sel-option-desc block">بفتح الكاميرا على البطاقة</span>
              </span>
            </button>

            <button type="button" className="sel-option" onClick={() => fileInputRef.current?.click()}>
              <span className="sel-option-icon">
                <Images className="w-6 h-6" />
              </span>
              <span className="text-right">
                <span className="sel-option-title block">رفع من الجهاز</span>
                <span className="sel-option-desc block">صورة جاهزة من هاتفك</span>
              </span>
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleGallerySelect}
            className="hidden"
          />

          {error && (
            <div className="mt-4 p-3 bg-[#FDEEEB] border border-[#F9D6D0] rounded-xl text-red-700 text-sm flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="sel-note mt-5">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>تُعالج الصورة داخل جهازك وتُحذف فوراً. لا نخزّن أي صور على خوادمنا، ويبقى المطابقة النهائية بانتظار موافقة الأدمن عند الاقتضاء.</span>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════ النتيجة ═══════════════
  const topResult = matches[0];
  const autoMatch = topResult && topResult.score >= MATCH_THRESHOLD;
  const strongMatch = isVerifyMode ? !!verify?.matched : !!autoMatch;

  return (
    <div className="sel-fade">
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
              <span className="font-bold text-[#0D1B3D]">{expected?.name}</span>
            </p>
            {extractedName && (
              <p className="text-sm text-[#5A6D8A] mb-5">
                الاسم المقروء من البطاقة: <span className="font-bold text-[#0D1B3D]">{extractedName}</span>
              </p>
            )}
            <button type="button" className="sel-btn sel-btn-primary" onClick={handleReset}>
              <RefreshCw className="w-5 h-5" /> إعادة التصوير
            </button>
            <p className="sel-cam-hint mt-4">تأكد من وضع الإضاءة والوضوح — أو راجع إدارة الكلية إذا استمرت المشكلة</p>
          </div>
        ) : (
          <ResultRoster
            matches={matches}
            selected={selected}
            setSelected={setSelected}
            manualName={manualName}
            manualMatches={manualMatches}
            onManualChange={handleManualChange}
            onContinue={confirmSelected}
            onRetry={handleReset}
          />
        )}

        {capturedUrl && !error && !isVerifyMode && !strongMatch && (
          <div className="mt-4 flex items-center justify-center">
            <img
              src={capturedUrl}
              alt="مُصغّر البطاقة المقرؤة"
              className="h-20 w-auto rounded-xl border border-[#E2EAF8] shadow-sm"
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
        <div className="mt-2 flex items-center justify-between border-t border-[#DCE8FA] pt-2">
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
/*  روابط الحضور: اختيار الاسم يدوياً        */
/* ──────────────────────────────────────── */
const ResultRoster: React.FC<{
  matches: StudentMatch[];
  selected: Student | null;
  setSelected: (s: Student) => void;
  manualName: string;
  manualMatches: StudentMatch[];
  onManualChange: (v: string) => void;
  onContinue: () => void;
  onRetry: () => void;
}> = ({ matches, selected, setSelected, manualName, manualMatches, onManualChange, onContinue, onRetry }) => (
  <div>
    <div className="text-center mb-5">
      <div className="sel-icon-circle sel-warn-soft mx-auto"><AlertTriangle className="w-8 h-8" /></div>
      <h2 className="sel-heading mt-4 mb-2">تعذّر تحديد اسمك بدقة</h2>
      <p className="sel-muted">اختر اسمك من المقترحات أدناه أو اكتبه يدوياً للمتابعة.</p>
    </div>

    {matches.length > 0 && (
      <div className="space-y-2.5 mb-5">
        {matches.slice(0, 4).map(m => (
          <button
            key={m.student.id}
            type="button"
            className={`sel-suggestion ${selected?.id === m.student.id ? 'selected' : ''}`}
            onClick={() => setSelected(m.student)}
          >
            <span className="flex items-center gap-3 min-w-0">
              <span className="sel-radio"><Check className="w-2.5 h-2.5" /></span>
              <span className="text-right min-w-0">
                <span className="block text-sm font-bold text-[#0D1B3D] truncate">{m.student.name}</span>
                {m.student.code && (
                  <span className="block text-[11px] text-[#7A8CA8] tabular-nums" style={{ direction: 'ltr', textAlign: 'right' }}>
                    كود: {m.student.code}
                  </span>
                )}
              </span>
            </span>
            <span className="sel-suggestion-score">{m.score}%</span>
          </button>
        ))}
      </div>
    )}

    <div className="mb-5">
      <p className="text-xs font-bold text-[#5A6D8A] mb-2">أو اكتب اسمك يدوياً:</p>
      <input
        value={manualName}
        onChange={e => onManualChange(e.target.value)}
        placeholder="مثال: علي حسين محمد"
        className="sel-input"
      />
      {manualMatches.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {manualMatches.slice(0, 3).map(m => (
            <button
              key={m.student.id}
              type="button"
              className="w-full flex items-center justify-between gap-3 text-right p-3 rounded-xl bg-[#F7FAFF] border border-[#E3EBF9] hover:border-[#9DBBF1] transition"
              onClick={() => { onManualChange(m.student.name); setSelected(m.student); }}
            >
              <span className="text-sm font-bold text-[#0D1B3D]">{m.student.name}</span>
              <span className="sel-suggestion-score">{m.score}%</span>
            </button>
          ))}
        </div>
      )}
    </div>

    <div className="grid grid-cols-2 gap-2">
      <button type="button" className="sel-btn sel-btn-ghost sel-btn-sm" onClick={onRetry}>
        <RefreshCw className="w-4 h-4" /> إعادة
      </button>
      <button
        type="button"
        className="sel-btn sel-btn-primary sel-btn-sm"
        onClick={onContinue}
        disabled={!selected}
      >
        <CheckCircle2 className="w-4 h-4" /> متابعة
      </button>
    </div>
  </div>
);

export default VerifyIdStep;