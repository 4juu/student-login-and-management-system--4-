import React, { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

type DeviceKind = 'ios' | 'android' | 'mac' | 'other';

const getDevice = (): DeviceKind => {
  const ua = window.navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  if (/macintosh|mac os x/.test(ua)) return 'mac';
  return 'other';
};

const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (window.navigator as unknown as { standalone?: boolean }).standalone === true;

const GUIDES: Record<DeviceKind, { title: string; steps: string[] }> = {
  ios: {
    title: 'تثبيت التطبيق على آيفون / آيباد',
    steps: [
      'اضغط زر المشاركة في شريط المتصفح',
      'اختر "إضافة إلى الشاشة الرئيسية"',
      'اضغط "إضافة" وسيظهر التطبيق على شاشتك',
    ],
  },
  android: {
    title: 'تثبيت التطبيق على أندرويد',
    steps: [
      'افتح قائمة المتصفح (النقاط الثلاث ⋮)',
      'اضغط "إضافة إلى الشاشة الرئيسية" أو "تثبيت التطبيق"',
      'اضغط "تثبيت" وسيظهر التطبيق على شاشتك',
    ],
  },
  mac: {
    title: 'تثبيت التطبيق على ماك',
    steps: [
      'افتح Safari وادخل إلى الموقع',
      'اضغط زر المشاركة في شريط الأدوات ثم "إضافة إلى Dock"',
      'سيظهر التطبيق في الـ Dock (يتطلب Safari 17.2+ على macOS 14+)',
    ],
  },
  other: {
    title: 'تثبيت التطبيق',
    steps: [
      'افتح قائمة المتصفح',
      'اختر "تثبيت التطبيق" أو "إضافة إلى الشاشة الرئيسية"',
      'اتبع تعليمات المتصفح لإنشاء الاختصار',
    ],
  },
};

export const PwaInstallButton: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [showGuide, setShowGuide] = useState(false);

  const device = getDevice();
  const guide = GUIDES[device];

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
      setDeferredPrompt(null);
    } else {
      setShowGuide(true);
    }
  };

  if (installed) return null;

  const label = device === 'ios' ? 'تثبيت على آيفون' : device === 'android' ? 'تثبيت على أندرويد' : 'تثبيت';

  return (
    <>
      <button
        onClick={handleClick}
        className="shrink-0 bg-emerald-500/90 hover:bg-emerald-600 text-white text-sm font-medium py-2 px-3.5 rounded-lg inline-flex items-center gap-2"
      >
        <Download className="w-4 h-4" />
        <span>{label}</span>
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4" onClick={() => setShowGuide(false)}>
          <div
            className="modal-panel w-full max-w-sm rounded-2xl border border-white/10 bg-[#0F1A30] p-5 text-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold">{guide.title}</h3>
              <button onClick={() => setShowGuide(false)} className="p-1 rounded-lg hover:bg-white/10">
                <X className="w-4 h-4" />
              </button>
            </div>
            <ol className="space-y-3 text-sm text-slate-200">
              {guide.steps.map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20 text-blue-300 text-xs font-bold">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
              <Share className="w-3.5 h-3.5" /> بعد التثبيت يعمل الموقع كتطبيق منفصل كامل
            </p>
          </div>
        </div>
      )}
    </>
  );
};
