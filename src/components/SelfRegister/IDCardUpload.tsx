import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Student } from '../../types/student';
import { IDExtractionResult } from '../../types/registration';
import { extractIDData } from '../../services/ocrService';
import { useImageTransform } from '../../hooks/useImageTransform';
import { useImageTilt } from '../../hooks/useImageTilt';
import {
  Camera,
  Check,
  CircleX,
  IdCard,
  Image as ImageIcon,
  ShieldCheck,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Move,
  BadgeCheck,
} from 'lucide-react';

const CARD_RATIO = 85.6 / 53.98;

interface IDCardUploadProps {
  student: Student;
  onExtracted: (result: IDExtractionResult) => void;
  onCancel: () => void;
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

export const IDCardUpload: React.FC<IDCardUploadProps> = ({
  student,
  onExtracted,
  onCancel,
}) => {
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
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
  };

  const handleProcess = async () => {
    if (!file) return;
    setProcessing(true);
    setError('');
    setProgress(0);
    setStatusText('جاري التحليل...');

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
        setStatusText('جاري تحليل الصورة المعالجة...');
      }

      const result = await extractIDData(
        imageToSend instanceof Blob
          ? new File([imageToSend], 'adjusted.jpg', { type: 'image/jpeg' })
          : imageToSend,
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

  const handleReset = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFile(null);
    setError('');
    setProgress(0);
    setStatusText('');
    resetTransform();
  };

  const frameColor = useMemo(() => {
    if (isLevel) return '#0f766e';
    if (level === 'yellow') return '#b45309';
    return '#b91c1c';
  }, [isLevel, level]);

  return (
    <div className="min-h-screen bg-[#f4f6f8] flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 max-w-lg w-full overflow-hidden">

        {/* شريط علوي رسمي */}
        <div className="bg-[#0e2a47] px-6 py-4 flex items-center gap-3 border-b-4 border-[#c9a227]">
          <div className="w-11 h-11 shrink-0 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
            <IdCard className="w-6 h-6 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white leading-tight">التحقق من الهوية الرسمية</h2>
            <p className="text-xs text-slate-300 mt-0.5 truncate">نظام التحقق الإلكتروني للطلبة</p>
          </div>
        </div>

        <div className="p-6">
          <div className="mb-5 text-center">
            <p className="text-sm text-slate-500">الطالب المعني بالتحقق</p>
            <p className="text-lg font-bold text-[#0e2a47] mt-0.5">{student.name}</p>
          </div>

          <div className="mb-5 p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-[#0f766e] shrink-0 mt-0.5" />
            <p className="text-xs text-slate-600 leading-relaxed">
              تُعالج الصورة محلياً وتُحذف فوراً بعد الانتهاء من التحقق. لا يتم تخزين أي صور على الخوادم.
            </p>
          </div>

          {!preview && !processing && (
            <>
              <div className="space-y-2.5 mb-5">
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  className="w-full bg-[#0e2a47] hover:bg-[#123a61] text-white font-bold py-3.5 rounded-lg active:scale-[0.99] transition flex items-center justify-center gap-2.5"
                >
                  <Camera className="w-5 h-5" /> التقاط صورة الهوية
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full bg-white hover:bg-slate-50 border border-slate-300 text-[#0e2a47] font-bold py-3.5 rounded-lg active:scale-[0.99] transition flex items-center justify-center gap-2.5"
                >
                  <ImageIcon className="w-5 h-5" /> اختيار من المعرض
                </button>
              </div>

              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileSelect} className="hidden" />
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />

              <div className="p-3.5 bg-white border border-slate-200 rounded-lg">
                <p className="text-xs font-bold text-[#0e2a47] mb-2 flex items-center gap-1.5">
                  <BadgeCheck className="w-4 h-4 text-[#c9a227]" /> إرشادات للحصول على أفضل نتيجة
                </p>
                <ul className="text-[11px] text-slate-600 space-y-1.5 list-disc list-inside leading-relaxed">
                  <li>ضع البطاقة على خلفية داكنة ومستوية</li>
                  <li>تأكد من ظهور رمز QR بوضوح تام</li>
                  <li>وزّع الإضاءة بشكل متساوٍ على البطاقة</li>
                  <li>تجنّب الانعكاسات الضوئية والظلال</li>
                </ul>
              </div>
            </>
          )}

          {preview && !processing && (
            <div className="space-y-3">
              <div
                ref={containerRef}
                className="relative w-full bg-slate-900 rounded-lg overflow-hidden touch-none select-none border border-slate-300"
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

                <div className="absolute top-2 right-2 z-20 bg-black/60 backdrop-blur-sm rounded-md px-2 py-1">
                  <span className="text-[10px] text-white font-mono">
                    {Math.round(transform.scale * 100)}%
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-slate-500 w-14 shrink-0">الميلان</span>
                <div className="flex-1 h-3.5 bg-slate-200 rounded-full overflow-hidden relative">
                  <div className="absolute inset-y-0 w-px bg-slate-400" style={{ left: '50%' }} />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-white shadow transition-all duration-200"
                    style={{
                      left: `${50 + Math.max(-20, Math.min(20, transform.rotation)) * 2.5}%`,
                      transform: 'translate(-50%, -50%)',
                      backgroundColor: frameColor,
                    }}
                  />
                </div>
                <span className="text-[11px] font-bold w-14 text-center" style={{ color: frameColor }}>
                  {isLevel ? 'مستقيم ✓' : `${Math.round(transform.rotation)}°`}
                </span>
              </div>

              <div className="flex items-center justify-center gap-3">
                <button onClick={() => rotate90(-1)} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition active:scale-95 border border-slate-200">
                  <RotateCcw className="w-4 h-4 text-slate-600" />
                </button>
                <button onClick={resetTransform} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition active:scale-95 border border-slate-200">
                  <RefreshCw className="w-4 h-4 text-slate-600" />
                </button>
                <button onClick={() => rotate90(1)} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition active:scale-95 border border-slate-200">
                  <RotateCw className="w-4 h-4 text-slate-600" />
                </button>
              </div>

              <div className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-[10px] text-slate-500 text-center flex items-center justify-center gap-1">
                  <Move className="w-3 h-3" />
                  اسحب للتحريك · إصبعين للتكبير والدوران · اضغط مرتين للإعادة
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button onClick={handleReset} className="py-2.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-600 font-bold rounded-lg text-sm flex items-center justify-center gap-1.5 transition active:scale-[0.98]">
                  <RefreshCw className="w-3.5 h-3.5" /> صورة أخرى
                </button>
                <button
                  onClick={handleProcess}
                  className="py-2.5 bg-[#0f766e] hover:bg-[#0d6259] text-white font-bold rounded-lg text-sm flex items-center justify-center gap-1.5 transition active:scale-[0.98]"
                >
                  <Check className="w-3.5 h-3.5" /> تحليل البطاقة
                </button>
              </div>
            </div>
          )}

          {processing && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-6 h-6 border-[3px] border-[#0e2a47] border-t-transparent rounded-full animate-spin" />
                <p className="text-sm font-bold text-[#0e2a47] flex-1">{statusText}</p>
              </div>
              <div className="w-full bg-white rounded-full h-2 overflow-hidden border border-slate-300">
                <div
                  className="h-full bg-[#0e2a47] rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5 text-center font-mono">{Math.round(progress)}%</p>
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start gap-1.5">
              <CircleX className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
            </div>
          )}

          {!processing && (
            <button onClick={onCancel} className="w-full mt-4 py-2 text-slate-400 hover:text-slate-600 text-sm transition">
              إلغاء والعودة
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default IDCardUpload;
