import React, { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (window.navigator as unknown as { standalone?: boolean }).standalone === true;

const STEPS = [
  'افتح قائمة المتصفح أو زر المشاركة',
  'اختر "تثبيت التطبيق" أو "إضافة إلى الشاشة الرئيسية"',
  'سيظهر التطبيق على شاشتك ويمكنك فتحه مباشرة',
];

export const PwaInstallButton: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [showGuide, setShowGuide] = useState(false);

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

  return (
    <>
      <button
        onClick={handleClick}
        title="تثبيت التطبيق"
        aria-label="تثبيت التطبيق"
        className="shrink-0 bg-emerald-500/90 hover:bg-emerald-600 text-white p-2.5 rounded-lg inline-flex items-center justify-center"
      >
        <Download className="w-4 h-4" />
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4" onClick={() => setShowGuide(false)}>
          <div
            className="modal-panel w-full max-w-sm rounded-2xl border border-white/10 bg-[#0F1A30] p-5 text-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold">تثبيت التطبيق</h3>
              <button onClick={() => setShowGuide(false)} className="p-1 rounded-lg hover:bg-white/10">
                <X className="w-4 h-4" />
              </button>
            </div>
            <ol className="space-y-3 text-sm text-slate-200">
              {STEPS.map((step, i) => (
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
