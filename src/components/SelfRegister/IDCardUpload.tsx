// src/components/SelfRegister/IDCardUpload.tsx
import React, { useState, useRef, useEffect } from 'react';
import { Student } from '../../types/student';
import { IDExtractionResult } from '../../types/registration';
import { extractIDData, clearImageData } from '../../services/ocrService';

interface IDCardUploadProps {
  student: Student;
  onExtracted: (result: IDExtractionResult) => void;
  onCancel: () => void;
}

export const IDCardUpload: React.FC<IDCardUploadProps> = ({
  student,
  onExtracted,
  onCancel,
}) => {
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [debugText, setDebugText] = useState<string>('');
  const [showDebug, setShowDebug] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // تنظيف الصورة عند الخروج
  useEffect(() => {
    return () => {
      if (preview) clearImageData(preview);
    };
  }, [preview]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    // التحقق من النوع
    if (!selected.type.startsWith('image/')) {
      setError('الرجاء اختيار صورة فقط');
      return;
    }

    // التحقق من الحجم (أقل من 10 MB)
    if (selected.size > 10 * 1024 * 1024) {
      setError('الصورة كبيرة جداً (أقصى حد 10 MB)');
      return;
    }

    setError('');
    setDebugText('');
    setFile(selected);

    // معاينة
    if (preview) clearImageData(preview);
    const url = URL.createObjectURL(selected);
    setPreview(url);
  };

  const handleProcess = async () => {
    if (!file) return;

    setProcessing(true);
    setError('');
    setDebugText('');
    setProgress(0);
    setStatus('جاري التهيئة...');

    try {
      const result = await extractIDData(file, (msg, pct) => {
        setStatus(msg);
        setProgress(pct);
      });

      // حفظ النص الخام للتشخيص
      if (result.rawText) {
        setDebugText(result.rawText);
        console.log('📜 النص الخام:', result.rawText);
      }

      // 🧹 حذف الصورة فوراً بعد المعالجة (للخصوصية)
      if (preview) {
        clearImageData(preview);
        setPreview(null);
      }
      setFile(null);

      // إذا فشل، نعرض الخطأ هنا قبل ما نرسل النتيجة
      if (!result.success && result.error) {
        setError(result.error);
        setProcessing(false);
        // نرسل النتيجة حتى لو فيها فشل (المكون الأب يقرر)
        setTimeout(() => {
          onExtracted(result);
        }, 1500);
        return;
      }

      // تأخير صغير للسماح للـ UI بالتحديث
      setTimeout(() => {
        onExtracted(result);
      }, 300);

    } catch (e: any) {
      console.error(e);
      setError(e.message || 'فشل قراءة الهوية');
      setProcessing(false);
    }
  };

  const handleReset = () => {
    if (preview) clearImageData(preview);
    setPreview(null);
    setFile(null);
    setError('');
    setDebugText('');
    setShowDebug(false);
    setStatus('');
    setProgress(0);
  };

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-rose-50 flex items-center justify-center p-4"
      dir="rtl"
    >
      <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 max-w-lg w-full">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">🪪</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-1">رفع صورة الهوية</h2>
          <p className="text-sm text-gray-600">
            مرحباً <span className="font-bold text-purple-700">{student.name}</span>
          </p>
        </div>

        {/* تنبيه الخصوصية */}
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
          <div className="flex items-start gap-2">
            <span className="text-xl">🔒</span>
            <div className="flex-1 text-xs text-emerald-800">
              <strong>الخصوصية محمية:</strong> صورة الهوية تُحذف فوراً بعد قراءة الاسم ورمز QR.
              لن يتم حفظ أي صورة في النظام.
            </div>
          </div>
        </div>

        {/* معاينة الصورة */}
        {preview && !processing && (
          <div className="mb-4">
            <div className="relative rounded-xl overflow-hidden border-2 border-purple-200 bg-gray-100">
              <img
                src={preview}
                alt="الهوية"
                className="w-full max-h-64 object-contain"
              />
              <button
                onClick={handleReset}
                className="absolute top-2 left-2 bg-red-600 hover:bg-red-700 text-white w-8 h-8 rounded-full flex items-center justify-center shadow-lg"
                title="إزالة"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* أزرار الرفع */}
        {!preview && !processing && (
          <div className="space-y-3 mb-4">
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold py-4 px-6 rounded-xl shadow-lg active:scale-95 transition flex items-center justify-center gap-3"
            >
              <span className="text-2xl">📷</span>
              <span>التقاط بالكاميرا</span>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full bg-white hover:bg-gray-50 border-2 border-purple-300 text-purple-700 font-bold py-4 px-6 rounded-xl active:scale-95 transition flex items-center justify-center gap-3"
            >
              <span className="text-2xl">🖼️</span>
              <span>اختيار من المعرض</span>
            </button>
          </div>
        )}

        {/* Inputs مخفية */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileSelect}
          className="hidden"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* شريط التقدم */}
        {processing && (
          <div className="mb-4 p-4 bg-purple-50 border border-purple-200 rounded-xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 border-3 border-purple-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-bold text-purple-800 flex-1">{status}</p>
            </div>
            <div className="w-full bg-white rounded-full h-3 overflow-hidden border border-purple-200">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-purple-600 text-center mt-2">{progress}%</p>
          </div>
        )}

        {/* رسالة خطأ */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="text-red-700 text-sm font-semibold mb-2">❌ {error}</div>

            {/* زر إظهار التشخيص */}
            {debugText && (
              <button
                onClick={() => setShowDebug(!showDebug)}
                className="text-xs text-red-600 hover:text-red-800 underline"
              >
                {showDebug ? '🔼 إخفاء التفاصيل التقنية' : '🔽 عرض التفاصيل التقنية (للتشخيص)'}
              </button>
            )}
          </div>
        )}

        {/* عرض النص الخام للتشخيص */}
        {showDebug && debugText && (
          <div className="mb-4 p-3 bg-gray-900 border border-gray-700 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-gray-300">📜 النص المستخرج من OCR:</p>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(debugText);
                  alert('تم النسخ ✓');
                }}
                className="text-xs text-blue-400 hover:text-blue-300 underline"
              >
                📋 نسخ
              </button>
            </div>
            <pre
              className="text-xs text-green-400 whitespace-pre-wrap break-words max-h-40 overflow-y-auto font-mono"
              dir="rtl"
            >
              {debugText}
            </pre>
            <p className="text-xs text-gray-500 mt-2 text-center">
              💡 أرسل هذا النص للدعم الفني لمساعدتك في حل المشكلة
            </p>
          </div>
        )}

        {/* نصائح للصورة */}
        {!preview && !processing && !error && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs font-bold text-blue-800 mb-2">
              💡 نصائح للحصول على أفضل نتيجة:
            </p>
            <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
              <li>تأكد من وضوح الإضاءة (تجنّب الإضاءة الخافتة)</li>
              <li>صور الهوية كاملة بدون قص للأطراف</li>
              <li>تأكد من ظهور <strong>الاسم</strong> و <strong>رمز QR</strong> بوضوح</li>
              <li>تجنب الانعكاسات والظلال على الهوية</li>
              <li>الأفضل: ضع الهوية على سطح مستوٍ وصوّرها من فوق</li>
              <li>تأكد من أن الكاميرا مركّزة (Focused)</li>
            </ul>
          </div>
        )}

        {/* أزرار التحكم */}
        {preview && !processing && (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleReset}
              className="py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg active:scale-95 transition"
            >
              🔄 صورة أخرى
            </button>
            <button
              onClick={handleProcess}
              className="py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold rounded-lg active:scale-95 transition"
            >
              ✓ تحليل الهوية
            </button>
          </div>
        )}

        {/* زر إعادة المحاولة بعد خطأ */}
        {error && !preview && !processing && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button
              onClick={() => {
                setError('');
                setDebugText('');
                setShowDebug(false);
              }}
              className="py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg active:scale-95 transition"
            >
              🔄 محاولة جديدة
            </button>
            <button
              onClick={onCancel}
              className="py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg active:scale-95 transition"
            >
              إلغاء
            </button>
          </div>
        )}

        {/* زر إلغاء (في حالات أخرى) */}
        {!processing && !error && (
          <button
            onClick={onCancel}
            className="w-full mt-3 py-2 text-gray-500 hover:text-gray-700 text-sm"
          >
            إلغاء والعودة
          </button>
        )}
      </div>
    </div>
  );
};

export default IDCardUpload;