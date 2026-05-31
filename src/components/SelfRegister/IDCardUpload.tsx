// src/components/SelfRegister/IDCardUpload.tsx
import React, { useState, useRef, useEffect } from 'react';
import { Student } from '../../types/student';
import { IDExtractionResult } from '../../types/registration';

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
  const [manualName, setManualName] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

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
    const url = URL.createObjectURL(selected);
    setPreview(url);
  };

  const handleProcess = async () => {
    if (!file) return;

    setProcessing(true);
    setError('');
    setProgress(0);
    setStatus('جاري تحليل الصورة...');

    // محاكاة معالجة OCR بسيطة
    try {
      // في الإنتاج، استخدم ocrService الحقيقي
      await new Promise(r => setTimeout(r, 1500));
      setProgress(50);
      setStatus('جاري قراءة البيانات...');
      
      await new Promise(r => setTimeout(r, 1000));
      setProgress(100);

      // إذا لم يكن لدينا OCR حقيقي، نطلب الإدخال اليدوي
      setShowManualInput(true);
      setProcessing(false);
    } catch (e: any) {
      setError(e.message || 'فشل قراءة الهوية');
      setProcessing(false);
    }
  };

  const handleManualSubmit = () => {
    if (!manualName.trim()) {
      setError('الرجاء إدخال الاسم');
      return;
    }

    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFile(null);

    onExtracted({
      success: true,
      fullName: manualName.trim(),
      name: manualName.trim(),
    });
  };

  const handleSkipToFace = () => {
    // استخدام اسم الطالب من النظام مباشرة
    onExtracted({
      success: true,
      fullName: student.name,
      name: student.name,
    });
  };

  const handleReset = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFile(null);
    setError('');
    setShowManualInput(false);
    setManualName('');
    setStatus('');
    setProgress(0);
  };

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-rose-50 flex items-center justify-center p-4"
      dir="rtl"
    >
      <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 max-w-lg w-full">
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">🪪</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-1">رفع صورة الهوية</h2>
          <p className="text-sm text-gray-600">
            مرحباً <span className="font-bold text-purple-700">{student.name}</span>
          </p>
        </div>

        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
          <div className="flex items-start gap-2">
            <span className="text-xl">🔒</span>
            <div className="flex-1 text-xs text-emerald-800">
              <strong>الخصوصية محمية:</strong> صورة الهوية تُحذف فوراً بعد المعالجة.
            </div>
          </div>
        </div>

        {showManualInput ? (
          <div className="space-y-4">
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <p className="text-sm text-blue-800 mb-3">
                أدخل اسمك الكامل كما هو مكتوب في الهوية:
              </p>
              <input
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="الاسم الرباعي..."
                className="w-full p-3 border-2 border-blue-300 rounded-xl focus:border-blue-500 outline-none text-right"
                dir="rtl"
                autoFocus
              />
            </div>
            
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleReset}
                className="py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg"
              >
                🔄 إعادة
              </button>
              <button
                onClick={handleManualSubmit}
                disabled={!manualName.trim()}
                className="py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-40 text-white font-bold rounded-lg"
              >
                متابعة ✓
              </button>
            </div>
          </div>
        ) : (
          <>
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
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

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

                <button
                  onClick={handleSkipToFace}
                  className="w-full text-gray-500 hover:text-gray-700 text-sm py-2"
                >
                  تخطي والمتابعة ببصمة الوجه فقط →
                </button>
              </div>
            )}

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
              </div>
            )}

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                ❌ {error}
              </div>
            )}

            {!preview && !processing && !error && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs font-bold text-blue-800 mb-2">💡 نصائح:</p>
                <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
                  <li>تأكد من وضوح الإضاءة</li>
                  <li>صور الهوية كاملة بدون قص</li>
                  <li>تجنب الانعكاسات والظلال</li>
                </ul>
              </div>
            )}

            {preview && !processing && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleReset}
                  className="py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg"
                >
                  🔄 صورة أخرى
                </button>
                <button
                  onClick={handleProcess}
                  className="py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold rounded-lg"
                >
                  ✓ تحليل الهوية
                </button>
              </div>
            )}

            {!processing && !error && (
              <button
                onClick={onCancel}
                className="w-full mt-3 py-2 text-gray-500 hover:text-gray-700 text-sm"
              >
                إلغاء والعودة
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default IDCardUpload;
