// src/components/SelfRegister/FaceCaptureStep.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Student } from '../../types/student';
import {
  loadFaceModels,
  extractFaceDescriptorMultiCapture,
  buildMultiDescriptor,
  areModelsLoaded,
  type CaptureProgress,
  type FaceDirection,
  type LightLevel,
  type QualityLevel,
} from '../../services/faceRecognition';

interface FaceCaptureStepProps {
  student: Student;
  matchPercentage: number;
  onCaptured: (faceDescriptor: any) => void;
  onCancel: () => void;
}

const DIR_EMOJI: Record<FaceDirection, string> = {
  center: '⬜', right: '➡️', left: '⬅️', up: '⬆️', down: '⬇️'
};

const QUALITY_COLORS: Record<QualityLevel, string> = {
  excellent: 'text-green-600 bg-green-50',
  good: 'text-blue-600 bg-blue-50',
  fair: 'text-amber-600 bg-amber-50',
  poor: 'text-red-600 bg-red-50'
};

const QUALITY_LABELS: Record<QualityLevel, string> = {
  excellent: '🟢 ممتاز', good: '🔵 جيد', fair: '🟡 مقبول', poor: '🔴 ضعيف'
};

const LIGHT_LABELS: Record<LightLevel, string> = {
  dark: '🌑 مظلم', dim: '🌙 خافت', good: '☀️ جيد', bright: '🔆 ساطع'
};

const ALL_DIRS: FaceDirection[] = ['center', 'right', 'left', 'up', 'down'];

export const FaceCaptureStep: React.FC<FaceCaptureStepProps> = ({
  student,
  matchPercentage,
  onCaptured,
  onCancel,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  
  const [modelsReady, setModelsReady] = useState(areModelsLoaded());
  const [modelsLoading, setModelsLoading] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [capInfo, setCapInfo] = useState<CaptureProgress | null>(null);
  const [readyToStart, setReadyToStart] = useState(false);
  const [countdown, setCountdown] = useState(0);
  
  // ──────────────────────────────────────────
  // 🔧 تحميل الموديلات + فتح الكاميرا
  // ──────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    
    (async () => {
      try {
        // تحميل الموديلات
        if (!modelsReady) {
          setModelsLoading(true);
          await loadFaceModels();
          if (!mountedRef.current) return;
          setModelsReady(true);
          setModelsLoading(false);
        }
        
        // فتح الكاميرا
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        
        if (!mountedRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        
        streamRef.current = stream;
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        
        // انتظار ثانية حتى تستقر الكاميرا
        setTimeout(() => {
          if (mountedRef.current) {
            setCameraReady(true);
            setReadyToStart(true);
          }
        }, 1000);
        
      } catch (e: any) {
        console.error(e);
        if (!mountedRef.current) return;
        
        if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
          setError('يرجى السماح للموقع باستخدام الكاميرا من إعدادات المتصفح');
        } else if (e.name === 'NotFoundError') {
          setError('لم يتم العثور على كاميرا في جهازك');
        } else {
          setError(e.message || 'فشل فتح الكاميرا');
        }
        setModelsLoading(false);
      }
    })();
    
    return () => {
      mountedRef.current = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, [modelsReady]);
  
  // ──────────────────────────────────────────
  // 🎬 بدء التسجيل مع عد تنازلي
  // ──────────────────────────────────────────
  const handleStartCapture = useCallback(() => {
    if (!videoRef.current || !cameraReady || capturing) return;
    
    setReadyToStart(false);
    setCountdown(3);
    
    let count = 3;
    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        setCountdown(count);
      } else {
        clearInterval(interval);
        setCountdown(0);
        startActualCapture();
      }
    }, 1000);
  }, [cameraReady, capturing]);
  
  // ──────────────────────────────────────────
  // 📸 التقاط الوجه الفعلي
  // ──────────────────────────────────────────
  const startActualCapture = async () => {
    if (!videoRef.current) return;
    
    setCapturing(true);
    setCapInfo(null);
    
    try {
      const result = await extractFaceDescriptorMultiCapture(
        videoRef.current,
        (info) => {
          if (mountedRef.current) setCapInfo(info);
        }
      );
      
      if (!result) {
        setError('❌ لم نتمكن من التقاط وجهك بوضوح. تأكد من:\n- وجهك واضح وفي المنتصف\n- إضاءة جيدة\n- دوّر رأسك ببطء');
        setCapturing(false);
        setReadyToStart(true);
        return;
      }
      
      // بناء البصمة المضغوطة
      const multiDesc = buildMultiDescriptor(
        result.descriptor,
        result.angleDescs,
        result.quality,
        result.directions
      );
      
      // 🧹 إيقاف الكاميرا فوراً (الخصوصية)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      
      // إرسال البصمة (أرقام فقط، بدون صور)
      setTimeout(() => {
        onCaptured(multiDesc);
      }, 1000);
      
    } catch (e: any) {
      console.error(e);
      setError(e.message || 'فشل التقاط الوجه');
      setCapturing(false);
      setReadyToStart(true);
    }
  };
  
  // ──────────────────────────────────────────
  // 🎨 RENDER
  // ──────────────────────────────────────────
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-rose-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl p-5 md:p-6 max-w-md w-full">
        
        {/* Header */}
        <div className="text-center mb-4">
          <div className="text-4xl mb-2">😊</div>
          <h2 className="text-xl font-bold text-gray-800 mb-1">تسجيل بصمة الوجه</h2>
          <p className="text-xs text-gray-600">
            مرحباً <span className="font-bold text-purple-700">{student.name}</span>
          </p>
          {matchPercentage >= 90 && (
            <div className="mt-2 inline-block bg-green-100 text-green-700 text-xs font-bold px-3 py-1 rounded-full">
              ✓ تطابق الاسم: {matchPercentage}%
            </div>
          )}
        </div>
        
        {/* تنبيه الخصوصية */}
        <div className="mb-3 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
          <div className="flex items-start gap-2">
            <span className="text-base">🔒</span>
            <p className="text-xs text-emerald-800">
              <strong>خصوصيتك محمية:</strong> الكاميرا تعمل محلياً، ولا يتم حفظ أي صورة. 
              فقط أرقام رياضية (128 رقم) تُحفظ لتمييز وجهك.
            </p>
          </div>
        </div>
        
        {/* حالات التحميل والخطأ */}
        {modelsLoading && (
          <div className="text-center py-6">
            <div className="inline-block w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-gray-600 font-medium">جاري تحميل نظام التعرف على الوجوه...</p>
            <p className="text-xs text-gray-400 mt-1">قد يستغرق 5-10 ثوانٍ</p>
          </div>
        )}
        
        {error && !capturing && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm whitespace-pre-line">
            {error}
          </div>
        )}
        
        {/* عرض الكاميرا */}
        {modelsReady && !modelsLoading && (
          <div className="relative mb-4">
            <div className="relative rounded-2xl overflow-hidden bg-gray-900 aspect-square mx-auto" style={{ maxWidth: 320 }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />
              
              {/* إطار الوجه */}
              {cameraReady && !capturing && countdown === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-56 h-56 border-4 border-purple-400/70 rounded-full" 
                       style={{ boxShadow: '0 0 40px rgba(168,85,247,0.4)' }} />
                </div>
              )}
              
              {/* العد التنازلي */}
              {countdown > 0 && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <div className="text-white text-9xl font-bold animate-pulse" style={{ textShadow: '0 0 20px rgba(0,0,0,0.5)' }}>
                    {countdown}
                  </div>
                </div>
              )}
              
              {/* SVG للدائرة التقدمية */}
              {capturing && capInfo && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 200 200">
                  <circle cx="100" cy="100" r="92" fill="none" stroke="rgba(139,92,246,0.15)" strokeWidth="5" />
                  <circle
                    cx="100" cy="100" r="92" fill="none"
                    stroke={capInfo.progress >= 100 ? '#10b981' : '#8b5cf6'}
                    strokeWidth="5" strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 92}`}
                    strokeDashoffset={`${2 * Math.PI * 92 * (1 - capInfo.progress / 100)}`}
                    style={{
                      transition: 'stroke-dashoffset 0.15s linear',
                      transform: 'rotate(-90deg)',
                      transformOrigin: 'center',
                    }}
                  />
                  
                  {/* نقطة الاتجاه الحالي */}
                  {capInfo.phase === 'capture' && capInfo.faceDetected && (() => {
                    const angle = (capInfo.rotationAngle - 90) * (Math.PI / 180);
                    const cx = 100 + 92 * Math.cos(angle);
                    const cy = 100 + 92 * Math.sin(angle);
                    return (
                      <>
                        <circle cx={cx} cy={cy} r="8" fill="#8b5cf6" stroke="white" strokeWidth="3">
                          <animate attributeName="r" values="7;10;7" dur="0.8s" repeatCount="indefinite" />
                        </circle>
                        <circle cx={cx} cy={cy} r="4" fill="white" />
                      </>
                    );
                  })()}
                  
                  {/* علامات الاتجاهات المكتملة */}
                  {ALL_DIRS.map((dir) => {
                    const angles: Record<FaceDirection, number> = {
                      right: 0, down: 90, left: 180, up: 270, center: 315
                    };
                    const a = (angles[dir] - 90) * (Math.PI / 180);
                    const cx = 100 + 92 * Math.cos(a);
                    const cy = 100 + 92 * Math.sin(a);
                    const done = capInfo.capturedDirections.has(dir);
                    return (
                      <circle
                        key={dir}
                        cx={cx} cy={cy} r="6"
                        fill={done ? '#10b981' : 'rgba(139,92,246,0.2)'}
                        stroke={done ? '#065f46' : 'rgba(139,92,246,0.4)'}
                        strokeWidth="2"
                      />
                    );
                  })}
                </svg>
              )}
              
              {/* مؤشر اكتشاف الوجه */}
              {capturing && capInfo && capInfo.phase === 'capture' && (
                <div className={`absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold shadow-lg ${
                  capInfo.faceDetected ? 'bg-green-500 text-white' : 'bg-red-500 text-white animate-pulse'
                }`}>
                  {capInfo.faceDetected ? '✅ وجه واضح' : '❌ أين وجهك؟'}
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* معلومات التقدم أثناء التسجيل */}
        {capturing && capInfo && (
          <div className="space-y-2 mb-4">
            <div className={`py-3 px-4 rounded-xl font-bold text-center text-base ${
              capInfo.phase === 'stabilize' 
                ? 'bg-blue-50 text-blue-700' 
                : capInfo.faceDetected 
                  ? 'bg-green-50 text-green-700' 
                  : 'bg-red-50 text-red-700'
            }`}>
              {capInfo.phase === 'stabilize' ? '🔍 جاري التثبيت...' : capInfo.directionLabel}
            </div>
            
            <div className="flex justify-center gap-2 flex-wrap">
              <span className={`text-xs font-bold px-2 py-1 rounded-full ${QUALITY_COLORS[capInfo.qualityLevel]}`}>
                {QUALITY_LABELS[capInfo.qualityLevel]}
              </span>
              <span className="text-xs font-bold px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                {LIGHT_LABELS[capInfo.lightLevel]}
              </span>
            </div>
            
            <div className="flex justify-center gap-2 items-center">
              <span className="text-xs text-gray-500">🔄 تغطية الدوران:</span>
              <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 rounded-full transition-all"
                  style={{ width: `${capInfo.rotationCoverage}%` }}
                />
              </div>
              <span className="text-xs font-bold text-purple-600">{capInfo.rotationCoverage}%</span>
            </div>
            
            <div className="flex justify-center gap-4 text-xs text-gray-500">
              <span>📷 لقطات: {capInfo.totalGood}</span>
              <span>📊 التقدم: {capInfo.progress}%</span>
            </div>
            
            {/* الاتجاهات المكتملة */}
            <div className="flex justify-center gap-2">
              {ALL_DIRS.map(dir => (
                <span
                  key={dir}
                  className={`text-2xl transition-opacity ${
                    capInfo.capturedDirections.has(dir) ? 'opacity-100' : 'opacity-25'
                  }`}
                >
                  {DIR_EMOJI[dir]}
                </span>
              ))}
            </div>
          </div>
        )}
        
        {/* تعليمات البداية */}
        {readyToStart && !capturing && !error && (
          <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-xl">
            <p className="text-xs font-bold text-purple-800 mb-2">📋 تعليمات التسجيل:</p>
            <ul className="text-xs text-purple-700 space-y-1 list-decimal list-inside">
              <li>اضغط "بدء التسجيل"</li>
              <li>انظر للكاميرا مباشرة</li>
              <li>دوّر رأسك ببطء (يمين، يسار، أعلى، أسفل)</li>
              <li>التسجيل يستغرق <strong>10 ثوانٍ</strong> فقط</li>
            </ul>
          </div>
        )}
        
        {/* أزرار التحكم */}
        {!capturing && !modelsLoading && (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onCancel}
              className="py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg active:scale-95"
            >
              إلغاء
            </button>
            <button
              onClick={handleStartCapture}
              disabled={!cameraReady || !!error}
              className="py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-40 text-white font-bold rounded-lg active:scale-95"
            >
              📸 بدء التسجيل
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default FaceCaptureStep;