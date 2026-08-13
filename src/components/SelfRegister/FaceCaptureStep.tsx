// src/components/SelfRegister/FaceCaptureStep.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Student } from '../../types/student';
import {
  extractFaceDescriptor,
  detectSingleFace,
  areModelsLoaded,
  isPreloadStarted,
  startBackgroundPreload,
  normalizeDescriptor,
  checkForTamperingAsync,
  buildMultiDescriptor,
  drawFaceLandmarks,
  MultiDescriptor,
} from '../../services/faceRecognition';
import * as faceapi from 'face-api.js';

interface FaceCaptureStepProps {
  student: Student;
  matchPercentage: number;
  allStudents?: Student[];
  onCaptured: (faceDescriptor: MultiDescriptor) => void;
  onCancel: () => void;
}

export const FaceCaptureStep: React.FC<FaceCaptureStepProps> = ({
  student,
  matchPercentage,
  allStudents = [],
  onCaptured,
  onCancel,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const landmarkCanvasRef = useRef<HTMLCanvasElement>(null);

  const [modelsReady, setModelsReady] = useState(areModelsLoaded());
  const [modelsLoading, setModelsLoading] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [detLandmarks, setDetLandmarks] = useState<faceapi.FaceLandmarks68 | null>(null);
  const [detBox, setDetBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // تحميل النماذج
  useEffect(() => {
    mountedRef.current = true;

    const checkModels = () => {
      if (areModelsLoaded() && mountedRef.current) {
        setModelsReady(true);
        setModelsLoading(false);
        return true;
      }
      return false;
    };

    if (checkModels()) return;

    // بدء التحميل إذا لم يبدأ بعد
    if (!isPreloadStarted()) {
      startBackgroundPreload();
    }

    setModelsLoading(true);

    const interval = setInterval(checkModels, 200);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  // فتح الكاميرا
  useEffect(() => {
    if (!modelsReady) return;
    
    let localStream: MediaStream | null = null;
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        
        localStream = stream;
        streamRef.current = stream;
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        
        if (!cancelled && mountedRef.current) setCameraReady(true);
      } catch (e: any) {
        if (cancelled) return;
        if (e.name === 'NotAllowedError') setError('يرجى السماح باستخدام الكاميرا');
        else if (e.name === 'NotFoundError') setError('لم يتم العثور على كاميرا');
        else setError(e.message || 'فشل فتح الكاميرا');
      }
    })();

    return () => {
      cancelled = true;
      if (localStream) localStream.getTracks().forEach(t => t.stop());
      if (streamRef.current === localStream) streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [modelsReady]);

  // كشف الوجه المستمر
  useEffect(() => {
    if (!cameraReady || capturing || !videoRef.current) return;
    
    const iv = window.setInterval(async () => {
      if (!videoRef.current || !mountedRef.current) return;
      
      try {
        const det = await detectSingleFace(videoRef.current, 320);
        if (!mountedRef.current) return;
        
        if (det) {
          setFaceDetected(true);
          setDetLandmarks(det.landmarks);
          setDetBox({
            x: det.detection.box.x,
            y: det.detection.box.y,
            width: det.detection.box.width,
            height: det.detection.box.height,
          });
        } else {
          setFaceDetected(false);
          setDetLandmarks(null);
          setDetBox(null);
        }
      } catch {}
    }, 150);
    
    return () => clearInterval(iv);
  }, [cameraReady, capturing]);

  // رسم معالم الوجه
  useEffect(() => {
    const canvas = landmarkCanvasRef.current;
    const container = canvas?.parentElement;
    
    if (!canvas || !container || !detLandmarks || !detBox) {
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }
    
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const frameW = videoRef.current?.videoWidth || 640;
    const frameH = videoRef.current?.videoHeight || 480;
    
    drawFaceLandmarks(ctx, detLandmarks, detBox, canvas.width, canvas.height, frameW, frameH, true);
  }, [detLandmarks, detBox]);

  const handleCapture = async () => {
    if (!videoRef.current || capturing) return;
    
    setCapturing(true);
    setError('');
    
    try {
      const descriptor = await extractFaceDescriptor(videoRef.current);
      
      if (!descriptor) {
        setError('لم يتم التعرف على الوجه. تأكد من الإضاءة والمسافة.');
        setCapturing(false);
        return;
      }
      
      const normalized = normalizeDescriptor(descriptor);

      // التحقق من التكرار
      if (allStudents.length > 1) {
        const tamper = await checkForTamperingAsync(normalized, allStudents, student.id || '');
        if (tamper.isTamper) {
          setError(`⚠️ هذا الوجه مسجل مسبقاً للطالب: ${tamper.matchedStudents.map(m => m.name).join('، ')}`);
          setCapturing(false);
          return;
        }
      }

      const angleDescs = new Map<string, Float32Array[]>();
      angleDescs.set('center', [normalized]);
      const multiDesc = buildMultiDescriptor(normalized, angleDescs, 1, new Set(['center']));

      // إيقاف الكاميرا
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }

      setTimeout(() => onCaptured(multiDesc), 500);
    } catch (e: any) {
      setError(e.message || 'فشل حفظ البصمة');
      setCapturing(false);
    }
  };

  const handleRetry = () => {
    setError('');
    setCapturing(false);
    setFaceDetected(false);
    setDetLandmarks(null);
    setDetBox(null);
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);

    // إذا كانت النماذج لم تزل غير محملة، أعد تشغيل التحميل
    if (!areModelsLoaded()) {
      if (!isPreloadStarted()) {
        startBackgroundPreload();
      }
      setModelsLoading(true);
      return;
    }

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
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
        
        if (mountedRef.current) setCameraReady(true);
      } catch (e: any) {
        if (mountedRef.current) setError(e.message || 'فشل فتح الكاميرا');
      }
    })();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-rose-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl p-5 md:p-6 max-w-md w-full">
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

        {modelsLoading && (
          <div className="text-center py-6">
            <div className="inline-block w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-gray-600 font-medium">جاري تحميل نظام التعرف...</p>
            <button
              onClick={onCancel}
              className="mt-4 py-2 px-6 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg active:scale-95 text-sm"
            >
              إلغاء
            </button>
          </div>
        )}

        {error && !capturing && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm whitespace-pre-line">
            {error}
          </div>
        )}

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
              <canvas ref={landmarkCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

              {cameraReady && !capturing && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div
                    className={`w-56 h-56 border-4 rounded-full ${
                      faceDetected ? 'border-green-400/70' : 'border-purple-400/70'
                    }`}
                    style={{
                      boxShadow: faceDetected
                        ? '0 0 40px rgba(34,197,94,0.4)'
                        : '0 0 40px rgba(168,85,247,0.4)',
                    }}
                  />
                </div>
              )}

              {capturing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <div className="w-8 h-8 border-3 border-purple-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
            
            {cameraReady && !capturing && (
              <div className="mt-2 text-center">
                <span className={`text-xs font-medium ${faceDetected ? 'text-green-600' : 'text-gray-500'}`}>
                  {faceDetected ? '✅ تم كشف الوجه' : '⏳ ضع وجهك داخل الدائرة'}
                </span>
              </div>
            )}
          </div>
        )}

        {cameraReady && !capturing && !error && modelsReady && !modelsLoading && (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onCancel}
              className="py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg active:scale-95"
            >
              إلغاء
            </button>
            <button
              onClick={handleCapture}
              disabled={!faceDetected}
              className="py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-40 text-white font-bold rounded-lg active:scale-95"
            >
              {faceDetected ? 'التقاط ✅' : 'انتظر الكشف...'}
            </button>
          </div>
        )}

        {error && !capturing && (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onCancel}
              className="py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg active:scale-95"
            >
              إلغاء
            </button>
            <button
              onClick={handleRetry}
              className="py-3 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-bold rounded-lg active:scale-95"
            >
              إعادة المحاولة
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default FaceCaptureStep;
