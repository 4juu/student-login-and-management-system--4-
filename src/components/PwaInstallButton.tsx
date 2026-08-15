import React, { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const isIosDevice = (): boolean => {
  const ua = window.navigator.userAgent.toLowerCase();
  const ios = /iphone|ipad|ipod/.test(ua);
  const inApp = /(fbav|fban|instagram|messenger)/.test(ua);
  return ios && !inApp;
};

export const PwaInstallButton: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iosHint, setIosHint] = useState(false);
  const [ios] = useState(isIosDevice);

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

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') setInstalled(true);
    setDeferredPrompt(null);
  };

  if (installed) return null;

  return (
    <>
      {deferredPrompt && (
        <button
          onClick={handleInstall}
          className="shrink-0 bg-emerald-500/90 hover:bg-emerald-600 text-white text-sm font-medium py-2 px-3.5 rounded-lg inline-flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">تثبيت التطبيق</span>
        </button>
      )}

      {ios && !deferredPrompt && (
        <button
          onClick={() => setIosHint((v) => !v)}
          className="shrink-0 bg-sky-500/90 hover:bg-sky-600 text-white text-sm font-medium py-2 px-3.5 rounded-lg inline-flex items-center gap-2"
        >
          <Share className="w-4 h-4" />
          <span className="hidden sm:inline">تثبيت التطبيق</span>
        </button>
      )}

      {iosHint && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4" onClick={() => setIosHint(false)}>
          <div
            className="modal-panel w-full max-w-sm rounded-2xl border border-white/10 bg-[#0F1A30] p-5 text-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold">تثبيت التطبيق على آيفون</h3>
              <button onClick={() => setIosHint(false)} className="p-1 rounded-lg hover:bg-white/10">
                <X className="w-4 h-4" />
              </button>
            </div>
            <ol className="space-y-3 text-sm text-slate-200">
              <li className="flex items-start gap-2">
                <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20 text-blue-300 text-xs font-bold">1</span>
                اضغط زر المشاركة <Share className="inline w-3.5 h-3.5" /> في شريط المتصفح
              </li>
              <li className="flex items-start gap-2">
                <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20 text-blue-300 text-xs font-bold">2</span>
                اختر <b>إضافة إلى الشاشة الرئيسية</b>
              </li>
              <li className="flex items-start gap-2">
                <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20 text-blue-300 text-xs font-bold">3</span>
                اضغط <b>إضافة</b> وسيظهر التطبيق على شاشتك
              </li>
            </ol>
          </div>
        </div>
      )}
    </>
  );
};
