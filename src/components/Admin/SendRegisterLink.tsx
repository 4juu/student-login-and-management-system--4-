// src/components/Admin/SendRegisterLink.tsx
import React, { useState, useMemo } from 'react';
import { Student, Stage, College } from '../../types/student';
import {
  createBulkRegistrationLinks,
} from '../../services/tokenService';

interface SendRegisterLinkProps {
  adminUid: string;
  colleges: College[];
  stages: Stage[];
  loadStudents: (stageId: string) => Promise<Student[]>;
  onClose: () => void;
}

interface GeneratedLink {
  studentId: string;
  studentName: string;
  studentCode: string;
  url: string;
  copied: boolean;
}

export const SendRegisterLink: React.FC<SendRegisterLinkProps> = ({
  adminUid,
  colleges,
  stages,
  loadStudents,
  onClose,
}) => {
  const [selectedCollegeId, setSelectedCollegeId] = useState<string>('');
  const [selectedStageId, setSelectedStageId] = useState<string>('');
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'without-qr' | 'without-face'>('all');
  
  const [generatedLinks, setGeneratedLinks] = useState<GeneratedLink[]>([]);
  const [generating, setGenerating] = useState(false);
  const [showLinks, setShowLinks] = useState(false);
  const [expiryDays, setExpiryDays] = useState(30);
  
  const stagesForCollege = useMemo(() => 
    stages.filter(s => s.collegeId === selectedCollegeId),
    [stages, selectedCollegeId]
  );
  
  const handleStageChange = async (stageId: string) => {
    setSelectedStageId(stageId);
    setStudents([]);
    setSelectedIds(new Set());
    
    if (!stageId) return;
    
    setLoading(true);
    try {
      const list = await loadStudents(stageId);
      setStudents(list);
    } catch (e) {
      console.error(e);
      alert('فشل تحميل الطلاب');
    } finally {
      setLoading(false);
    }
  };
  
  const filteredStudents = useMemo(() => {
    return students.filter(s => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!s.name.toLowerCase().includes(q) && !s.code.toLowerCase().includes(q)) return false;
      }
      
      if (filterMode === 'without-qr' && s.qrCodeId) return false;
      if (filterMode === 'without-face' && s.faceDescriptor) return false;
      
      return true;
    });
  }, [students, searchQuery, filterMode]);
  
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredStudents.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredStudents.map(s => s.id)));
    }
  };
  
  const toggleStudent = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  
  const handleGenerateLinks = async () => {
    if (selectedIds.size === 0) {
      alert('الرجاء اختيار طلاب');
      return;
    }
    
    if (!selectedStageId) return;
    
    if (!window.confirm(`سيتم توليد ${selectedIds.size} رابط تسجيل. متابعة؟`)) return;
    
    setGenerating(true);
    
    try {
      const studentIds = Array.from(selectedIds);
      const links = await createBulkRegistrationLinks(
        adminUid,
        selectedStageId,
        studentIds,
        expiryDays
      );
      
      const generated: GeneratedLink[] = links.map(link => {
        const student = students.find(s => s.id === link.studentId);
        return {
          studentId: link.studentId,
          studentName: student?.name || 'غير معروف',
          studentCode: student?.code || '',
          url: link.url,
          copied: false,
        };
      });
      
      // ترتيب حسب الكود
      generated.sort((a, b) => a.studentCode.localeCompare(b.studentCode));
      
      setGeneratedLinks(generated);
      setShowLinks(true);
    } catch (e: any) {
      console.error(e);
      alert('فشل توليد الروابط: ' + (e.message || ''));
    } finally {
      setGenerating(false);
    }
  };
  
  const handleCopyLink = async (index: number) => {
    const link = generatedLinks[index];
    try {
      await navigator.clipboard.writeText(link.url);
      setGeneratedLinks(prev => {
        const next = [...prev];
        next[index] = { ...next[index], copied: true };
        return next;
      });
      setTimeout(() => {
        setGeneratedLinks(prev => {
          const next = [...prev];
          if (next[index]) next[index] = { ...next[index], copied: false };
          return next;
        });
      }, 2000);
    } catch {
      alert('فشل النسخ');
    }
  };
  
  const handleCopyAll = async () => {
    const text = generatedLinks
      .map(l => `${l.studentName} (${l.studentCode}):\n${l.url}`)
      .join('\n\n');
    
    try {
      await navigator.clipboard.writeText(text);
      alert(`✅ تم نسخ ${generatedLinks.length} رابط`);
    } catch {
      alert('فشل النسخ');
    }
  };
  
  const handleDownloadCSV = () => {
    const csv = [
      'الاسم,الرمز,رابط التسجيل',
      ...generatedLinks.map(l => `"${l.studentName}","${l.studentCode}","${l.url}"`)
    ].join('\n');
    
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `registration_links_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  const handleShareWhatsApp = (link: GeneratedLink) => {
    const text = encodeURIComponent(
      `مرحباً ${link.studentName} 👋\n\nرابط تسجيل بصمة الوجه ورمز QR الخاص بك:\n\n${link.url}\n\nالرابط صالح لمدة ${expiryDays} يوم.`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };
  
  // ──────────────────────────────────────────
  // 🎨 RENDER
  // ──────────────────────────────────────────
  
  if (showLinks) {
    return (
      <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col">
          
          <div className="p-5 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-800">📨 الروابط الجاهزة للإرسال</h2>
              <p className="text-sm text-gray-500">تم توليد {generatedLinks.length} رابط</p>
            </div>
            <button
              onClick={onClose}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-bold"
            >
              ✕ إغلاق
            </button>
          </div>
          
          <div className="p-4 border-b border-gray-200 flex gap-2 flex-wrap">
            <button
              onClick={handleCopyAll}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg"
            >
              📋 نسخ الكل
            </button>
            <button
              onClick={handleDownloadCSV}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-lg"
            >
              📥 تحميل CSV
            </button>
            <div className="flex-1" />
            <p className="text-xs text-gray-500 self-center">
              صالحة لمدة {expiryDays} يوم
            </p>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {generatedLinks.map((link, idx) => (
              <div
                key={link.studentId}
                className="bg-gray-50 border border-gray-200 rounded-lg p-3 hover:bg-gray-100 transition"
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-bold text-gray-800">{link.studentName}</p>
                    <p className="text-xs text-gray-500">الرمز: {link.studentCode}</p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleShareWhatsApp(link)}
                      className="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded text-xs font-bold"
                      title="مشاركة عبر واتساب"
                    >
                      📱 واتساب
                    </button>
                    <button
                      onClick={() => handleCopyLink(idx)}
                      className={`px-3 py-1.5 rounded text-xs font-bold ${
                        link.copied
                          ? 'bg-emerald-500 text-white'
                          : 'bg-blue-500 hover:bg-blue-600 text-white'
                      }`}
                    >
                      {link.copied ? '✓ تم!' : '📋 نسخ'}
                    </button>
                  </div>
                </div>
                <div className="bg-white border border-gray-300 rounded px-2 py-1.5 text-xs font-mono text-gray-700 break-all" dir="ltr">
                  {link.url}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        
        {/* Header */}
        <div className="p-5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-800">📨 إرسال روابط التسجيل</h2>
            <p className="text-sm text-gray-500">دع الطلاب يسجلون بصمات وجوههم وQR بأنفسهم</p>
          </div>
          <button
            onClick={onClose}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-bold"
          >
            ✕ إغلاق
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          
          {/* اختيار الكلية والمرحلة */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">الكلية</label>
              <select
                value={selectedCollegeId}
                onChange={e => {
                  setSelectedCollegeId(e.target.value);
                  setSelectedStageId('');
                  setStudents([]);
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="">اختر كلية...</option>
                {colleges.map(c => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">المرحلة</label>
              <select
                value={selectedStageId}
                onChange={e => handleStageChange(e.target.value)}
                disabled={!selectedCollegeId}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100"
              >
                <option value="">اختر مرحلة...</option>
                {stagesForCollege.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>
          
          {/* مدة الصلاحية */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">
              مدة صلاحية الرابط: {expiryDays} يوم
            </label>
            <input
              type="range"
              min="1"
              max="90"
              value={expiryDays}
              onChange={e => setExpiryDays(Number(e.target.value))}
              className="w-full accent-purple-600"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>1 يوم</span>
              <span>30 يوم</span>
              <span>90 يوم</span>
            </div>
          </div>
          
          {loading && (
            <div className="text-center py-6">
              <div className="inline-block w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-500 mt-2">جاري تحميل الطلاب...</p>
            </div>
          )}
          
          {!loading && students.length > 0 && (
            <>
              {/* فلاتر */}
              <div className="space-y-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="🔍 بحث بالاسم أو الكود..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                
                <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                  <button
                    onClick={() => setFilterMode('all')}
                    className={`flex-1 py-1.5 rounded text-xs font-bold ${
                      filterMode === 'all' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500'
                    }`}
                  >
                    الكل ({students.length})
                  </button>
                  <button
                    onClick={() => setFilterMode('without-qr')}
                    className={`flex-1 py-1.5 rounded text-xs font-bold ${
                      filterMode === 'without-qr' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500'
                    }`}
                  >
                    بدون QR ({students.filter(s => !s.qrCodeId).length})
                  </button>
                  <button
                    onClick={() => setFilterMode('without-face')}
                    className={`flex-1 py-1.5 rounded text-xs font-bold ${
                      filterMode === 'without-face' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500'
                    }`}
                  >
                    بدون وجه ({students.filter(s => !s.faceDescriptor).length})
                  </button>
                </div>
              </div>
              
              {/* تحديد الكل */}
              <div className="flex items-center justify-between bg-purple-50 border border-purple-200 rounded-lg p-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === filteredStudents.length && filteredStudents.length > 0}
                    onChange={toggleSelectAll}
                    className="w-5 h-5 accent-purple-600"
                  />
                  <span className="font-bold text-purple-800">
                    تحديد الكل ({filteredStudents.length})
                  </span>
                </label>
                <span className="text-sm text-purple-700">
                  محدد: <strong>{selectedIds.size}</strong>
                </span>
              </div>
              
              {/* قائمة الطلاب */}
              <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
                {filteredStudents.map(s => (
                  <label
                    key={s.id}
                    className="flex items-center gap-3 p-2.5 border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(s.id)}
                      onChange={() => toggleStudent(s.id)}
                      className="w-4 h-4 accent-purple-600"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-gray-800 truncate">{s.name}</p>
                      <p className="text-xs text-gray-500">
                        {s.code} {s.group && `• ${s.group}`}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {s.qrCodeId && <span className="text-emerald-500 text-xs" title="لديه QR">🔳</span>}
                      {s.faceDescriptor && <span className="text-purple-500 text-xs" title="لديه بصمة">😊</span>}
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
        
        {/* Footer */}
        {students.length > 0 && (
          <div className="p-4 border-t border-gray-200 bg-gray-50">
            <button
              onClick={handleGenerateLinks}
              disabled={selectedIds.size === 0 || generating}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-40 text-white font-bold py-3 rounded-lg active:scale-95 transition"
            >
              {generating
                ? '⏳ جاري التوليد...'
                : `🚀 توليد ${selectedIds.size} رابط تسجيل`
              }
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SendRegisterLink;