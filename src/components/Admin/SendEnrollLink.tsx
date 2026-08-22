import React, { useState, useEffect, useCallback } from 'react';
import { createEnrollLink } from '../../services/tokenService';
import { Copy, Check, Link2, QrCode, LoaderCircle, XCircle } from 'lucide-react';

interface SendEnrollLinkProps {
  adminUid: string;
  onClose: () => void;
}

export const SendEnrollLink: React.FC<SendEnrollLinkProps> = ({ adminUid, onClose }) => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    setLoading(true);
    setError('');
    setCopied(false);
    try {
      const { url: generated } = await createEnrollLink(adminUid);
      setUrl(generated);
    } catch (e: any) {
      setError(e.message || 'فشل إنشاء الرابط');
    } finally {
      setLoading(false);
    }
  }, [adminUid]);

  useEffect(() => { generate(); }, [generate]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('تعذر نسخ الرابط');
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-slate-900 border border-white/10 text-white rounded-2xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Link2 className="w-5 h-5 text-purple-400" /> رابط تسجيل بصمة الوجه
          </h2>
          <button onClick={onClose} className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg font-bold text-sm">✕</button>
        </div>

        <p className="text-sm text-slate-400 mb-4">
          شارك هذا الرابط مع الطلاب. عند فتحه يرفع كل طالب صورة هويته فيتعرّف النظام على اسمه تلقائياً ويسجّل بصمة وجهه،
          ثم تظهر طلباتهم في «استقبال طلبات التسجيل» للموافقة.
        </p>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
            <LoaderCircle className="w-5 h-5 animate-spin" /> جاري إنشاء الرابط...
          </div>
        ) : error ? (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-sm flex items-center gap-2 mb-3">
            <XCircle className="w-4 h-4" /> {error}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 bg-slate-800 border border-slate-600 rounded-lg p-2">
              <QrCode className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 bg-transparent text-xs text-slate-200 outline-none font-mono"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={copy}
                className="py-2.5 bg-gradient-to-l from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold rounded-xl transition active:scale-[0.98] flex items-center justify-center gap-1.5"
              >
                {copied ? <><Check className="w-4 h-4" /> تم النسخ</> : <><Copy className="w-4 h-4" /> نسخ الرابط</>}
              </button>
              <button
                onClick={generate}
                className="py-2.5 bg-white/10 hover:bg-white/15 text-white font-bold rounded-xl transition active:scale-[0.98]"
              >
                توليد رابط جديد
              </button>
            </div>
          </div>
        )}

        <button onClick={onClose} className="w-full mt-4 py-2.5 text-slate-400 hover:text-white text-sm transition">
          إغلاق
        </button>
      </div>
    </div>
  );
};

export default SendEnrollLink;
