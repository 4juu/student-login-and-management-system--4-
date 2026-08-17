// src/components/SelfRegister/IDCardUpload.tsx
import React, { useState, useRef, useEffect } from 'react';
import { Student } from '../../types/student';
import { IDExtractionResult } from '../../types/registration';
import { extractIDData } from '../../services/ocrService';
import { Camera, Check, CircleX, IdCard, Image, Lightbulb, Lock, RefreshCw } from 'lucide-react';

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
  const [error, setError] = useState('');

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
    setPreview(URL.createObjectURL(selected));
  };

  const handleProcess = async () => {
    if (!file) return;
    setProcessing(true);
    setError('');

    try {
      const result = await extractIDData(file, (_status, pct) => {
        setProgress(pct);
      });

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
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-rose-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 max-w-lg w-full">
        <div className="text-center mb-6">
          <div className="mx-auto w-16 h-16 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-3"><IdCard className="w-8 h-8 text-purple-600" /></div>
          <h2 className="text-2xl font-bold text-gray-800 mb-1">رفع صورة الهوية</h2>
          <p className="text-sm text-gray-600">
            مرحباً <span className="font-bold text-purple-700">{student.name}</span>
          </p>
        </div>

        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
          <div className="flex items-start gap-2">
            <Lock className="w-5 h-5 text-emerald-700 shrink-0" />
            <div className="flex-1 text-xs text-emerald-800">
              <strong>الخصوصية محمية:</strong> صورة الهوية تُحذف فوراً بعد المعالجة.
            </div>
          </div>
        </div>

        <>
          {preview && !processing && (
            <div className="mb-4">
              <div className="relative rounded-xl overflow-hidden border-2 border-purple-200 bg-gray-100">
                <img src={preview} alt="الهوية" className="w-full max-h-64 object-contain" />
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
                <Camera className="w-6 h-6" />
                <span>التقاط بالكاميرا</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full bg-white hover:bg-gray-50 border-2 border-purple-300 text-purple-700 font-bold py-4 px-6 rounded-xl active:scale-95 transition flex items-center justify-center gap-3"
              >
                <Image className="w-6 h-6" />
                <span>اختيار من المعرض</span>
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
                <p className="text-sm font-bold text-purple-800 flex-1">جاري التحليل...</p>
              </div>
              <div className="w-full bg-white rounded-full h-3 overflow-hidden border border-purple-200">
                <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-purple-500 mt-2 text-center">{Math.round(progress)}%</p>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-1.5"><CircleX className="w-4 h-4 shrink-0" /> {error}</div>
          )}

          {!preview && !processing && !error && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-xs font-bold text-blue-800 mb-2 flex items-center gap-1.5"><Lightbulb className="w-3.5 h-3.5" /> نصائح:</p>
              <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
                <li>ضع الهوية بإضاءة واضحة</li>
                <li>تجنب انعكاسات الإضاءة على البلاستيك</li>
              </ul>
            </div>
          )}

          {preview && !processing && (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={handleReset} className="py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg flex items-center justify-center gap-1.5">
                <RefreshCw className="w-4 h-4" /> صورة أخرى
              </button>
              <button onClick={handleProcess} className="py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold rounded-lg flex items-center justify-center gap-1.5">
                <Check className="w-4 h-4" /> تحليل الهوية
              </button>
            </div>
          )}

          {!processing && (
            <button onClick={onCancel} className="w-full mt-3 py-2 text-gray-500 hover:text-gray-700 text-sm">
              إلغاء والعودة
            </button>
          )}
        </>
      </div>
    </div>
  );
};

export default IDCardUpload;
