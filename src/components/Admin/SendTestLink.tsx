import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useModalBehavior } from '../../hooks/useModalBehavior';
import { College, Stage } from '../../types/student';
import { createTestLink, formatRemainingMs, getServerNow } from '../../services/tokenService';
import { Copy, ScanFace, Check, Landmark, Library, Clock } from 'lucide-react';
import { MorphingSquare } from '../MorphingSquare';

interface SendTestLinkProps {
  adminUid: string;
  colleges: College[];
  stages: Stage[];
  onClose: () => void;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const EXPIRY_OPTIONS = [
  { label: 'ساعة واحدة', ms: 1 * HOUR },
  { label: 'ساعتان', ms: 2 * HOUR },
  { label: '6 ساعات', ms: 6 * HOUR },
  { label: 'يوم واحد', ms: 1 * DAY },
  { label: '3 أيام', ms: 3 * DAY },
  { label: 'أسبوع', ms: 7 * DAY },
  { label: '30 يوماً', ms: 30 * DAY },
];

export function SendTestLink({ adminUid, colleges, stages, onClose }: SendTestLinkProps) {
  const [selectedCollegeId, setSelectedCollegeId] = useState('');
  const [selectedStageId, setSelectedStageId] = useState('');
  const [expiryMs, setExpiryMs] = useState<number>(1 * DAY);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [generatedExpiry, setGeneratedExpiry] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);

  const modalRef = useModalBehavior({ open: true, onClose });

  const filteredStages = useMemo(() =>
    selectedCollegeId ? stages.filter(s => s.collegeId === selectedCollegeId) : [],
    [selectedCollegeId, stages]
  );

  const handleGenerate = async () => {
    if (!selectedStageId) return;
    setGenerating(true);
    try {
      const { url, expiresAt } = await createTestLink(adminUid, selectedStageId, expiryMs);
      setGeneratedUrl(url);
      setGeneratedExpiry(expiresAt);
    } catch {
      alert('فشل إنشاء الرابط');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback */ }
  };

  return createPortal(
    <div ref={modalRef as React.Ref<HTMLDivElement>} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="send-test-link-title" tabIndex={-1} className="w-full max-w-md bg-[#0E1930] border border-[#22334F] rounded-2xl shadow-2xl overflow-hidden focus:outline-none" dir="rtl">
        {/* Header */}
        <div className="p-4 border-b border-[#22334F] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScanFace className="h-5 w-5 text-blue-400" />
            <h2 id="send-test-link-title" className="text-base font-bold text-white">اختبار بصمة الوجه</h2>
          </div>
          <button type="button" aria-label="إغلاق" onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-4">
          {!generatedUrl ? (
            <>
              {/* اختيار الكلية */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">الكلية</label>
                <div className="relative">
                  <select
                    value={selectedCollegeId}
                    onChange={e => { setSelectedCollegeId(e.target.value); setSelectedStageId(''); }}
                    className="w-full appearance-none bg-[#0F1B36] border border-[#22334F] rounded-lg px-3 py-2.5 text-sm text-white pe-10 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">اختر الكلية</option>
                    {colleges.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <Landmark className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                </div>
              </div>

              {/* اختيار المرحلة */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">المرحلة</label>
                <div className="relative">
                  <select
                    value={selectedStageId}
                    onChange={e => setSelectedStageId(e.target.value)}
                    disabled={!selectedCollegeId}
                    className="w-full appearance-none bg-[#0F1B36] border border-[#22334F] rounded-lg px-3 py-2.5 text-sm text-white pe-10 focus:border-blue-500 focus:outline-none disabled:opacity-40"
                  >
                    <option value="">اختر المرحلة</option>
                    {filteredStages.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <Library className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                </div>
              </div>

              {/* مدة الصلاحية */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">مدة صلاحية الرابط</label>
                <div className="relative">
                  <select
                    value={expiryMs}
                    onChange={e => setExpiryMs(Number(e.target.value))}
                    className="w-full appearance-none bg-[#0F1B36] border border-[#22334F] rounded-lg px-3 py-2.5 text-sm text-white pe-10 focus:border-blue-500 focus:outline-none"
                  >
                    {EXPIRY_OPTIONS.map(o => (
                      <option key={o.ms} value={o.ms}>{o.label}</option>
                    ))}
                  </select>
                  <Clock className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                </div>
                <p className="text-[11px] text-gray-500 mt-1.5">
                  ينتهي الرابط تلقائياً بعد: {EXPIRY_OPTIONS.find(o => o.ms === expiryMs)?.label}. بعده يتوقف عن العمل.
                </p>
              </div>

              {/* ملاحظة */}
              <div className="bg-blue-500/5 border border-blue-500/10 rounded-lg p-3">
                <p className="text-xs text-blue-300/70 leading-5">
                  هذا الرابط يفتح صفحة اختبار بسيطة — الطالب يفتح الكاميرا ويختبر إذا بصمته تعمل.
                </p>
              </div>

              {/* زر الإنشاء */}
              <button
                onClick={handleGenerate}
                disabled={!selectedStageId || generating}
                className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm transition disabled:opacity-40"
              >
                {generating ? <span className="inline-flex items-center gap-2"><MorphingSquare size="sm" /> جاري الإنشاء...</span> : 'إنشاء رابط الاختبار'}
              </button>
            </>
          ) : (
            <>
              {/* الرابط المُنشأ */}
              <div className="text-center mb-2">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-green-500/10">
                  <Check className="h-6 w-6 text-green-400" />
                </div>
                <p className="text-sm text-gray-300 mb-3">تم إنشاء رابط الاختبار</p>
              </div>
              <div className="bg-[#0F1B36] border border-[#22334F] rounded-lg p-3 flex items-center gap-2">
                <input readOnly value={generatedUrl} className="flex-1 bg-transparent text-xs text-blue-300 outline-none truncate" />
                <button onClick={handleCopy} className="shrink-0 p-2 rounded-md hover:bg-white/5 transition" title="نسخ">
                  {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4 text-gray-400" />}
                </button>
              </div>
              {generatedExpiry > 0 && (
                <div className="flex items-center justify-center gap-1.5 text-xs text-amber-300/80 mt-2">
                  <Clock className="h-3.5 w-3.5" />
                  <span>صالح لمدة {formatRemainingMs(generatedExpiry - getServerNow())} — ينتهي {new Date(generatedExpiry).toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                </div>
              )}
              <p className="text-xs text-gray-500 text-center mt-1">شارك هذا الرابط مع الطلاب لاختبار بصماتهم</p>
              <button onClick={() => { setGeneratedUrl(''); setGeneratedExpiry(0); }} className="w-full py-2 rounded-lg border border-[#22334F] text-gray-300 text-sm hover:bg-white/5 transition">
                إنشاء رابط آخر
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
