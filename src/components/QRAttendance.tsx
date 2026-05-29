// src/components/QRAttendance.tsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { FaceRegistration } from './FaceRegistration';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import { AttendanceSession, Student } from '../types/student';
import {
  loadFaceModels, extractAllFaceDescriptorsHybrid, extractAllFaceDescriptors,
  extractFaceDescriptorMultiCapture, findBestMatch, IOUTracker,
  areModelsLoaded, resetModels, buildMultiDescriptor, checkForTamperingAsync,
  shouldAutoImprove, autoImproveDescriptor, detectFaceDirection,
  type CaptureProgress, type FaceDirection,
} from '../services/faceRecognition';

/* ── Types ── */
interface QRAttendanceProps {
  students: Student[];
  activeSession: AttendanceSession | null;
  onMarkAttendance: (student: Student) => Promise<void> | void;
  onUpdateStudent?: (id: string, updates: Partial<Student>) => void;
  alreadyPresentIds: Set<string>;
  onClose: () => void;
}
type ToastType = 'success' | 'error' | 'info' | 'warning';
type ScanMode = 'qr' | 'bulk';
type CameraFacing = 'environment' | 'user';
type BulkSensitivity = 'far' | 'extreme';
interface ToastMessage { id: number; type: ToastType; title: string; text?: string; }
interface DetectedFaceBox { box: { x: number; y: number; width: number; height: number }; student: Student | null; status: 'recognized' | 'already' | 'unknown'; confidence: number; timestamp: number; }

const QR_REGION_ID = 'qr-reader-v3';
const DUPLICATE_BLOCK_MS = 30_000;
const BULK_FACE_BLOCK_MS = 120_000;
const BOX_FADE_MS = 4000;
const CONFIDENCE_THRESHOLD = 0.60;

interface DeviceTier { tier: 'low' | 'mid' | 'high'; cores: number; memory: number; fps: number; maxFaces: number; intervalMs: number; useHybrid: boolean; }
const detectDeviceTier = (): DeviceTier => {
  const c = navigator.hardwareConcurrency || 2, m = (navigator as any).deviceMemory || 2;
  if (c >= 8 && m >= 6) return { tier: 'high', cores: c, memory: m, fps: 30, maxFaces: 8, intervalMs: 300, useHybrid: true };
  if (c >= 4 && m >= 3) return { tier: 'mid', cores: c, memory: m, fps: 20, maxFaces: 5, intervalMs: 450, useHybrid: false };
  return { tier: 'low', cores: c, memory: m, fps: 10, maxFaces: 3, intervalMs: 700, useHybrid: false };
};

const extractQrCodeId = (t: string): string | null => {
  const r = t.trim();
  try { const u = new URL(r); const id = u.searchParams.get('id'); if (id) return id.trim(); } catch {}
  try { const o = JSON.parse(r); const v = o.qrCodeId || o.qrId || o.id || o.studentId || o.universityId || o.code; if (v) return String(v).trim(); } catch {}
  if (/^[A-Za-z0-9_-]{3,100}$/.test(r)) return r;
  return null;
};
const getQrBox = () => { const m = Math.min(window.innerWidth, window.innerHeight); const s = Math.max(180, Math.min(300, Math.floor(m * 0.6))); return { width: s, height: s }; };

const beep = (f: number, d: number, v = 0.05) => { try { const AC = window.AudioContext || (window as any).webkitAudioContext; if (!AC) return; const ctx = new AC(), o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.value = v; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + d / 1000); setTimeout(() => ctx.close(), d + 100); } catch {} };
const playFaceSuccess = () => { try { const AC = window.AudioContext || (window as any).webkitAudioContext; if (!AC) return; const ctx = new AC(); [{ f: 523, s: 0, d: 0.12, v: 0.18 }, { f: 659, s: 0.10, d: 0.12, v: 0.20 }, { f: 784, s: 0.20, d: 0.22, v: 0.22 }].forEach(({ f, s, d, v }) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0, ctx.currentTime + s); g.gain.linearRampToValueAtTime(v, ctx.currentTime + s + 0.03); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + s + d); o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + s); o.stop(ctx.currentTime + s + d + 0.05); }); setTimeout(() => ctx.close(), 700); navigator.vibrate?.([40, 20, 40]); } catch {} };
const playSuccess = () => { navigator.vibrate?.([50, 30, 50]); beep(880, 100, 0.15); };
const playCapture = () => { navigator.vibrate?.(30); beep(1200, 50, 0.08); };
const playError = () => { navigator.vibrate?.([150]); beep(200, 200, 0.10); };
const playTamperAlert = () => { navigator.vibrate?.([200, 100, 200, 100, 200]); beep(300, 400, 0.2); };

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath(); }


/* ══════════════════════════════════════════════════════════ */
export const QRAttendance: React.FC<QRAttendanceProps> = ({
  students, activeSession, onMarkAttendance, onUpdateStudent,
  alreadyPresentIds, onClose,
}) => {
  const device = useMemo(detectDeviceTier, []);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const processingRef = useRef(false);
  const lastScansRef = useRef<Record<string, number>>({});
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const faceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const faceRunningRef = useRef(false);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectedFacesRef = useRef<Map<string, DetectedFaceBox>>(new Map());
  const animFrameRef = useRef<number | null>(null);
  const lastRestartRef = useRef(0);
  const toastCounterRef = useRef(0);
  const qrCodeInputRef = useRef<HTMLInputElement | null>(null);
  const trackerRef = useRef<IOUTracker | null>(null);
  const frameSkipRef = useRef(0);

  // تنظيف دوري لخريطة debounce
  useEffect(() => {
    const cleanup = setInterval(() => {
      const now = Date.now();
      const cutoff = now - 300000; // 5 دقائق
      const map = lastScansRef.current;
      for (const key of Object.keys(map)) {
        if (map[key] < cutoff) delete map[key];
      }
    }, 60000);
    return () => clearInterval(cleanup);
  }, []);

  const [mode, setMode] = useState<ScanMode>('qr');
  const [facing, setFacing] = useState<CameraFacing>('environment');
  const [cameraReady, setCameraReady] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [scanCount, setScanCount] = useState(0);
  const [recentStudents, setRecentStudents] = useState<Student[]>([]);
  const [pendingQrId, setPendingQrId] = useState<string | null>(null);
  const [qrLinkCode, setQrLinkCode] = useState('');
  const [qrLinkMessage, setQrLinkMessage] = useState('');
  const [zoom, setZoom] = useState(1);
  const [maxZoom, setMaxZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [canZoom, setCanZoom] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [faceModelsReady, setFaceModelsReady] = useState(areModelsLoaded);
  const [faceLoading, setFaceLoading] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<'starting' | 'ready' | 'error' | 'restarting'>('starting');
  const [bulkStudents, setBulkStudents] = useState<Student[]>([]);
  const [bulkDetected, setBulkDetected] = useState(0);
  const [bulkSidebar, setBulkSidebar] = useState(false);
  const [sensitivity, setSensitivity] = useState<BulkSensitivity>('far');
  const [showReg, setShowReg] = useState(false);

  const studentMap = useMemo(() => { const m = new Map<string, Student>(); students.forEach(s => { if (s.qrCodeId) m.set(s.qrCodeId.trim(), s); if (s.universityId) m.set(s.universityId.trim(), s); }); return m; }, [students]);
  const studentsWithFace = useMemo(() => students.filter(s => {
    if (!s.faceDescriptor) return false;
    if (Array.isArray(s.faceDescriptor)) return s.faceDescriptor.length > 0;
    if (typeof s.faceDescriptor === 'object') return true;
    return true;
  }), [students]);

  const showToast = useCallback((msg: Omit<ToastMessage, 'id'>, ms = 2500) => {
    const id = ++toastCounterRef.current;
    setToasts(prev => [{ ...msg, id }, ...prev].slice(0, 4));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), ms);
  }, []);

  const hardStop = useCallback(async () => {
    faceRunningRef.current = false;
    if (faceTimerRef.current) { clearTimeout(faceTimerRef.current); faceTimerRef.current = null; }
    if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
    if (trackRef.current && torchOn) try { await trackRef.current.applyConstraints({ advanced: [{ torch: false } as any] }); } catch {}
    if (scannerRef.current) {
      try { const st = scannerRef.current.getState(); if (st === Html5QrcodeScannerState.SCANNING || st === Html5QrcodeScannerState.PAUSED) await scannerRef.current.stop(); } catch {}
      try { await scannerRef.current.clear(); } catch {}
      scannerRef.current = null;
    }
    if (trackRef.current) { try { trackRef.current.stop(); } catch {} trackRef.current = null; }
    const vid = document.querySelector(`#${QR_REGION_ID} video`) as HTMLVideoElement | null;
    if (vid?.srcObject) try { (vid.srcObject as MediaStream).getTracks().forEach(t => t.stop()); vid.srcObject = null; } catch {}
    const reg = document.getElementById(QR_REGION_ID); if (reg) reg.innerHTML = '';
  }, [torchOn]);

  const pauseQrScanner = useCallback(async () => { if (!scannerRef.current) return; try { const st = scannerRef.current.getState(); if (st === Html5QrcodeScannerState.SCANNING) await scannerRef.current.pause(true); } catch {} }, []);
  const resumeQrScanner = useCallback(async () => { if (!scannerRef.current) return; try { const st = scannerRef.current.getState(); if (st === Html5QrcodeScannerState.PAUSED) await scannerRef.current.resume(); } catch {} }, []);

  const startCamera = useCallback(async (cf: CameraFacing) => {
    if (!mountedRef.current || startingRef.current) return;
    startingRef.current = true;
    setCameraStatus('starting'); setErrorMsg(''); setCameraReady(false);
    try {
      await hardStop(); await new Promise(r => setTimeout(r, 400));
      if (!mountedRef.current) return;
      const region = document.getElementById(QR_REGION_ID); if (region) region.innerHTML = '';
      const qrBox = getQrBox();
      const mobile = device.tier !== 'high';
      const attempts = mobile ? [
        { constraints: { facingMode: cf, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, min: 15 } }, fps: Math.min(device.fps, 15), box: qrBox },
        { constraints: { facingMode: cf, width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 15 } }, fps: 10, box: qrBox },
        { constraints: { facingMode: cf }, fps: 8, box: { width: 200, height: 200 } },
      ] : [
        { constraints: { facingMode: cf, width: { ideal: 1280, min: 640 }, height: { ideal: 720, min: 480 }, frameRate: { ideal: 30, min: 15 } }, fps: device.fps, box: qrBox },
        { constraints: { facingMode: cf, width: { ideal: 640 }, height: { ideal: 480 } }, fps: Math.min(device.fps, 20), box: qrBox },
        { constraints: { facingMode: cf }, fps: 10, box: { width: 200, height: 200 } },
      ];
      let scanner: Html5Qrcode | null = null;
      for (const att of attempts) {
        try {
          const s = new Html5Qrcode(QR_REGION_ID, { verbose: false });
          await s.start({ facingMode: cf }, { fps: att.fps, qrbox: att.box, aspectRatio: window.innerHeight > window.innerWidth ? 4 / 3 : 16 / 9, disableFlip: true, videoConstraints: att.constraints }, onDecoded, () => {});
          scanner = s; break;
        } catch { const r2 = document.getElementById(QR_REGION_ID); if (r2) r2.innerHTML = ''; await new Promise(r => setTimeout(r, 350)); }
      }
      if (!scanner || !mountedRef.current) { if (scanner) try { await scanner.stop(); } catch {} throw new Error('all failed'); }
      scannerRef.current = scanner;
      await new Promise(r => setTimeout(r, 500));
      const vid = document.querySelector(`#${QR_REGION_ID} video`) as HTMLVideoElement | null;
      if (vid?.srcObject) {
        const track = (vid.srcObject as MediaStream).getVideoTracks()[0];
        if (track) {
          trackRef.current = track;
          const caps = (track.getCapabilities?.() || {}) as any;
          for (const [cap, val] of [['focusMode', 'continuous'], ['exposureMode', 'continuous'], ['whiteBalanceMode', 'continuous']] as const)
            if (caps[cap]?.includes?.(val)) try { await track.applyConstraints({ advanced: [{ [cap]: val } as any] }); } catch {}
          if (caps.zoom && caps.zoom.max > caps.zoom.min) { setMinZoom(caps.zoom.min); setMaxZoom(caps.zoom.max); setCanZoom(true); try { await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min } as any] }); setZoom(caps.zoom.min); } catch {} }
          else { setCanZoom(false); setMinZoom(1); setMaxZoom(1); }
          setHasTorch(!!caps.torch);
        }
      }
      if (mountedRef.current) { setCameraReady(true); setCameraStatus('ready'); }
    } catch (err: any) {
      if (!mountedRef.current) return;
      setCameraStatus('error');
      const msg = err?.message || '';
      if (msg.includes('NotAllowed') || msg.includes('Permission')) setErrorMsg('يرجى السماح باستخدام الكاميرا');
      else if (msg.includes('NotFound')) setErrorMsg('لا توجد كاميرا');
      else setErrorMsg(`فشل: ${msg.slice(0, 60)}`);
      setTimeout(() => { if (mountedRef.current) startCamera(cf); }, 4000);
    } finally { startingRef.current = false; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.fps, hardStop]);

  const onDecoded = useCallback(async (text: string) => {
    if (processingRef.current) return;
    const qrId = extractQrCodeId(text); if (!qrId) return;
    processingRef.current = true;
    try {
      const student = studentMap.get(qrId);
      if (student) {
        const now = Date.now();
        if (now - (lastScansRef.current[qrId] || 0) < DUPLICATE_BLOCK_MS) return;
        lastScansRef.current[qrId] = now;
        if (alreadyPresentIds.has(student.id)) { showToast({ type: 'warning', title: '⚠️ مسجل', text: student.name }, 1500); return; }
        await onMarkAttendance(student);
        setScanCount(c => c + 1);
        setRecentStudents(prev => [student, ...prev.filter(s => s.id !== student.id)].slice(0, 8));
        playSuccess();
        showToast({ type: 'success', title: `✅ ${student.name}`, text: student.group ? `${student.group}` : 'تم' });
      } else {
        const now = Date.now();
        if (now - (lastScansRef.current[qrId] || 0) < DUPLICATE_BLOCK_MS) return;
        lastScansRef.current[qrId] = now;
        setPendingQrId(qrId); setQrLinkCode(''); setQrLinkMessage('');
        playError();
        setTimeout(() => qrCodeInputRef.current?.focus(), 200);
      }
    } finally { setTimeout(() => { processingRef.current = false; }, 400); }
  }, [studentMap, alreadyPresentIds, onMarkAttendance, showToast]);

  const applyZoom = useCallback(async (val: number) => { if (!trackRef.current || !canZoom) return; const c = Math.max(minZoom, Math.min(maxZoom, val)); try { await trackRef.current.applyConstraints({ advanced: [{ zoom: c } as any] }); setZoom(c); } catch {} }, [canZoom, minZoom, maxZoom]);
  const toggleTorch = useCallback(async () => { if (!trackRef.current || !hasTorch) return; const n = !torchOn; try { await trackRef.current.applyConstraints({ advanced: [{ torch: n } as any] }); setTorchOn(n); } catch {} }, [hasTorch, torchOn]);
  const toggleCamera = useCallback(async () => { if (startingRef.current) return; const nf: CameraFacing = facing === 'environment' ? 'user' : 'environment'; setFacing(nf); await startCamera(nf); }, [facing, startCamera]);

  useEffect(() => {
    if (mode !== 'bulk' || faceModelsReady) return;
    let cancelled = false;
    const load = async (a = 0): Promise<void> => {
      if (cancelled || !mountedRef.current) return;
      setFaceLoading(true);
      try { await loadFaceModels(); if (!cancelled && mountedRef.current) { setFaceModelsReady(true); setFaceLoading(false); } }
      catch { if (cancelled || !mountedRef.current) return; setFaceLoading(false); if (a < 5) { resetModels(); await new Promise(r => setTimeout(r, 1500 * (a + 1))); return load(a + 1); } showToast({ type: 'error', title: '❌ فشل التحميل' }, 5000); }
    };
    load();
    return () => { cancelled = true; };
  }, [mode, faceModelsReady, showToast]);

  useEffect(() => {
    if (mode !== 'bulk' || !cameraReady) { if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; } return; }
    const canvas = overlayCanvasRef.current;
    const video = document.querySelector(`#${QR_REGION_ID} video`) as HTMLVideoElement | null;
    if (!canvas || !video) return;
    const isFront = facing === 'user';
    const draw = () => {
      if (!mountedRef.current) return;
      if (!canvas || !video || video.readyState < 2) { animFrameRef.current = requestAnimationFrame(draw); return; }
      const rect = video.getBoundingClientRect();
      if (Math.abs(canvas.width - rect.width) > 1 || Math.abs(canvas.height - rect.height) > 1) { canvas.width = rect.width; canvas.height = rect.height; }
      const ctx = canvas.getContext('2d'); if (!ctx) { animFrameRef.current = requestAnimationFrame(draw); return; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const now = Date.now(), vw = video.videoWidth || 1280, vh = video.videoHeight || 720, sx = canvas.width / vw, sy = canvas.height / vh;
      let visible = 0;
      detectedFacesRef.current.forEach((face, key) => {
        const age = now - face.timestamp; if (age > BOX_FADE_MS) { detectedFacesRef.current.delete(key); return; }
        visible++;
        const opacity = age < 200 ? age / 200 : Math.max(0.35, 1 - (age - 200) / BOX_FADE_MS);
        let stroke = '#ef4444', bg = 'rgba(239,68,68,0.85)', label = '❓';
        if (face.status === 'recognized') { stroke = '#10b981'; bg = 'rgba(16,185,129,0.92)'; label = face.student?.name || ''; }
        else if (face.status === 'already') { stroke = '#f59e0b'; bg = 'rgba(245,158,11,0.92)'; label = `✓ ${face.student?.name || ''}`; }
        let dx = face.box.x * sx; const dy = face.box.y * sy, dw = face.box.width * sx, dh = face.box.height * sy;
        if (isFront) dx = canvas.width - dx - dw;
        ctx.globalAlpha = opacity;
        ctx.strokeStyle = stroke; ctx.lineWidth = 2.5; ctx.strokeRect(dx, dy, dw, dh);
        const cl = Math.max(12, Math.min(24, dw * 0.2));
        ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.strokeStyle = stroke;
        ctx.beginPath();
        ctx.moveTo(dx, dy + cl); ctx.lineTo(dx, dy); ctx.lineTo(dx + cl, dy);
        ctx.moveTo(dx + dw - cl, dy); ctx.lineTo(dx + dw, dy); ctx.lineTo(dx + dw, dy + cl);
        ctx.moveTo(dx + dw, dy + dh - cl); ctx.lineTo(dx + dw, dy + dh); ctx.lineTo(dx + dw - cl, dy + dh);
        ctx.moveTo(dx + cl, dy + dh); ctx.lineTo(dx, dy + dh); ctx.lineTo(dx, dy + dh - cl);
        ctx.stroke();
        if (label && face.status !== 'unknown') {
          const fs = Math.max(11, Math.min(17, dw / 7));
          ctx.font = `bold ${fs}px Arial`; const tw = ctx.measureText(label).width, pad = 7, bw = tw + pad * 2, bh = fs + pad;
          const bx = dx + (dw - bw) / 2, by = dy - bh - 6;
          ctx.fillStyle = bg; drawRoundedRect(ctx, bx, by, bw, bh, 6); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, bx + bw / 2, by + bh / 2);
          if (face.confidence > 0 && face.status === 'recognized') {
            const cf = Math.max(9, fs - 3); ctx.font = `bold ${cf}px Arial`;
            const ct = `${face.confidence}%`, cw = ctx.measureText(ct).width + 10, ch = cf + 5;
            const cx2 = dx + (dw - cw) / 2, cy2 = dy + dh + 4;
            ctx.fillStyle = bg; drawRoundedRect(ctx, cx2, cy2, cw, ch, 4); ctx.fill();
            ctx.fillStyle = '#fff'; ctx.fillText(ct, cx2 + cw / 2, cy2 + ch / 2);
          }
        }
        ctx.globalAlpha = 1;
      });
      setBulkDetected(visible);
      animFrameRef.current = requestAnimationFrame(draw);
    };
    animFrameRef.current = requestAnimationFrame(draw);
    return () => { if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; } };
  }, [mode, cameraReady, facing]);

  const stopFaceLoop = useCallback(() => { faceRunningRef.current = false; if (faceTimerRef.current) { clearTimeout(faceTimerRef.current); faceTimerRef.current = null; } if (trackerRef.current) { trackerRef.current.reset(); } }, []);

  /* ─── IoU helper ─── */
  const calculateIoU = useCallback((a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number => {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height);
    if (x2 < x1 || y2 < y1) return 0;
    const inter = (x2 - x1) * (y2 - y1);
    return inter / (a.width * a.height + b.width * b.height - inter);
  }, []);

  const startFaceLoop = useCallback((sens: BulkSensitivity, cf: CameraFacing, faces: Student[]) => {
    stopFaceLoop(); faceRunningRef.current = true;
    if (!trackerRef.current) trackerRef.current = new IOUTracker();
    else trackerRef.current.reset();
    let baseIntervalMs = sens === 'extreme' ? device.intervalMs * 0.6 : device.intervalMs;
    const useRegion = sens === 'far';
    const matchedTrackIds = new Map<number, Student>();
    const detectTimes: number[] = [];
    const loop = async () => {
      if (!faceRunningRef.current || !mountedRef.current) return;
      if (document.hidden) { faceTimerRef.current = setTimeout(loop, 500) as any; return; }
      const video = document.querySelector(`#${QR_REGION_ID} video`) as HTMLVideoElement | null;
      if (!video || video.readyState < 2 || video.paused || video.ended) {
        const now = Date.now();
        if (now - lastRestartRef.current > 6000 && mountedRef.current) { lastRestartRef.current = now; setCameraStatus('restarting'); setTimeout(() => { if (mountedRef.current) startCamera(cf); }, 300); }
        faceTimerRef.current = setTimeout(loop, 600) as any; return;
      }
      frameSkipRef.current = (frameSkipRef.current + 1) % (detectTimes.length > 20 ? 3 : 1);
      if (frameSkipRef.current !== 0) { faceTimerRef.current = setTimeout(loop, 100) as any; return; }
      const detectStart = performance.now();
      try {
        const useH = sens === 'extreme' ? true : device.useHybrid;
        const detections = await Promise.race([
          useH ? extractAllFaceDescriptorsHybrid(video, useRegion) : extractAllFaceDescriptors(video, useRegion),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 2800)),
        ]) as any[];
        if (!faceRunningRef.current || !mountedRef.current) return;

        const dt = performance.now() - detectStart;
        detectTimes.push(dt);
        if (detectTimes.length > 60) detectTimes.shift();
        const avgTime = detectTimes.reduce((a, b) => a + b, 0) / detectTimes.length;
        if (avgTime > 1200 && baseIntervalMs < 1000) baseIntervalMs = Math.min(baseIntervalMs + 80, 1000);
        else if (avgTime < 400 && baseIntervalMs > 300) baseIntervalMs = Math.max(baseIntervalMs - 40, 300);

        const tracked = trackerRef.current.update(detections.map(d => ({ box: d.detection.box, descriptor: d.descriptor })));

        for (const det of detections.slice(0, device.maxFaces)) {
          if (!faceRunningRef.current) break;
          const box = det.detection.box;
          const boxKey = `${Math.round(box.x / 35)}_${Math.round(box.y / 35)}_${Math.round(box.width / 35)}`;
          const now = Date.now();

          const track = tracked.find(t => calculateIoU(t.box, box) > 0.35);
          const matchedStudent = track && matchedTrackIds.get(track.id);

          if (track && matchedStudent) {
            if (alreadyPresentIds.has(matchedStudent.id) || now - (lastScansRef.current[`bulk_${matchedStudent.id}`] || 0) < BULK_FACE_BLOCK_MS) {
              detectedFacesRef.current.set(boxKey, { box: { x: box.x, y: box.y, width: box.width, height: box.height }, student: matchedStudent, status: 'already', confidence: 100, timestamp: now });
            } else {
              detectedFacesRef.current.set(boxKey, { box: { x: box.x, y: box.y, width: box.width, height: box.height }, student: matchedStudent, status: 'recognized', confidence: 100, timestamp: now });
            }
            continue;
          }

          const match = findBestMatch(det.descriptor, faces, CONFIDENCE_THRESHOLD);

          if (match) {
            const s = match.item;
            if (track) matchedTrackIds.set(track.id, s);
            if (alreadyPresentIds.has(s.id) || now - (lastScansRef.current[`bulk_${s.id}`] || 0) < BULK_FACE_BLOCK_MS) {
              detectedFacesRef.current.set(boxKey, { box: { x: box.x, y: box.y, width: box.width, height: box.height }, student: s, status: 'already', confidence: match.confidence, timestamp: now });
            } else {
              lastScansRef.current[`bulk_${s.id}`] = now;
              detectedFacesRef.current.set(boxKey, { box: { x: box.x, y: box.y, width: box.width, height: box.height }, student: s, status: 'recognized', confidence: match.confidence, timestamp: now });
              await onMarkAttendance(s);
              setScanCount(c => c + 1);
              setBulkStudents(prev => [s, ...prev.filter(x => x.id !== s.id)]);
              setRecentStudents(prev => [s, ...prev.filter(x => x.id !== s.id)].slice(0, 8));
              playFaceSuccess();
              showToast({ type: 'success', title: `✅ ${s.name}`, text: `${match.confidence}%` }, 2000);

              if (onUpdateStudent && s.faceDescriptor && shouldAutoImprove(s.faceDescriptor as any)) {
                const dir = detectFaceDirection(det.landmarks);
                const improved = autoImproveDescriptor(s.faceDescriptor as any, det.descriptor, dir, match.confidence / 100);
                if (improved) onUpdateStudent(s.id, { faceDescriptor: improved as any });
              }
            }
          } else {
            detectedFacesRef.current.set(boxKey, { box: { x: box.x, y: box.y, width: box.width, height: box.height }, student: null, status: 'unknown', confidence: 0, timestamp: now });
          }
        }
      } catch (e: any) { if (e?.message !== 'timeout') console.warn('face:', e); }
      if (faceRunningRef.current && mountedRef.current) faceTimerRef.current = setTimeout(loop, baseIntervalMs) as any;
    };
    faceTimerRef.current = setTimeout(loop, 600) as any;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device, stopFaceLoop, alreadyPresentIds, onMarkAttendance, onUpdateStudent, showToast, calculateIoU]);

  useEffect(() => {
    if (mode === 'bulk' && cameraReady && faceModelsReady && studentsWithFace.length > 0) startFaceLoop(sensitivity, facing, studentsWithFace);
    else stopFaceLoop();
    return () => stopFaceLoop();
  }, [mode, cameraReady, faceModelsReady, studentsWithFace, sensitivity, facing, startFaceLoop, stopFaceLoop]);

  useEffect(() => {
    const fn = () => { if (!document.hidden && mode === 'bulk' && cameraReady && faceModelsReady && studentsWithFace.length > 0 && !faceRunningRef.current) startFaceLoop(sensitivity, facing, studentsWithFace); };
    document.addEventListener('visibilitychange', fn); return () => document.removeEventListener('visibilitychange', fn);
  }, [mode, cameraReady, faceModelsReady, studentsWithFace, sensitivity, facing, startFaceLoop]);

  useEffect(() => { mountedRef.current = true; const t = setTimeout(() => { if (mountedRef.current) startCamera('environment'); }, 250); return () => { mountedRef.current = false; clearTimeout(t); stopFaceLoop(); hardStop(); }; }, []); // eslint-disable-line
  useEffect(() => { detectedFacesRef.current.clear(); if (mode === 'bulk' && facing !== 'environment') { setFacing('environment'); startCamera('environment'); } }, [mode]); // eslint-disable-line

const handleClose = useCallback(async () => { 
  mountedRef.current = false; 
  stopFaceLoop(); 
  await hardStop(); 
  await new Promise(r => setTimeout(r, 150)); 
  onClose(); 
}, [hardStop, stopFaceLoop, onClose]);

  const handleQrLinkByCode = useCallback(async (code: string) => {
    if (!pendingQrId || !onUpdateStudent) return;
    if (code.length !== 4) { setQrLinkMessage('❌ 4 أرقام'); return; }
    const student = students.find(s => s.code === code);
    if (!student) { setQrLinkMessage('❌ لا يوجد'); playError(); return; }
    if (student.qrCodeId) { setQrLinkMessage(`⚠️ لديه QR`); playError(); return; }
    onUpdateStudent(student.id, { qrCodeId: pendingQrId });
    const qrId = pendingQrId;
    setPendingQrId(null); setQrLinkCode(''); setQrLinkMessage('');
    lastScansRef.current[qrId] = Date.now();
    if (!alreadyPresentIds.has(student.id)) {
      await onMarkAttendance({ ...student, qrCodeId: qrId });
      setScanCount(c => c + 1); playSuccess();
      showToast({ type: 'success', title: `✅ ${student.name}`, text: 'تم الربط' });
    }
  }, [pendingQrId, onUpdateStudent, students, alreadyPresentIds, onMarkAttendance, showToast]);

  const isBulk = mode === 'bulk', isFront = facing === 'user', doMirror = isFront;
  const toastBg: Record<ToastType, string> = { success: 'from-emerald-500 to-green-600', error: 'from-red-500 to-rose-600', info: 'from-blue-500 to-cyan-600', warning: 'from-amber-500 to-orange-500' };
  const toastIcon: Record<ToastType, string> = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const ALL_DIRS: FaceDirection[] = ['center', 'right', 'left', 'up', 'down'];

  return (
    <div className="fixed inset-0 z-[9999] bg-black text-white flex flex-col" dir="rtl">

      <header className="flex items-center justify-between px-3 py-2 bg-gray-900/95 border-b border-white/10" style={{ paddingTop: 'max(0.5rem,env(safe-area-inset-top))' }}>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold flex items-center gap-1.5 truncate">{isBulk ? '🎯 جماعي' : '🔳 QR'}</h2>
          <p className="text-[10px] text-gray-400 truncate">{activeSession?.name || 'لا سجل'}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1 text-[9px] px-2 py-1 rounded-full ${cameraStatus === 'ready' ? 'bg-emerald-900/60 text-emerald-300' : 'bg-gray-800 text-gray-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cameraStatus === 'ready' ? 'bg-emerald-400 animate-pulse' : 'bg-gray-400'}`} />
            {cameraStatus === 'ready' ? 'مباشر' : 'تهيؤ'}
          </div>
          <button onClick={handleClose} className="bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold active:scale-95">✕</button>
        </div>
      </header>

      <div className="px-3 py-2 bg-gray-900/70 border-b border-white/5 flex gap-1.5">
        {(['qr', 'bulk'] as ScanMode[]).map(m => (
          <button key={m} onClick={() => setMode(m)} className={`flex-1 py-2.5 rounded-lg text-xs font-bold active:scale-95 ${mode === m ? m === 'qr' ? 'bg-emerald-600 text-white' : 'bg-gradient-to-r from-orange-600 to-red-600 text-white' : 'bg-white/8 text-gray-300'}`}>
            {m === 'qr' ? '🔳 QR' : '🎯 جماعي'}
          </button>
        ))}
      </div>

      {isBulk && faceLoading && <div className="mx-3 mt-2 p-3 bg-purple-900/50 border border-purple-500/40 rounded-lg flex items-center gap-3"><div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" /><p className="text-xs font-bold text-purple-200">تحميل النظام...</p></div>}

      {isBulk && faceModelsReady && cameraReady && (
        <div className="mx-3 mt-2 p-2 bg-gradient-to-r from-orange-900/50 to-red-900/50 border border-orange-500/30 rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-orange-200 font-bold">🎯 {studentsWithFace.length} بصمة • {bulkDetected} مكتشف</p>
            <div className="flex gap-1.5">
              <button onClick={() => setBulkSidebar(s => !s)} className="bg-white/10 px-2 py-1 rounded text-[10px] font-bold">{bulkSidebar ? '◀' : '▶'}</button>
            </div>
          </div>
          <div className="flex gap-1.5 text-[10px]">
            <button onClick={() => setSensitivity('far')} className={`flex-1 py-2 rounded-lg font-bold active:scale-95 ${sensitivity === 'far' ? 'bg-emerald-600 text-white' : 'bg-white/10 text-gray-300'}`}>🎯 متوازن</button>
            <button onClick={() => setSensitivity('extreme')} className={`flex-1 py-2 rounded-lg font-bold active:scale-95 ${sensitivity === 'extreme' ? 'bg-red-600 text-white' : 'bg-white/10 text-gray-300'}`}>🔍 بعيد</button>
            {onUpdateStudent && <button onClick={() => setShowReg(true)} className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-3 py-2 rounded-lg font-bold shrink-0">➕ بصمة</button>}
          </div>
        </div>
      )}

      {errorMsg && <div className="mx-3 mt-2 p-3 bg-red-900/60 border border-red-500/40 rounded-xl text-center"><p className="text-red-200 text-xs mb-2">{errorMsg}</p><button onClick={() => startCamera(facing)} className="bg-red-600 px-4 py-2 rounded-lg text-xs font-bold">🔄</button></div>}

      <div className={`flex-1 overflow-hidden flex ${isBulk && bulkSidebar ? 'flex-col lg:flex-row' : 'flex-col'}`}>
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className={`w-full mx-auto rounded-xl overflow-hidden border bg-gray-900 relative ${isBulk ? 'max-w-3xl border-orange-500/30' : 'max-w-lg border-emerald-500/20'}`}>
            <div id={QR_REGION_ID} className={`w-full ${doMirror ? 'mirror-video' : ''}`} style={{ minHeight: isBulk ? '380px' : '260px' }} />
            {isBulk && cameraReady && <canvas ref={overlayCanvasRef} className="absolute inset-0 pointer-events-none" style={{ width: '100%', height: '100%' }} />}
            {cameraReady && !isBulk && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="relative" style={{ width: getQrBox().width, height: getQrBox().height }}>
                  {['top-0 right-0 border-t-2 border-r-2 rounded-tr-lg', 'top-0 left-0 border-t-2 border-l-2 rounded-tl-lg', 'bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg', 'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg'].map((c, i) => <div key={i} className={`absolute w-8 h-8 border-emerald-400 ${c}`} />)}
                  <div className="absolute inset-x-2 h-px bg-emerald-400/80 animate-scan-line" />
                </div>
              </div>
            )}
            {cameraReady && (
              <div className="absolute top-2 left-2 flex gap-1.5 z-10">
                <button onClick={toggleCamera} className="bg-black/70 text-white p-2.5 rounded-full active:scale-90 text-base shadow-lg border border-white/10" title="تبديل الكاميرا">🔄</button>
              </div>
            )}
            {isBulk && cameraReady && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-gradient-to-r from-orange-600 to-red-600 px-4 py-2 rounded-full shadow-xl z-10">
                <div className="flex items-center gap-2 text-white"><span className="text-xl">📊</span><div className="text-center"><div className="text-xl font-bold leading-none">{bulkStudents.length}</div><div className="text-[9px] opacity-90">مسجّل</div></div></div>
              </div>
            )}
          </div>

          {cameraReady && canZoom && (
            <div className="w-full max-w-lg mx-auto flex items-center justify-center gap-2 bg-white/5 rounded-xl px-3 py-2">
              <button onClick={() => applyZoom(zoom - 0.3)} disabled={zoom <= minZoom + 0.1} className="w-10 h-10 flex items-center justify-center bg-white/15 disabled:opacity-20 text-white font-bold rounded-full active:scale-90 text-lg">−</button>
              <div className="text-center min-w-[60px]">
                <div className="text-sm font-bold text-white">{zoom.toFixed(1)}x</div>
                <div className="w-full h-1 bg-white/20 rounded-full mt-0.5 overflow-hidden">
                  <div className="h-full bg-emerald-400 transition-all" style={{ width: `${((zoom - minZoom) / (maxZoom - minZoom)) * 100}%` }} />
                </div>
              </div>
              <button onClick={() => applyZoom(zoom + 0.3)} disabled={zoom >= maxZoom - 0.1} className="w-10 h-10 flex items-center justify-center bg-white/15 disabled:opacity-20 text-white font-bold rounded-full active:scale-90 text-lg">+</button>
              {hasTorch && <button onClick={toggleTorch} className={`w-10 h-10 flex items-center justify-center rounded-full active:scale-90 text-lg ${torchOn ? 'bg-yellow-500 text-black' : 'bg-white/15 text-white'}`}>{torchOn ? '💡' : '🔦'}</button>}
            </div>
          )}

          {!isBulk && (
            <div className="grid grid-cols-2 gap-2 w-full max-w-lg mx-auto">
              <div className="bg-white/5 rounded-lg p-2.5 text-center"><div className="text-2xl font-bold text-emerald-400">{scanCount}</div><div className="text-[10px] text-gray-400">مسجّل</div></div>
              <div className="bg-white/5 rounded-lg p-2.5 text-center"><div className="text-lg font-bold">{cameraStatus === 'ready' ? '🟢' : '🔴'}</div><div className="text-[10px] text-gray-400">{cameraStatus === 'ready' ? 'تعمل' : 'خطأ'}</div></div>
            </div>
          )}

          {!isBulk && recentStudents.length > 0 && (
            <div className="w-full max-w-lg mx-auto bg-white/5 rounded-lg p-2.5">
              <p className="text-[11px] font-bold mb-1.5 text-emerald-300">آخر المسجلين:</p>
              <div className="space-y-1">{recentStudents.map(s => <div key={s.id} className="flex justify-between items-center bg-black/30 rounded px-2.5 py-1.5"><span className="text-xs font-medium truncate">{s.name}</span><span className="text-[10px] bg-emerald-700/80 px-1.5 py-0.5 rounded-full">{s.group || '-'}</span></div>)}</div>
            </div>
          )}
        </div>

        {isBulk && bulkSidebar && (
          <div className="lg:w-80 bg-gray-900/98 border-t lg:border-t-0 lg:border-r border-white/10 flex flex-col max-h-[45vh] lg:max-h-none">
            <div className="p-3 border-b border-white/10"><h3 className="text-sm font-bold text-orange-200">📋 السجل <span className="bg-orange-600 text-white text-xs px-2 py-0.5 rounded-full ml-2">{bulkStudents.length}</span></h3></div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {bulkStudents.map((s, i) => <div key={s.id} className="flex items-center gap-2 bg-emerald-900/25 border border-emerald-600/25 rounded-lg px-2.5 py-2"><div className="bg-emerald-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold">{i + 1}</div><div className="flex-1 min-w-0"><div className="text-xs font-bold truncate">{s.name}</div><div className="text-[9px] text-emerald-400/70">{s.code}</div></div><span className="text-emerald-400">✓</span></div>)}
            </div>
          </div>
        )}
      </div>

      <div className="fixed top-0 left-1/2 -translate-x-1/2 z-[10001] flex flex-col gap-2 w-[92%] max-w-md pointer-events-none" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        {toasts.map(t => (
          <div key={t.id} className={`bg-gradient-to-r ${toastBg[t.type]} rounded-xl px-4 py-3 shadow-2xl animate-toast-slide-down`}>
            <div className="flex items-center gap-3"><span className="text-2xl">{toastIcon[t.type]}</span><div className="min-w-0 flex-1"><p className="font-bold text-sm truncate">{t.title}</p>{t.text && <p className="text-xs opacity-90 truncate">{t.text}</p>}</div></div>
          </div>
        ))}
      </div>

      {pendingQrId && (
        <div className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center p-4">
          <div className="bg-white text-gray-900 rounded-2xl p-5 w-full max-w-sm">
            <div className="text-center mb-4"><div className="text-4xl mb-2">🔗</div><h3 className="text-lg font-bold">ربط هوية</h3></div>
            <input ref={qrCodeInputRef} type="text" value={qrLinkCode} onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); setQrLinkCode(v); setQrLinkMessage(''); if (v.length === 4) setTimeout(() => handleQrLinkByCode(v), 150); }} placeholder="0000" className="w-full text-center text-3xl font-bold tracking-[1em] py-3 border-2 border-emerald-300 rounded-xl focus:border-emerald-500 outline-none" maxLength={4} inputMode="numeric" autoFocus />
            {qrLinkMessage && <div className="mt-3 p-2 rounded text-center text-xs font-medium bg-red-50 text-red-700 border border-red-200">{qrLinkMessage}</div>}
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button onClick={() => { setPendingQrId(null); setQrLinkCode(''); }} className="py-3 bg-gray-200 text-gray-700 font-bold rounded-lg active:scale-95">إلغاء</button>
              <button onClick={() => handleQrLinkByCode(qrLinkCode)} disabled={qrLinkCode.length !== 4} className="py-3 bg-emerald-600 disabled:opacity-40 text-white font-bold rounded-lg active:scale-95">🔗 ربط</button>
            </div>
          </div>
        </div>
      )}

      {showReg && (
        <FaceRegistration
          students={students}
          onUpdateStudent={(id, updates) => {
            onUpdateStudent?.(id, updates);
            setShowReg(false);
          }}
          onClose={() => setShowReg(false)}
        />
      )}

      <style>{`
        @keyframes toastSlideDown{0%{opacity:0;transform:translateY(-100%) scale(.92)}60%{opacity:1;transform:translateY(6px) scale(1.02)}100%{opacity:1;transform:translateY(0) scale(1)}}
        .animate-toast-slide-down{animation:toastSlideDown .42s cubic-bezier(.22,1,.36,1) both}
        @keyframes scanLine{0%,100%{top:8%;opacity:.5}50%{top:88%;opacity:1}}
        .animate-scan-line{animation:scanLine 1.8s ease-in-out infinite;position:absolute}
        .mirror-video video{transform:scaleX(-1)!important}
        #${QR_REGION_ID}{border-radius:.75rem;overflow:hidden;background:#111}
        #${QR_REGION_ID} video{width:100%!important;height:auto!important;min-height:260px!important;object-fit:cover!important;display:block!important}
        #${QR_REGION_ID} img[alt="Info icon"],#${QR_REGION_ID} button,#${QR_REGION_ID}>div:last-child:not(:first-child){display:none!important}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:99px}
      `}</style>
    </div>
  );
};

export default QRAttendance;