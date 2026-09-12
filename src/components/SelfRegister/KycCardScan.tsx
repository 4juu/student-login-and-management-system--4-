import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Camera, Image as ImageIcon, X, CheckCircle2, AlertCircle, Loader2, IdCard, Lock, RotateCcw, Fingerprint } from 'lucide-react';
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

const CARD_RATIO = 85.6 / 53.98;

interface KycCardScanProps {
  /** طلاب المرحلة للمطابقة العامة (روابط الحضور) */
  roster: Student[];
  /** الطالب المتوقع (روابط الطالب الواحد — بصمة) */
  expected?: Student;
  title?: string;
  onMatched: (student: Student) => void;
  onMismatch?: (info?: { extractedName?: string; ocrText?: string }) => void;
  onCancel: () => void;
}

type Mode = 'choice' | 'camera' | 'processing' | 'result';

interface ProgressState {
  percent: number;
  status: string;
}

// ─────────────────────────────────────────────────────────────
// مُستخدم Tesseract.js واحد يعاد استخدامه (يُحمِّل لغة "العربية"
// مرة واحدة ويخزّنها) — بدل تحميل دورات متكررة
// ─────────────────────────────────────────────────────────────
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
      ? { status: 'تحميل محرك القراءة...', percent: 10 + Math.round(pct * 0.1) }
      : status === 'loading language traineddata'
      ? { status: 'تحميل ملف اللغة العربية (مرة واحدة فقط)...', percent: 20 + Math.round(pct * 0.3) }
      : status === 'initializing api'
      ? { status: 'تهيئة محرك القراءة...', percent: 50 + Math.round(pct * 0.1) }
      : status === 'recognizing text'
      ? { status: 'قراءة النص من البطاقة...', percent: 55 + Math.round(pct * 0.45) }
      : { status: 'جاري المعالجة...', percent: Math.min(98, Math.max(5, pct)) },
  );
};

export const KycCardScan: React.FC<KycCardScanProps> = ({
  roster,
  expected,
  title,
  onMatched,
  onMismatch,
  onCancel,
}) => {
  const [mode, setMode] = useState<Mode>('choice');

  // نتائج القراءة
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState('');
  const [extractedName, setExtractedName] = useState<string | null>(null);
  const [matches, setMatches] = useState<StudentMatch[]>([]);
  const [selected, setSelected] = useState<Student | null>(null);
  const [manualName, setManualName] = useState('');
  const [manualMatches, setManualMatches] = useState<StudentMatch[]>([]);
  const [verify, setVerify] = useState<{ matched: boolean; confidence: number } | null>(null);

  const [progress, setProgress] = useState<ProgressState>({ percent: 0, status: '' });
  const [error, setError] = useState('');

  // الكاميرا
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // الاطلاع (للمطابقة يبقى الفرق بين المتوقع والقائمة: إذا وُجد المتوقع نتحقق منه حصراً)
  const isVerifyMode = !!expected;

  useEffect(() => {
    return () => {
      stopStream();
      ocrLogger = null;
      if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    };
  }, []);

  useEffect(() => {
    if (!capturedUrl) return;
    return () => URL.revokeObjectURL(capturedUrl);
  }, [capturedUrl]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  // ── فتح الكاميرا الخلفية ──
  const openCamera = useCallback(async () => {
    setError('');
    setMode('camera');
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
      setError('الكاميرا غير متاحة — جرّب الرفع من الاستوديو');
      setMode('choice');
    }
  }, []);

  const handleCancelCamera = useCallback(() => {
    stopStream();
    setMode('choice');
  }, [stopStream]);

  // ── التقاط الإطار وقصّه حسب حدود إطار التوجيه (نسب مئوية ثابتة) ──
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

    // أبعاد إطار التوجيه (82% من العرض، بنسبة البطاقة، متمركزة)
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
      setError('تعذر التقاط الصورة');
      setMode('choice');
      return;
    }
    void scanImage(new File([blob], 'card-camera.jpg', { type: 'image/jpeg' }));
  }, [stopStream]);

  // ── قراءة النص + الاستخراج + المطابقة ──
  const scanImage = useCallback(
    async (file: File) => {
      setError('');
      setMode('processing');
      setProgress({ percent: 2, status: 'تحضير الصورة...' });

      const url = URL.createObjectURL(file);
      setCapturedUrl(prev => (prev ? (URL.revokeObjectURL(prev), url) : url));

      try {
        const log = (m: any) => meetProgress(m, setProgress);
        ocrLogger = log;
        const worker = await getOcrWorker();
        const { data } = await worker.recognize(file);
        ocrLogger = null;

        const text: string = data?.text || '';
        setOcrText(text);
        setExtractedName(extractStudentName(text));
        setProgress({ percent: 100, status: 'تمت القراءة — جاري المطابقة...' });

        if (isVerifyMode && expected) {
          const r = findNameInOCRText(expected.name, text);
          setVerify({ matched: r.matched, confidence: Math.round(r.confidence * 100) });
        } else if (roster.length) {
          const ranked = rankStudents(text, roster);
          setMatches(ranked);
          setSelected(ranked[0]?.score >= MATCH_THRESHOLD ? ranked[0].student : null);
        }

        setMode('result');
      } catch (e: any) {
        ocrLogger = null;
        setError(e?.message ? `تعذر قراءة البطاقة — ${e.message}` : 'تعذر قراءة البطاقة، حاول مرة أخرى');
        setMode('result');
      }
    },
    [isVerifyMode, expected, roster.length],
  );

  const handleGallerySelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (!selected.type.startsWith('image/')) {
      setError('الرجاء اختيار صورة فقط');
      return;
    }
    if (selected.size > 10 * 1024 * 1024) {
      setError('الصورة كبيرة جداً (أقصى حد 10 MB)');
      return;
    }
    setError('');
    void scanImage(selected);
  };

  // إعادة حساب المطابقة أثناء الكتابة اليدوية
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
    setOcrText('');
    setExtractedName(null);
    setMatches([]);
    setSelected(null);
    setManualName('');
    setManualMatches([]);
    setVerify(null);
    setError('');
    setMode('choice');
  };

  const confirmSelected = () => {
    if (selected) onMatched(selected);
  };

  // ═══════════════════════════════
  //  شاشة الكاميرا
  // ═══════════════════════════════
  if (mode === 'camera') {
    return (
      <div className="min-h-screen bg-black flex flex-col" dir="rtl">
        <div className="relative flex-1 overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* إطار توجيه أخضر متقطع بنسبة البطاقة */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="relative"
              style={{
                width: '82%',
                maxWidth: 400,
                aspectRatio: `${CARD_RATIO} / 1`,
                border: '2px dashed #22c55e',
                borderRadius: 14,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
              }}
            >
              {/* خط مسح خفيف */}
              <div
                className="absolute left-2 right-2 h-0.5 rounded-full"
                style={{ top: '0%', background: 'rgba(34,197,94,0.7)' }}
              />
            </div>
          </div>

          <div className="absolute top-5 inset-x-0 flex justify-center z-10">
            <div className="px-4 py-2 rounded-full text-xs font-bold text-white bg-black/55 backdrop-blur-sm flex items-center gap-2">
              <IdCard className="w-4 h-4 text-green-400" />
              ضع البطاقة داخل الإطار
            </div>
          </div>
        </div>

        <div className="bg-black/90 backdrop-blur-sm px-6 pt-4 pb-8 flex flex-col items-center gap-4">
          <button
            onClick={captureAndScan}
            className="w-16 h-16 rounded-full bg-white hover:bg-indigo-50 border-4 border-indigo-400 active:scale-90 transition flex items-center justify-center shadow-lg"
            aria-label="التقاط الصورة"
          >
            <div className="w-11 h-11 rounded-full bg-white border-2 border-indigo-400" />
          </button>

          {error && <p className="text-xs text-red-400 text-center">{error}</p>}

          <button
            onClick={handleCancelCamera}
            className="text-sm text-gray-400 hover:text-white flex items-center gap-1.5 py-1 transition"
          >
            <X className="w-4 h-4" /> إلغاء
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════
  //  شاشة المعالجة (OCR)
  // ═══════════════════════════════
  if (mode === 'processing') {
    return (
      <div className="fixed inset-0 z-50 bg-[#0B1220] flex items-center justify-center p-6" dir="rtl">
        <div className="glass-card w-full max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center mx-auto mb-4">
            <Loader2 className="w-7 h-7 text-indigo-400 animate-spin" />
          </div>
          <h2 className="text-lg font-bold text-white mb-1">قراءة معلومات البطاقة</h2>
          <p className="text-sm text-white/60 mb-5">{progress.status}</p>

          <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mb-2">
            <div
              className="h-full rounded-full progress-bar"
              style={{ width: `${Math.min(100, progress.percent)}%` }}
            />
          </div>
          <p className="text-xs text-white/40 tabular-nums">{Math.round(progress.percent)}%</p>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════
  //  شاشة الاختيار (البداية)
  // ═══════════════════════════════
  return (
    <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md animate-pageEnter">
        <div className="glass-card">
          <div className="text-center mb-6">
            <div className="w-14 h-14 mx-auto rounded-full bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center mb-3">
              <IdCard className="w-7 h-7 text-indigo-400" />
            </div>
            <h2 className="text-xl font-bold text-white">التعريف عبر بطاقة الهوية الجامعية</h2>
            <p className="text-sm text-white/50 mt-1 leading-relaxed">
              {title || (
                <>
                  صوّر بطاقتك أو ارفعها — نستخرج اسمك تلقائياً ونطابقه مع قاعدة البيانات
                </>
              )}
            </p>
          </div>

          {expected?.name && (
            <div className="mb-5 inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/25 rounded-full px-4 py-1.5 text-sm font-bold text-indigo-200 w-full justify-center">
              <Fingerprint className="w-4 h-4" />
              التحقق من: {expected.name}
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/25 rounded-xl text-red-300 text-sm flex items-start gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
            </div>
          )}

          {mode === 'choice' && (
            <>
              <div className="space-y-3">
                <button
                  onClick={openCamera}
                  className="w-full btn-base btn-primary py-3.5"
                >
                  <Camera className="w-5 h-5" /> تصوير مباشر
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full btn-base btn-secondary py-3.5"
                >
                  <ImageIcon className="w-5 h-5" /> من الاستوديو
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleGallerySelect}
                className="hidden"
              />

              <div className="mt-4 p-3 bg-white/5 border border-white/10 rounded-xl flex items-start gap-2">
                <Lock className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-white/50 leading-relaxed">
                  الصورة تُعالج داخل جهازك وتُحذف فوراً. لا نخزّن أي صور على خوادمنا.
                </p>
              </div>
            </>
          )}

          <button onClick={onCancel} className="w-full mt-4 py-2 text-white/40 hover:text-white/70 text-sm transition">
            إلغاء والعودة
          </button>
        </div>

        {/* ═══════════ شاشة النتيجة ═══════════ */}
        {mode === 'result' && (
          <div className="glass-card mt-4 p-5">
            {error ? (
              <ResultError onRetry={handleReset} message={error} />
            ) : isVerifyMode && verify ? (
              verify.matched ? (
                <ResultMatch student={expected!} score={verify.confidence} onContinue={confirmSelected} onRetry={handleReset} />
              ) : (
                <ResultMismatchVerify
                  expectedName={expected?.name || ''}
                  extractedName={extractedName}
                  onRetry={handleReset}
                  onMismatch={onMismatch}
                  scanInfo={{ extractedName: extractedName || undefined, ocrText }}
                />
              )
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

            {/* تفاصيل تقنية للفحص */}
            {!error && (
              <details className="mt-4 group">
                <summary className="cursor-pointer text-xs font-bold text-white/50 hover:text-white/80 transition flex items-center justify-between list-none">
                  <span>التفاصيل الفنية</span>
                  <Chevron className="rotate-0 group-open:rotate-180" />
                </summary>
                <div className="mt-3 space-y-3">
                  {capturedUrl && (
                    <img
                      src={capturedUrl}
                      alt="البطاقة المقرؤة"
                      className="w-full rounded-xl border border-white/10"
                    />
                  )}
                  <div className="bg-black/40 border border-white/10 rounded-xl p-3">
                    <p className="text-[10px] font-bold text-white/40 mb-1.5">
                      النص الخام المستخرج ({ocrText.split('\n').filter(Boolean).length} سطر)
                    </p>
                    <pre className="text-[11px] text-white/60 font-mono whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                      {ocrText.trim() || '—'}
                    </pre>
                  </div>
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* ────────────────────────────── */
/*  مكوّنات النتيجة الفرعية        */
/* ────────────────────────────── */

const Chevron = ({ className }: { className?: string }) => (
  <svg className={`w-3.5 h-3.5 transition-transform ${className || ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ResultMatch: React.FC<{
  student: Student;
  score: number;
  onContinue: () => void;
  onRetry: () => void;
}> = ({ student, score, onContinue, onRetry }) => (
  <div className="text-center">
    <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mb-3">
      <CheckCircle2 className="w-7 h-7 text-emerald-400" />
    </div>
    <h3 className="text-lg font-bold text-white mb-1">تم التطابق بنجاح</h3>
    <div className="my-4 p-4 bg-white/5 border border-white/10 rounded-xl text-right space-y-1.5">
      <p className="text-sm text-white/50">الاسم المطابق</p>
      <p className="text-lg font-extrabold text-emerald-300">{student.name}</p>
      {student.code && <p className="text-xs text-white/40 font-mono">كود: {student.code}</p>}
    </div>
    <div className="mb-5 inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/25 rounded-full px-3 py-1 text-xs font-bold text-emerald-300">
      نسبة التطابق {Math.max(0, Math.min(100, score))}%
    </div>
    <div className="space-y-2">
      <button onClick={onContinue} className="w-full btn-base btn-primary py-3">
        <CheckCircle2 className="w-4 h-4" /> متابعة
      </button>
      <button onClick={onRetry} className="w-full btn-base btn-secondary py-2.5">
        <RotateCcw className="w-4 h-4" /> إعادة التصوير
      </button>
    </div>
  </div>
);

const ResultMismatchVerify: React.FC<{
  expectedName: string;
  extractedName: string | null;
  onRetry: () => void;
  onMismatch?: (info?: { extractedName?: string; ocrText?: string }) => void;
  scanInfo?: { extractedName?: string; ocrText?: string };
}> = ({ expectedName, extractedName, onRetry, onMismatch, scanInfo }) => (
  <div className="text-center">
    <div className="w-14 h-14 mx-auto rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mb-3">
      <AlertCircle className="w-7 h-7 text-amber-400" />
    </div>
    <h3 className="text-lg font-bold text-white mb-1">تعذّر التحقق من الاسم</h3>
    <p className="text-sm text-white/50 mb-4">
      الاسم المطلوب: <span className="text-white font-bold">{expectedName}</span>
    </p>
    {extractedName && (
      <p className="text-xs text-white/60 mb-4">
        الاسم المقروء من البطاقة: <span className="text-white font-bold">{extractedName}</span>
      </p>
    )}
    <div className="space-y-2">
      {onMismatch && (
        <button
          onClick={() => onMismatch(scanInfo)}
          className="w-full btn-base btn-secondary py-2.5"
        >
          المتابعة ببطاقة أخرى
        </button>
      )}
      <button onClick={onRetry} className="w-full btn-base btn-primary py-3">
        <RotateCcw className="w-4 h-4" /> إعادة التصوير
      </button>
    </div>
  </div>
);

const ResultRoster: React.FC<{
  matches: StudentMatch[];
  selected: Student | null;
  setSelected: (s: Student) => void;
  manualName: string;
  manualMatches: StudentMatch[];
  onManualChange: (v: string) => void;
  onContinue: () => void;
  onRetry: () => void;
}> = ({ matches, selected, setSelected, manualName, manualMatches, onManualChange, onContinue, onRetry }) => {
  const top = matches[0];
  const auto = top && top.score >= MATCH_THRESHOLD;

  return (
    <div>
      {auto && top ? (
        <ResultMatch student={top.student} score={top.score} onContinue={onContinue} onRetry={onRetry} />
      ) : (
        <>
          <div className="text-center mb-4">
            <div className="w-14 h-14 mx-auto rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mb-3">
              <AlertCircle className="w-7 h-7 text-amber-400" />
            </div>
            <h3 className="text-lg font-bold text-white mb-1">خذك اسمك بشكل واضح</h3>
            <p className="text-sm text-white/50 leading-relaxed">
              تعذّر مطابقة الاسم بنسبة كافية. اختر اسمك من المقترحات أو اكتبه يدوياً.
            </p>
          </div>

          {matches.length > 0 && (
            <div className="space-y-2 mb-4">
              {matches.slice(0, 5).map(m => (
                <button
                  key={m.student.id}
                  onClick={() => setSelected(m.student)}
                  className={`w-full flex items-center justify-between p-3 rounded-xl border transition ${
                    selected?.id === m.student.id
                      ? 'bg-indigo-500/15 border-indigo-400/50'
                      : 'bg-white/5 border-white/10 hover:border-white/25'
                  }`}
                >
                  <div className="text-right">
                    <p className={`text-sm font-bold ${selected?.id === m.student.id ? 'text-indigo-200' : 'text-white'}`}>
                      {m.student.name}
                    </p>
                    {m.student.code && (
                      <p className="text-[10px] text-white/40 font-mono">كود: {m.student.code}</p>
                    )}
                  </div>
                  <span className="text-xs font-bold text-white/60 tabular-nums">{m.score}%</span>
                </button>
              ))}
            </div>
          )}

          <div className="mb-4">
            <p className="text-xs font-bold text-white/50 mb-2">أو اكتب اسمك يدوياً:</p>
            <input
              value={manualName}
              onChange={e => onManualChange(e.target.value)}
              placeholder="مثال: علي حسين محمد"
              className="glass-input"
            />
            {manualMatches.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {manualMatches.slice(0, 3).map(m => (
                  <button
                    key={m.student.id}
                    onClick={() => { onManualChange(m.student.name); setSelected(m.student); }}
                    className="w-full text-right p-2.5 rounded-lg bg-white/5 border border-white/10 hover:border-indigo-400/40 transition flex items-center justify-between"
                  >
                    <span className="text-sm text-white">{m.student.name}</span>
                    <span className="text-[11px] font-bold text-white/50 tabular-nums">{m.score}%</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button onClick={onRetry} className="btn-base btn-secondary py-2.5">
              <RotateCcw className="w-4 h-4" /> إعادة
            </button>
            <button
              onClick={onContinue}
              disabled={!selected}
              className="btn-base btn-primary py-2.5"
            >
              <CheckCircle2 className="w-4 h-4" /> متابعة
            </button>
          </div>
        </>
      )}
    </div>
  );
};

const ResultError: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div className="text-center">
    <div className="w-14 h-14 mx-auto rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center mb-3">
      <AlertCircle className="w-7 h-7 text-red-400" />
    </div>
    <h3 className="text-lg font-bold text-red-400 mb-2">حدث خطأ أثناء القراءة</h3>
    <p className="text-sm text-white/60 mb-5">{message}</p>
    <button onClick={onRetry} className="w-full btn-base btn-primary py-3">
      <RotateCcw className="w-4 h-4" /> إعادة المحاولة
    </button>
  </div>
);

export default KycCardScan;