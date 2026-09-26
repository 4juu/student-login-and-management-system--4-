import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Users, X, CheckCircle, AlertCircle, Loader2, ChevronDown, Hash, Edit2 } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

const GROUPS = [
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8',
  'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8',
];

interface ParsedStudent {
  name: string;
  group: string;
  code: string;
}

interface BulkStudentImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (students: { name: string; group: string; code: string }[]) => void;
  existingStudents: { name: string; code: string }[];
  selectedPrefix: number;
}

export const BulkStudentImportModal: React.FC<BulkStudentImportModalProps> = ({
  isOpen,
  onClose,
  onImport,
  existingStudents,
  selectedPrefix,
}) => {
  const [selectedGroup, setSelectedGroup] = useState('');
  const [textInput, setTextInput] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [parsedPreview, setParsedPreview] = useState<ParsedStudent[]>([]);
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);
  const [localPrefix, setLocalPrefix] = useState(selectedPrefix);
  const [showCustomPrefix, setShowCustomPrefix] = useState(false);
  const [customPrefixVal, setCustomPrefixVal] = useState('');

  useEffect(() => { setLocalPrefix(selectedPrefix); }, [selectedPrefix]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (isOpen) {
      // preventScroll: يمنع قفز تمرير الصفحة إلى مربع النص عند تركيزه
      setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowGroupDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const parseInput = (input: string): ParsedStudent[] => {
    const lines = input.trim().split('\n');
    const existingCodes = new Set(existingStudents.map(s => s.code));
    const existingNames = new Set(existingStudents.map(s => s.name));
    let currentCode = localPrefix * 1000 + 1;
    const results: ParsedStudent[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const parts = trimmed.split(/\s+/).filter(p => p.length > 0);
      if (parts.length < 2) continue;

      const fullName = parts.join(' ');

      if (existingNames.has(fullName)) continue;

      while (existingCodes.has(String(currentCode)) && currentCode <= 9999) {
        currentCode++;
      }
      if (currentCode > 9999) break;

      results.push({
        name: fullName,
        group: selectedGroup,
        code: String(currentCode),
      });

      existingCodes.add(String(currentCode));
      existingNames.add(fullName);
      currentCode++;
    }

    return results;
  };

  useEffect(() => {
    if (textInput.trim() && selectedGroup) {
      setParsedPreview(parseInput(textInput));
    } else {
      setParsedPreview([]);
    }
  }, [textInput, selectedGroup, localPrefix, existingStudents]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    if (!selectedGroup) {
      setError('الرجاء اختيار كروب');
      return;
    }

    if (!textInput.trim()) {
      setError('الرجاء لصق أسماء الطلاب');
      return;
    }

    const parsed = parseInput(textInput);

    if (parsed.length === 0) {
      setError('لم يتم العثور على طلاب صالحين. تأكد من أن كل سطر يحتوي على اسم كامل (جزأين على الأقل).');
      return;
    }

    setIsProcessing(true);
    setTimeout(() => {
      onImport(parsed);
      setSuccessMessage(`تمت إضافة ${parsed.length} طالب بنجاح`);
      setTextInput('');
      setParsedPreview([]);
      setIsProcessing(false);
      setTimeout(() => onClose(), 1500);
    }, 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  if (!isOpen) return null;

  /* البوابة (portal) إلى body: تضمن توسيط النافذة على الشاشة حتى لو كان
     أحد الأبواب يحتوي transform (contains) أثناء أنيميشن الدخول */
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-import-title"
    >
      <div
        className="bg-slate-900 border border-white/10 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl animate-modalUp"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-white/10 sticky top-0 bg-slate-900/95 backdrop-blur z-10 rounded-t-2xl">
          <h3 id="bulk-import-title" className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="w-6 h-6 text-blue-400" />
            إضافة جماعية للطلاب
          </h3>
          <button
            onClick={onClose}
            className="text-2xl text-slate-500 hover:text-slate-300 leading-none p-1"
            aria-label="إغلاق"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5">
          <div className="mb-5">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              اختر الكروب <span className="text-red-400">*</span>
            </label>
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setShowGroupDropdown(!showGroupDropdown)}
                className={`w-full px-4 py-3 bg-slate-800 border-2 rounded-lg text-left transition ${
                  selectedGroup
                    ? 'border-blue-500 bg-blue-500/10 text-white'
                    : 'border-slate-600 text-slate-400 hover:border-slate-400'
                }`}
                aria-haspopup="listbox"
                aria-expanded={showGroupDropdown}
              >
                <div className="flex items-center justify-between">
                  <span>{selectedGroup || 'اختر الكروب (A1-B8)'}</span>
                  <ChevronDown
                    className={`w-5 h-5 text-slate-400 transition-transform ${showGroupDropdown ? 'rotate-180' : ''}`}
                  />
                </div>
              </button>

              {showGroupDropdown && (
                <div
                  className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-20 max-h-60 overflow-auto"
                  role="listbox"
                >
                  {GROUPS.map(g => (
                    <button
                      key={g}
                      type="button"
                      role="option"
                      aria-selected={selectedGroup === g}
                      onClick={() => { setSelectedGroup(g); setShowGroupDropdown(false); }}
                      className={`w-full px-4 py-2 text-left transition ${
                        selectedGroup === g
                          ? 'bg-blue-500/20 text-blue-300'
                          : 'text-slate-200 hover:bg-slate-700'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mb-5">
            <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-1.5">
              <Hash className="w-4 h-4 text-blue-400" /> بادئة الكود <span className="text-red-400">*</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                <button
                  key={num}
                  type="button"
                  onClick={() => { setLocalPrefix(num); setShowCustomPrefix(false); }}
                  className={`w-12 h-12 rounded-lg font-bold text-sm transition duration-200 ${
                    localPrefix === num
                      ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg scale-110'
                      : 'bg-white/10 text-slate-200 border-2 border-slate-600 hover:border-blue-400'
                  }`}
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={() => { setShowCustomPrefix(v => !v); }}
                className={`w-12 h-12 rounded-lg font-bold text-xs border-2 transition ${showCustomPrefix ? 'border-blue-400 bg-blue-500/20 text-blue-300' : 'border-dashed border-slate-500 text-slate-400 hover:border-blue-400'}`}
                title="بادئة مخصصة"
              >
                <Edit2 className="w-4 h-4 mx-auto" />
              </button>
            </div>
            {showCustomPrefix && (
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={9}
                  value={customPrefixVal}
                  onChange={e => setCustomPrefixVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const v = parseInt(customPrefixVal, 10); if (!isNaN(v) && v >= 1 && v <= 9) { setLocalPrefix(v); setShowCustomPrefix(false); setCustomPrefixVal(''); } } }}
                  placeholder="رقم 1-9"
                  className="w-28 px-3 py-2 bg-slate-800 border-2 border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button type="button" onClick={() => { const v = parseInt(customPrefixVal, 10); if (!isNaN(v) && v >= 1 && v <= 9) { setLocalPrefix(v); setShowCustomPrefix(false); setCustomPrefixVal(''); } }} className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition">تطبيق</button>
              </div>
            )}
            <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
              <Hash className="w-3.5 h-3.5" /> الأكواد ستبدأ من: <strong>{localPrefix}001</strong>
            </p>
          </div>

          <div className="mb-5">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              ألصق أسماء الطلاب <span className="text-red-400">*</span>
              <span className="text-xs text-slate-500 ml-2">(سطر لكل طالب، الأجزاء مفصولة بمسافة)</span>
            </label>
            <textarea
              ref={textareaRef}
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              className="w-full min-h-[200px] px-4 py-3 bg-slate-800 border-2 border-slate-600 rounded-lg text-white placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-medium"
              placeholder={`
مجتبى هيثم محمد محسن
نور الهدى مؤيد سالم جاسم
علي محمد شلواح جبر
... (طالب واحد في كل سطر)
`.trim()}
              dir="rtl"
              disabled={isProcessing}
            />
            <p className="text-xs text-slate-500 mt-1 text-left">
              مثال: <code className="bg-slate-700 px-1 rounded">مجتبى هيثم محمد محسن</code> = 4 أجزاء = اسم كامل
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-md flex items-center gap-2" role="alert">
              <AlertCircle className="w-5 h-5 shrink-0" />
              {error}
            </div>
          )}

          {successMessage && (
            <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 text-green-300 rounded-md flex items-center gap-2" role="status">
              <CheckCircle className="w-5 h-5 shrink-0" />
              {successMessage}
            </div>
          )}

          {parsedPreview.length > 0 && (
            <div className="mb-5 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg max-h-40 overflow-auto">
              <p className="text-sm font-medium text-blue-300 mb-2 flex items-center gap-1">
                <Users className="w-4 h-4" />
                معاينة ({parsedPreview.length} طالب):
              </p>
              <ul className="space-y-1 text-sm text-slate-300">
                {parsedPreview.slice(0, 15).map((s, i) => (
                  <li key={i} className="flex items-center gap-2 text-[11px]">
                    <span className="w-8 text-center text-blue-400 font-mono">{s.code}</span>
                    <span className="text-white">{s.name}</span>
                    <span className="px-1.5 py-0.5 bg-slate-700 rounded text-xs text-slate-400">{s.group}</span>
                  </li>
                ))}
                {parsedPreview.length > 15 && (
                  <li className="text-slate-500 text-center py-1">+ {parsedPreview.length - 15} طالب آخر...</li>
                )}
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              disabled={isProcessing}
              className="px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white font-medium rounded-md transition disabled:opacity-50"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isProcessing || !selectedGroup || !textInput.trim()}
              className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-medium rounded-md shadow-md transition disabled:opacity-50 flex items-center gap-2"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  جاري الإضافة...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  إضافة الطلاب ({parsedPreview.length})
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};