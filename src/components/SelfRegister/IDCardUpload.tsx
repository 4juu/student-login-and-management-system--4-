import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Student } from '../../types/student';
import { IDExtractionResult } from '../../types/registration';
import { extractIDData } from '../../services/ocrService';
import { useImageTransform } from '../../hooks/useImageTransform';
import { useImageTilt } from '../../hooks/useImageTilt';
import { SmartCapture } from '../face/SmartCapture';
import {
  Camera,
  Check,
  CircleX,
  IdCard,
  Image as ImageIcon,
  Lightbulb,
  Lock,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Move,
} from 'lucide-react';

const CARD_RATIO = 85.6 / 53.98;

interface IDCardUploadProps {
  student: Student;
  onExtracted: (result: IDExtractionResult) => void;
  onCancel: () => void;
  /** نص اختياري يظهر بدلاً من "اسم الطالب — صوّر البطاقة الرسمية" (يُستخدم لروابط الحضور قبل معرفة الطالب) */
  title?: string;
}

const blobFromCanvas = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('فشل تحويل الصورة'));
    }, 'image/jpeg', 0.95);
  });

const rasterizeTransform = async (
  imageUrl: string,
  rotation: number,
  scale: number,
  translateX: number,
  translateY: number,
  containerW: number,
  containerH: number
): Promise<Blob> => {
  const img = document.createElement('img');
  img.crossOrigin = 'anonymous';
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('فشل تحميل الصورة'));
    img.src = imageUrl;
  });

  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = containerW * dpr;
  canvas.height = containerH * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const cx = containerW / 2;
  const cy = containerH / 2;

  ctx.translate(cx + translateX, cy + translateY);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(scale, scale);

  const imgAspect = img.width / img.height;
  const contAspect = containerW / containerH;
  let drawW: number, drawH: number;
  if (imgAspect > contAspect) {
    drawW = containerW;
    drawH = containerW / imgAspect;
  } else {
    drawH = containerH;
    drawW = containerH * imgAspect;
  }

  ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  return blobFromCanvas(canvas);
};

type Mode = 'choice' | 'smart_capture' | 'review';

export const IDCardUpload: React.FC<IDCardUploadProps> = ({
  student,
  onExtracted,
  onCancel,
  title,
}) => {
  const [mode, setMode] = useState<Mode>('choice');
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    transform,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    rotate90,
    resetTransform,
    getTransformStyle,
  } = useImageTransform();

  const { isLevel, level, updateUserRotation } = useImageTilt(preview);

  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);

  useEffect(() => {
    updateUserRotation(transform.rotation);
  }, [transform.rotation, updateUserRotation]);

  const processFile = async (targetFile: File) => {
    setProcessing(true);
    setError('');
    setProgress(0);
    setStatusText('جاري التحليل...');

    try {
      const result = await extractIDData(
        targetFile,
        (s, pct) => { setProgress(pct); setStatusText(s); },
        student.name,
      );

      if (!result.success) {
        setError(result.error || 'فشل قراءة الهوية');
        setProcessing(false);
        return;
      }

      if (preview) URL.revokeObjectURL(preview);
      setPreview(null);
      setFile(null);
      setProcessing(false);
      onExtracted(result);
    } catch (e: any) {
      setError(e.message || 'حدث خطأ غير متوقع');
      setProcessing(false);
    }
  };

  const handleSmartCapture = (capturedFile: File) => {
    setFile(capturedFile);
    setPreview(URL.createObjectURL(capturedFile));
    setMode('review');
  };

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
    setFile(selected);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(selected));
    setMode('review');
  };

  const handleProcess = async () => {
    if (!file) return;

    try {
      let imageToSend: File | Blob = file;

      const isTransformed =
        transform.rotation !== 0 || transform.scale !== 1 ||
        transform.translateX !== 0 || transform.translateY !== 0;

      if (isTransformed && preview && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const blob = await rasterizeTransform(
          preview, transform.rotation, transform.scale,
          transform.translateX, transform.translateY,
          rect.width, rect.height
        );
        imageToSend = blob;
      }

      await processFile(
        imageToSend instanceof Blob
          ? new File([imageToSend], 'adjusted.jpg', { type: 'image/jpeg' })
          : imageToSend
      );
    } catch (e: any) {
      setError(e.message || 'حدث خطأ غير متوقع');
      setProcessing(false);
    }
  };

  const handleReset = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFile(null);
    setError('');
    setProgress(0);
    setStatusText('');
    resetTransform();
    setMode('choice');
  };

  const frameColor = useMemo(() => {
    if (isLevel) return '#22c55e';
    if (level === 'yellow') return '#eab308';
    return '#ef4444';
  }, [isLevel, level]);

  if (mode === 'smart_capture') {
    return <SmartCapture onCapture={handleSmartCapture} onCancel={onCancel} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 max-w-lg w-full">
        <div className="text-center mb-5">
          <div className="mx-auto w-14 h-14 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-3">
            <IdCard className="w-7 h-7 text-indigo-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-800">تصوير بطاقة الهوية</h2>
          <p className="text-sm text-gray-500 mt-1">
            {title ? title : (
              <>
                <span className="font-bold text-indigo-600">{student.name}</span> — صوّر البطاقة الرسمية
              </>
            )}
          </p>
        </div>

        <div className="mb-4 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2">
          <Lock className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <p className="text-[11px] text-emerald-700">الصورة تُحذف فوراً بعد المعالجة. لا نخزن أي صور على خوادمنا.</p>
        </div>

        {mode === 'choice' && !processing && (
          <>
            <div className="space-y-2.5 mb-4">
              <button
                onClick={() => setMode('smart_capture')}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold py-3.5 rounded-xl shadow-lg active:scale-[0.98] transition flex items-center justify-center gap-2.5"
              >
                <Camera className="w-5 h-5" /> تصوير الهوية
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full bg-white hover:bg-gray-50 border-2 border-indigo-200 text-indigo-700 font-bold py-3.5 rounded-xl active:scale-[0.98] transition flex items-center justify-center gap-2.5"
              >
                <ImageIcon className="w-5 h-5" /> اختر من المعرض
              </button>
            </div>

            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleGallerySelect} className="hidden" />

            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-xs font-bold text-blue-800 mb-1.5 flex items-center gap-1.5">
                <Lightbulb className="w-3.5 h-3.5" /> نصائح للحصول على أفضل نتيجة:
              </p>
              <ul className="text-[11px] text-blue-700 space-y-1 list-disc list-inside leading-relaxed">
                <li>ضع البطاقة على خلفية داكنة</li>
                <li>تأكد أن رمز QR ظاهر وواضح</li>
                <li>أضوء الإضاءة على البطاقة بشكل متساوٍ</li>
                <li>تجنب الانعكاسات والظلال</li>
              </ul>
            </div>
          </>
        )}

        {mode === 'review' && preview && !processing && (
          <div className="space-y-3">
            <div
              ref={containerRef}
              className="relative w-full bg-gray-900 rounded-xl overflow-hidden touch-none select-none"
              style={{ aspectRatio: `${CARD_RATIO} / 1`, touchAction: 'none' }}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              <img
                src={preview}
                alt="الهوية"
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                style={{ transform: getTransformStyle(), willChange: 'transform' }}
                draggable={false}
              />

              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                <div
                  className="border-2 border-dashed rounded-lg transition-colors duration-200"
                  style={{
                    width: '84%',
                    aspectRatio: `${CARD_RATIO}`,
                    borderColor: frameColor,
                  }}
                />
              </div>

              <div className="absolute top-2 right-2 z-20 bg-black/50 backdrop-blur-sm rounded-md px-2 py-1">
                <span className="text-[10px] text-white font-mono">
                  {Math.round(transform.scale * 100)}%
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-gray-500 w-14 shrink-0">الميلان</span>
              <div className="flex-1 h-4 bg-gray-200 rounded-full overflow-hidden relative">
                <div className="absolute inset-y-0 w-px bg-gray-400" style={{ left: '50%' }} />
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-white shadow transition-all duration-200"
                  style={{
                    left: `${50 + Math.max(-20, Math.min(20, transform.rotation)) * 2.5}%`,
                    transform: 'translate(-50%, -50%)',
                    backgroundColor: frameColor,
                  }}
                />
              </div>
              <span className="text-[11px] font-bold w-12 text-center" style={{ color: frameColor }}>
                {isLevel ? '✓ مستقيم' : `${Math.round(transform.rotation)}°`}
              </span>
            </div>

            <div className="flex items-center justify-center gap-3">
              <button onClick={() => rotate90(-1)} className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition active:scale-95">
                <RotateCcw className="w-4 h-4 text-gray-600" />
              </button>
              <button onClick={resetTransform} className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition active:scale-95">
                <RefreshCw className="w-4 h-4 text-gray-600" />
              </button>
              <button onClick={() => rotate90(1)} className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition active:scale-95">
                <RotateCw className="w-4 h-4 text-gray-600" />
              </button>
            </div>

            <div className="p-1.5 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-[10px] text-gray-500 text-center flex items-center justify-center gap-1">
                <Move className="w-3 h-3" />
                اسحب للتحريك · إصبعين للتكبير والدوران · اضغط مرتين للإعادة
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button onClick={handleReset} className="py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold rounded-lg text-sm flex items-center justify-center gap-1.5 transition active:scale-[0.98]">
                <RefreshCw className="w-3.5 h-3.5" /> صورة أخرى
              </button>
              <button
                onClick={handleProcess}
                className="py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold rounded-lg text-sm flex items-center justify-center gap-1.5 transition active:scale-[0.98]"
              >
                <Check className="w-3.5 h-3.5" /> تحليل البطاقة
              </button>
            </div>
          </div>
        )}

        {processing && (
          <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-7 h-7 border-[3px] border-indigo-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-bold text-indigo-800 flex-1">{statusText}</p>
            </div>
            <div className="w-full bg-white rounded-full h-2.5 overflow-hidden border border-indigo-200">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-[11px] text-indigo-500 mt-1.5 text-center">{Math.round(progress)}%</p>
          </div>
        )}

        {error && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start gap-1.5">
            <CircleX className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
          </div>
        )}

        {!processing && (
          <button onClick={onCancel} className="w-full mt-2 py-2 text-gray-400 hover:text-gray-600 text-sm transition">
            إلغاء والعودة
          </button>
        )}
      </div>
    </div>
  );
};

export default IDCardUpload;
