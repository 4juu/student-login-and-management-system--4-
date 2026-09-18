import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useModalBehavior } from '../../hooks/useModalBehavior';
import { College, Stage } from '../../types/student';
import { createTestLink } from '../../services/tokenService';
import { Copy, ScanFace, Check, Landmark, Library } from 'lucide-react';

interface SendTestLinkProps {
  adminUid: string;
  colleges: College[];
  stages: Stage[];
  onClose: () => void;
}

export function SendTestLink({ adminUid, colleges, stages, onClose }: SendTestLinkProps) {
  const [selectedCollegeId, setSelectedCollegeId] = useState('');
  const [selectedStageId, setSelectedStageId] = useState('');
  const [generatedUrl, setGeneratedUrl] = useState('');
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
      const { url } = await createTestLink(adminUid, selectedStageId);
      setGeneratedUrl(url);
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
      <div className="w-full max-w-md bg-[#0E1930] border border-[#22334F] rounded-2xl shadow-2xl overflow-hidden" dir="rtl">
        {/* Header */}
        <div className="p-4 border-b border-[#22334F] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScanFace className="h-5 w-5 text-blue-400" />
            <h2 className="text-base font-bold text-white">اختبار بصمة الوجه</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">&times;</button>
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
                    className="w-full appearance-none bg-[#0F1B36] border border-[#22334F] rounded-lg px-3 py-2.5 text-sm text-white pr-10 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">اختر الكلية</option>
                    {colleges.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <Landmark className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
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
                    className="w-full appearance-none bg-[#0F1B36] border border-[#22334F] rounded-lg px-3 py-2.5 text-sm text-white pr-10 focus:border-blue-500 focus:outline-none disabled:opacity-40"
                  >
                    <option value="">اختر المرحلة</option>
                    {filteredStages.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <Library className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                </div>
              </div>

              {/* ملاحظة */}
              <div className="bg-blue-500/5 border border-blue-500/10 rounded-lg p-3">
                <p className="text-xs text-blue-300/70 leading-5">
                  هذا الرابط يفتح صفحة اختبار بسيطة — الطالب يفتح الكاميرا ويختبر إذا بصمته تعمل.
                  لا يُحفظ أي سجل حضور أو تعديلات.
                </p>
              </div>

              {/* زر الإنشاء */}
              <button
                onClick={handleGenerate}
                disabled={!selectedStageId || generating}
                className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm transition disabled:opacity-40"
              >
                {generating ? 'جاري الإنشاء...' : 'إنشاء رابط الاختبار'}
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
              <p className="text-xs text-gray-500 text-center mt-1">شارك هذا الرابط مع الطلاب لاختبار بصماتهم</p>
              <button onClick={() => { setGeneratedUrl(''); }} className="w-full py-2 rounded-lg border border-[#22334F] text-gray-300 text-sm hover:bg-white/5 transition">
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
