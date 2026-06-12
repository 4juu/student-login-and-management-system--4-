import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import { Student, AttendanceSession } from '../types/student';

interface QRAttendanceProps {
  students: Student[];
  activeSession: AttendanceSession | null;
  onMarkAttendance: (student: Student) => Promise<void> | void;
  onUpdateStudent?: (id: string, updates: Partial<Student>) => void;
  alreadyPresentIds: Set<string>;
  onClose: () => void;
}

type ToastType = 'success' | 'error' | 'info' | 'warning';
type CameraFacing = 'environment' | 'user';

interface ToastMessage {
  id: number;
  type: ToastType;
  title: string;
  text?: string;
  visible: boolean;
}

const QR_REGION_ID = 'qr-reader-v3';
const DUPLICATE_BLOCK_MS = 30_000;

const extractQrCodeId = (t: string): string | null => {
  const r = t.trim();
  try {
    const u = new URL(r);
    const id = u.searchParams.get('id');
    if (id) return id.trim();
  } catch {}
  try {
    const o = JSON.parse(r);
    const v = o.qrCodeId || o.qrId || o.id || o.studentId || o.universityId || o.code;
    if (v) return String(v).trim();
  } catch {}
  if (/^[A-Za-z0-9_-]{3,100}$/.test(r)) return r;
  return null;
};

const getQrBox = () => {
  const m = Math.min(window.innerWidth, window.innerHeight);
  const s = Math.max(180, Math.min(300, Math.floor(m * 0.6)));
  return { width: s, height: s };
};

const beep = (f: number, d: number, v = 0.05) => {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.value = v;
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + d / 1000);
    setTimeout(() => ctx.close(), d + 100);
  } catch {}
};

const playSuccess = () => {
  navigator.vibrate?.([50, 30, 50]);
  beep(880, 100, 0.15);
};

const playError = () => {
  navigator.vibrate?.([150]);
  beep(200, 200, 0.1);
};

export const QRAttendance: React.FC<QRAttendanceProps> = ({
  students, onMarkAttendance, onUpdateStudent, alreadyPresentIds, onClose,
}) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const processingRef = useRef(false);
  const lastScansRef = useRef<Record<string, number>>({});
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const toastCounterRef = useRef(0);
  const toastSequenceRef = useRef<Map<number, number>>(new Map());
  const qrCodeInputRef = useRef<HTMLInputElement | null>(null);

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
  const [cameraStatus, setCameraStatus] = useState<'starting' | 'ready' | 'error' | 'restarting'>('starting');
  const [facing, setFacing] = useState<CameraFacing>('environment');

  const studentMap = useMemo(() => {
    const m = new Map<string, Student>();
    students.forEach(s => {
      if (s.qrCodeId) m.set(s.qrCodeId.trim(), s);
      if (s.universityId) m.set(s.universityId.trim(), s);
    });
    return m;
  }, [students]);

  const showToast = useCallback((msg: Omit<ToastMessage, 'id' | 'visible'>, _ms = 2500) => {
    const id = ++toastCounterRef.current;
    const seqId = id;
    toastSequenceRef.current.set(id, seqId);
    setToasts(prev => [{ ...msg, id, visible: false }, ...prev].slice(0, 4));

    const runSequence = async () => {
      const show = () => setToasts(prev => prev.map(t => (t.id === id ? { ...t, visible: true } : t)));
      const hide = () => setToasts(prev => prev.map(t => (t.id === id ? { ...t, visible: false } : t)));
      const remove = () => setToasts(prev => prev.filter(t => t.id !== id));
      const isActive = () => mountedRef.current && toastSequenceRef.current.get(id) === seqId;

      for (let i = 0; i < 3; i++) {
        if (!isActive()) return;
        show();
        await sleep(500);
        if (!isActive()) return;
        hide();
        if (i < 2) await sleep(200);
      }
      await sleep(4000);
      if (!isActive()) return;
      for (let i = 0; i < 2; i++) {
        if (!isActive()) return;
        show();
        await sleep(500);
        if (!isActive()) return;
        hide();
        if (i < 1) await sleep(200);
      }
      await sleep(2000);
      if (!isActive()) return;
      for (let i = 0; i < 2; i++) {
        if (!isActive()) return;
        show();
        await sleep(500);
        if (!isActive()) return;
        hide();
        if (i < 1) await sleep(200);
      }
      if (isActive()) { remove(); toastSequenceRef.current.delete(id); }
    };
    runSequence();
  }, []);

  const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

  const hardStop = useCallback(async () => {
    if (trackRef.current && torchOn) {
      try { await trackRef.current.applyConstraints({ advanced: [{ torch: false } as any] }); } catch {}
    }
    if (scannerRef.current) {
      try {
        const st = scannerRef.current.getState();
        if (st === Html5QrcodeScannerState.SCANNING || st === Html5QrcodeScannerState.PAUSED) {
          await scannerRef.current.stop();
        }
      } catch {}
      try { await scannerRef.current.clear(); } catch {}
      scannerRef.current = null;
    }
    if (trackRef.current) {
      try { trackRef.current.stop(); } catch {}
      trackRef.current = null;
    }
    const vid = document.querySelector(`#${QR_REGION_ID} video`) as HTMLVideoElement | null;
    if (vid?.srcObject) {
      try { (vid.srcObject as MediaStream).getTracks().forEach(t => t.stop()); vid.srcObject = null; } catch {}
    }
    const reg = document.getElementById(QR_REGION_ID);
    if (reg) reg.innerHTML = '';
  }, [torchOn]);

  const startCamera = useCallback(async (cf: CameraFacing) => {
    if (!mountedRef.current || startingRef.current) return;
    startingRef.current = true;
    setCameraStatus('starting');
    setCameraReady(false);

    try {
      await hardStop();
      await new Promise(r => setTimeout(r, 400));
      if (!mountedRef.current) return;

      const region = document.getElementById(QR_REGION_ID);
      if (region) region.innerHTML = '';

      const qrBox = getQrBox();

      const attempts = [
        {
          constraints: { facingMode: cf, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 20, min: 12 } },
          fps: 20, box: qrBox,
        },
        {
          constraints: { facingMode: cf, width: { ideal: 480 }, height: { ideal: 360 } },
          fps: 15, box: qrBox,
        },
        {
          constraints: { facingMode: cf },
          fps: 8, box: { width: 200, height: 200 },
        },
      ];

      let scanner: Html5Qrcode | null = null;

      for (const att of attempts) {
        try {
          const s = new Html5Qrcode(QR_REGION_ID, { verbose: false });
          await s.start(
            { facingMode: cf },
            {
              fps: att.fps,
              qrbox: att.box,
              aspectRatio: window.innerHeight > window.innerWidth ? 4 / 3 : 16 / 9,
              disableFlip: true,
              videoConstraints: att.constraints,
            },
            onDecoded,
            () => {}
          );
          scanner = s;
          break;
        } catch {
          const r2 = document.getElementById(QR_REGION_ID);
          if (r2) r2.innerHTML = '';
          await new Promise(r => setTimeout(r, 350));
        }
      }

      if (!scanner || !mountedRef.current) {
        if (scanner) { try { await scanner.stop(); } catch {} }
        throw new Error('all failed');
      }

      scannerRef.current = scanner;
      await new Promise(r => setTimeout(r, 500));

      const vid = document.querySelector(`#${QR_REGION_ID} video`) as HTMLVideoElement | null;
      if (vid?.srcObject) {
        const track = (vid.srcObject as MediaStream).getVideoTracks()[0];
        if (track) {
          trackRef.current = track;
          const caps = (track.getCapabilities?.() || {}) as any;

          for (const [cap, val] of [['focusMode', 'continuous'], ['exposureMode', 'continuous'], ['whiteBalanceMode', 'continuous']] as const) {
            if (caps[cap]?.includes?.(val)) {
              try { await track.applyConstraints({ advanced: [{ [cap]: val } as any] }); } catch {}
            }
          }

          if (caps.zoom && caps.zoom.max > caps.zoom.min) {
            setMinZoom(caps.zoom.min);
            setMaxZoom(caps.zoom.max);
            setCanZoom(true);
            try { await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min } as any] }); setZoom(caps.zoom.min); } catch {}
          } else { setCanZoom(false); setMinZoom(1); setMaxZoom(1); }

          setHasTorch(!!caps.torch);
        }
      }

      if (mountedRef.current) { setCameraReady(true); setCameraStatus('ready'); }
    } catch (err: any) {
      if (!mountedRef.current) return;
      setCameraStatus('error');
      setTimeout(() => { if (mountedRef.current) startCamera(cf); }, 4000);
    } finally {
      startingRef.current = false;
    }
  }, [hardStop]);

  const onDecoded = useCallback(async (text: string) => {
    if (processingRef.current) return;
    const qrId = extractQrCodeId(text);
    if (!qrId) return;
    processingRef.current = true;
    try {
      const student = studentMap.get(qrId);
      if (student) {
        const now = Date.now();
        if (now - (lastScansRef.current[qrId] || 0) < DUPLICATE_BLOCK_MS) return;
        lastScansRef.current[qrId] = now;
        if (alreadyPresentIds.has(student.id)) {
          showToast({ type: 'warning', title: '⚠️ مسجل', text: student.name }, 1500);
          return;
        }
        await onMarkAttendance(student);
        setScanCount(c => c + 1);
        setRecentStudents(prev => [student, ...prev.filter(s => s.id !== student.id)].slice(0, 8));
        playSuccess();
        showToast({ type: 'success', title: `✅ ${student.name}`, text: student.group ? `${student.group}` : 'تم' });
      } else {
        const now = Date.now();
        if (now - (lastScansRef.current[qrId] || 0) < DUPLICATE_BLOCK_MS) return;
        lastScansRef.current[qrId] = now;
        setPendingQrId(qrId);
        setQrLinkCode('');
        setQrLinkMessage('');
        playError();
        setTimeout(() => qrCodeInputRef.current?.focus(), 200);
      }
    } finally {
      setTimeout(() => { processingRef.current = false; }, 400);
    }
  }, [studentMap, alreadyPresentIds, onMarkAttendance, showToast]);

  const applyZoom = useCallback(async (val: number) => {
    if (!trackRef.current || !canZoom) return;
    const c = Math.max(minZoom, Math.min(maxZoom, val));
    try { await trackRef.current.applyConstraints({ advanced: [{ zoom: c } as any] }); setZoom(c); } catch {}
  }, [canZoom, minZoom, maxZoom]);

  const toggleTorch = useCallback(async () => {
    if (!trackRef.current || !hasTorch) return;
    const n = !torchOn;
    try { await trackRef.current.applyConstraints({ advanced: [{ torch: n } as any] }); setTorchOn(n); } catch {}
  }, [hasTorch, torchOn]);

  const toggleCamera = useCallback(async () => {
    if (startingRef.current) return;
    const nf: CameraFacing = facing === 'environment' ? 'user' : 'environment';
    setFacing(nf);
    await startCamera(nf);
  }, [facing, startCamera]);

  useEffect(() => {
    mountedRef.current = true;
    const t = setTimeout(() => { if (mountedRef.current) startCamera('environment'); }, 250);
    return () => {
      mountedRef.current = false;
      clearTimeout(t);
      (async () => { await hardStop(); })();
    };
  }, []);

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
      setScanCount(c => c + 1);
      playSuccess();
      showToast({ type: 'success', title: `✅ ${student.name}`, text: 'تم الربط' });
    }
  }, [pendingQrId, onUpdateStudent, students, alreadyPresentIds, onMarkAttendance, showToast]);

  const toastBg: Record<ToastType, string> = {
    success: 'from-emerald-500 to-green-600',
    error: 'from-red-500 to-rose-600',
    info: 'from-blue-500 to-cyan-600',
    warning: 'from-amber-500 to-orange-500',
  };
  const toastIcon: Record<ToastType, string> = {
    success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️',
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 text-white flex items-center justify-center p-2 sm:p-4" dir="rtl">
      <div className="w-full max-w-2xl max-h-[98vh] bg-black rounded-2xl flex flex-col overflow-hidden shadow-2xl">
      <header className="flex items-center justify-between px-3 py-2 bg-gray-900/95 border-b border-white/10"
        style={{ paddingTop: 'max(0.5rem,env(safe-area-inset-top))' }}>
        <h2 className="text-sm font-bold flex items-center gap-1.5">🔳 QR</h2>
        <button onClick={onClose}
          className="bg-white/10 hover:bg-white/20 text-white px-4 py-1.5 rounded-lg text-sm font-bold transition active:scale-95">
          ✕ إغلاق
        </button>
      </header>

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="w-full mx-auto rounded-xl overflow-hidden border bg-gray-900 relative max-w-lg border-emerald-500/20">
            <div id={QR_REGION_ID} className="w-full" style={{ minHeight: '260px' }} />

            {cameraReady && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div style={{ width: getQrBox().width, height: getQrBox().height }} className="relative">
                  {['top-0 right-0 border-t-2 border-r-2 rounded-tr-lg',
                    'top-0 left-0 border-t-2 border-l-2 rounded-tl-lg',
                    'bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg',
                    'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg',
                  ].map((c, i) => (
                    <div key={i} className={`absolute w-8 h-8 border-emerald-400 ${c}`} />
                  ))}
                  <div className="absolute inset-x-2 h-px bg-emerald-400/80 animate-scan-line" />
                </div>
              </div>
            )}

            {cameraReady && (
              <div className="absolute top-2 left-2 flex gap-1.5 z-10">
                <button onClick={toggleCamera}
                  className="bg-black/70 text-white p-2.5 rounded-full active:scale-90 text-base shadow-lg border border-white/10"
                  title="تبديل الكاميرا">
                  🔄
                </button>
              </div>
            )}
          </div>

          {cameraReady && canZoom && (
            <div className="w-full max-w-lg mx-auto flex items-center justify-center gap-2 bg-white/5 rounded-xl px-3 py-2">
              <button onClick={() => applyZoom(zoom - 0.3)}
                disabled={zoom <= minZoom + 0.1}
                className="w-10 h-10 flex items-center justify-center bg-white/15 disabled:opacity-20 text-white font-bold rounded-full active:scale-90 text-lg">−</button>
              <div className="text-center min-w-[60px]">
                <div className="text-sm font-bold text-white">{zoom.toFixed(1)}x</div>
                <div className="w-full h-1 bg-white/20 rounded-full mt-0.5 overflow-hidden">
                  <div className="h-full bg-emerald-400 transition-all" style={{ width: `${((zoom - minZoom) / (maxZoom - minZoom)) * 100}%` }} />
                </div>
              </div>
              <button onClick={() => applyZoom(zoom + 0.3)}
                disabled={zoom >= maxZoom - 0.1}
                className="w-10 h-10 flex items-center justify-center bg-white/15 disabled:opacity-20 text-white font-bold rounded-full active:scale-90 text-lg">+</button>
              {hasTorch && (
                <button onClick={toggleTorch}
                  className={`w-10 h-10 flex items-center justify-center rounded-full active:scale-90 text-lg ${torchOn ? 'bg-yellow-500 text-black' : 'bg-white/15 text-white'}`}>
                  {torchOn ? '💡' : '🔦'}
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 w-full max-w-lg mx-auto">
            <div className="bg-white/5 rounded-lg p-2.5 text-center">
              <div className="text-2xl font-bold text-emerald-400">{scanCount}</div>
              <div className="text-[10px] text-gray-400">مسجّل</div>
            </div>
            <div className="bg-white/5 rounded-lg p-2.5 text-center">
              <div className="text-lg font-bold">{cameraStatus === 'ready' ? '🟢' : '🔴'}</div>
              <div className="text-[10px] text-gray-400">{cameraStatus === 'ready' ? 'تعمل' : 'خطأ'}</div>
            </div>
          </div>

          {recentStudents.length > 0 && (
            <div className="w-full max-w-lg mx-auto bg-white/5 rounded-lg p-2.5">
              <p className="text-[11px] font-bold mb-1.5 text-emerald-300">آخر المسجلين:</p>
              <div className="space-y-1">
                {recentStudents.map(s => (
                  <div key={s.id} className="flex justify-between items-center bg-black/30 rounded px-2.5 py-1.5">
                    <span className="text-xs font-medium truncate">{s.name}</span>
                    <span className="text-[10px] bg-emerald-700/80 px-1.5 py-0.5 rounded-full">{s.group || '-'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="fixed top-0 left-1/2 -translate-x-1/2 z-[10001] flex flex-col gap-2 w-[92%] max-w-md pointer-events-none"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        {toasts.map(t => (
          <div key={t.id}
            className={`bg-gradient-to-r ${toastBg[t.type]} rounded-xl px-4 py-3 shadow-2xl transition-all duration-200 ${t.visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-2 pointer-events-none'}`}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{toastIcon[t.type]}</span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-sm truncate">{t.title}</p>
                {t.text && <p className="text-xs opacity-90 truncate">{t.text}</p>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {pendingQrId && (
        <div className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center p-4">
          <div className="bg-white text-gray-900 rounded-2xl p-5 w-full max-w-sm">
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">🔗</div>
              <h3 className="text-lg font-bold">ربط هوية</h3>
            </div>
            <input ref={qrCodeInputRef}
              type="text" value={qrLinkCode}
              onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); setQrLinkCode(v); setQrLinkMessage(''); if (v.length === 4) setTimeout(() => handleQrLinkByCode(v), 150); }}
              placeholder="0000"
              className="w-full text-center text-3xl font-bold tracking-[1em] py-3 border-2 border-emerald-300 rounded-xl focus:border-emerald-500 outline-none"
              maxLength={4} inputMode="numeric" autoFocus />
            {qrLinkMessage && (
              <div className="mt-3 p-2 rounded text-center text-xs font-medium bg-red-50 text-red-700 border border-red-200">{qrLinkMessage}</div>
            )}
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button onClick={() => { setPendingQrId(null); setQrLinkCode(''); }}
                className="py-3 bg-gray-200 text-gray-700 font-bold rounded-lg active:scale-95">إلغاء</button>
              <button onClick={() => handleQrLinkByCode(qrLinkCode)} disabled={qrLinkCode.length !== 4}
                className="py-3 bg-emerald-600 disabled:opacity-40 text-white font-bold rounded-lg active:scale-95">🔗 ربط</button>
            </div>
          </div>
        </div>
      )}

      </div>
      <style>{`
        @keyframes scanLine{0%,100%{top:8%;opacity:.5}50%{top:88%;opacity:1}}
        .animate-scan-line{animation:scanLine 1.8s ease-in-out infinite;position:absolute}
        #${QR_REGION_ID}{border-radius:.75rem;overflow:hidden;background:#111}
        #${QR_REGION_ID} video{width:100%!important;height:auto!important;min-height:260px!important;object-fit:cover!important;display:block!important}
        #${QR_REGION_ID} img[alt="Info icon"],#${QR_REGION_ID} button,#${QR_REGION_ID}>div:last-child:not(:first-child){display:none!important}
      `}</style>
    </div>
  );
};

export default QRAttendance;
