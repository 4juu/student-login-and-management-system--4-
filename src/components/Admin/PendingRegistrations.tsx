// src/components/Admin/PendingRegistrations.tsx
import React, { useEffect, useState, useMemo } from 'react';
import { ref, onValue, off, update, set, get } from 'firebase/database';
import { database } from '../../firebase/config';
import { Student } from '../../types/student';
import { PendingRegistration } from '../../types/registration';
import { getMatchDescription, AUTO_APPROVE_THRESHOLD } from '../../services/nameMatching';
import { getActiveAcademicYear } from '../../firebase/dataService';

interface PendingRegistrationsProps {
  adminUid: string;
  onClose: () => void;
}

type FilterStatus = 'all' | 'pending' | 'approved' | 'rejected' | 'auto-approved';

export const PendingRegistrations: React.FC<PendingRegistrationsProps> = ({
  adminUid,
  onClose,
}) => {
  const [requests, setRequests] = useState<PendingRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>('pending');
  const [processing, setProcessing] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  
  // ──────────────────────────────────────────
  // 📡 الاستماع المباشر لطلبات التسجيل
  // ──────────────────────────────────────────
  useEffect(() => {
    const path = `registrationSystem/pending/${adminUid}`;
    const requestsRef = ref(database, path);
    
    const unsubscribe = onValue(requestsRef, (snapshot) => {
      if (!snapshot.exists()) {
        setRequests([]);
        setLoading(false);
        return;
      }
      
      const data = snapshot.val();
      const arr: PendingRegistration[] = Object.values(data);
      arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      setRequests(arr);
      setLoading(false);
    }, (error) => {
      console.error('❌ خطأ في جلب الطلبات:', error);
      setLoading(false);
    });
    
    return () => {
      off(requestsRef);
      unsubscribe();
    };
  }, [adminUid]);
  
  // ──────────────────────────────────────────
  // 🔍 فلترة الطلبات
  // ──────────────────────────────────────────
  const filteredRequests = useMemo(() => {
    return requests.filter(r => {
      if (filter !== 'all' && r.status !== filter) return false;
      
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          r.nameInSystem.toLowerCase().includes(q) ||
          r.nameFromID.toLowerCase().includes(q) ||
          r.studentCode.toLowerCase().includes(q)
        );
      }
      
      return true;
    });
  }, [requests, filter, searchQuery]);
  
  // ──────────────────────────────────────────
  // ✅ موافقة على طلب
  // ──────────────────────────────────────────
  const handleApprove = async (req: PendingRegistration) => {
    if (!window.confirm(`الموافقة على تسجيل ${req.nameInSystem}؟`)) return;
    
    setProcessing(req.id);
    
    try {
      // 1️⃣ تطبيق التغييرات على الطالب
      const year = await getActiveAcademicYear();
      const studentsPath = `academicYears/${year}/userData/${adminUid}/stageData/${req.stageId}/students`;
      const snap = await get(ref(database, studentsPath));
      
      if (!snap.exists()) {
        throw new Error('لم نجد بيانات الطلاب');
      }
      
      const data = snap.val();
      const studentsArr: Student[] = Array.isArray(data) ? data : Object.values(data);
      const idx = studentsArr.findIndex(s => s.id === req.studentId);
      
      if (idx === -1) {
        throw new Error('لم نجد الطالب');
      }
      
      studentsArr[idx] = {
        ...studentsArr[idx],
        qrCodeId: req.qrCodeId,
        faceDescriptor: req.faceDescriptor,
        faceRegisteredAt: new Date().toISOString(),
        faceCompressed: true,
      } as Student;
      
      await set(ref(database, studentsPath), studentsArr);
      
      // 2️⃣ تحديث حالة الطلب
      await update(ref(database, `registrationSystem/pending/${adminUid}/${req.id}`), {
        status: 'approved',
        reviewedAt: new Date().toISOString(),
        reviewedBy: adminUid,
      });
      
      // إشعار صغير
      console.log('✅ تمت الموافقة');
    } catch (e: any) {
      console.error(e);
      alert('❌ فشلت العملية: ' + (e.message || ''));
    } finally {
      setProcessing(null);
    }
  };
  
  // ──────────────────────────────────────────
  // ❌ رفض طلب
  // ──────────────────────────────────────────
  const handleReject = async (req: PendingRegistration, reason: string) => {
    setProcessing(req.id);
    
    try {
      await update(ref(database, `registrationSystem/pending/${adminUid}/${req.id}`), {
        status: 'rejected',
        rejectionReason: reason || 'بدون سبب محدد',
        reviewedAt: new Date().toISOString(),
        reviewedBy: adminUid,
      });
      
      setRejectingId(null);
      setRejectReason('');
    } catch (e: any) {
      console.error(e);
      alert('❌ فشلت العملية');
    } finally {
      setProcessing(null);
    }
  };
  
  // ──────────────────────────────────────────
  // 🗑️ حذف طلب
  // ──────────────────────────────────────────
  const handleDelete = async (req: PendingRegistration) => {
    if (!window.confirm('حذف هذا الطلب نهائياً؟')) return;
    
    try {
      await set(ref(database, `registrationSystem/pending/${adminUid}/${req.id}`), null);
    } catch (e) {
      console.error(e);
      alert('فشل الحذف');
    }
  };
  
  // ──────────────────────────────────────────
  // 📊 إحصائيات
  // ──────────────────────────────────────────
  const stats = useMemo(() => ({
    total: requests.length,
    pending: requests.filter(r => r.status === 'pending').length,
    approved: requests.filter(r => r.status === 'approved').length,
    autoApproved: requests.filter(r => r.status === 'auto-approved').length,
    rejected: requests.filter(r => r.status === 'rejected').length,
  }), [requests]);
  
  // ──────────────────────────────────────────
  // 🎨 RENDER
  // ──────────────────────────────────────────
  
  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[95vh] flex flex-col">
        
        {/* Header */}
        <div className="p-5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              📋 طلبات التسجيل الذاتي
              {stats.pending > 0 && (
                <span className="bg-red-500 text-white text-sm px-2.5 py-0.5 rounded-full animate-pulse">
                  {stats.pending}
                </span>
              )}
            </h2>
            <p className="text-sm text-gray-500">مراجعة طلبات الطلاب الذاتية</p>
          </div>
          <button
            onClick={onClose}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-bold"
          >
            ✕ إغلاق
          </button>
        </div>
        
        {/* الإحصائيات */}
        <div className="px-5 py-3 border-b border-gray-200 bg-gray-50">
          <div className="grid grid-cols-5 gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`p-2 rounded-lg text-center transition ${
                filter === 'all' ? 'bg-blue-100 border-2 border-blue-400' : 'bg-white border border-gray-200'
              }`}
            >
              <div className="text-lg font-bold text-gray-700">{stats.total}</div>
              <div className="text-[10px] text-gray-500">الإجمالي</div>
            </button>
            <button
              onClick={() => setFilter('pending')}
              className={`p-2 rounded-lg text-center transition ${
                filter === 'pending' ? 'bg-amber-100 border-2 border-amber-400' : 'bg-white border border-gray-200'
              }`}
            >
              <div className="text-lg font-bold text-amber-600">{stats.pending}</div>
              <div className="text-[10px] text-amber-700">قيد المراجعة</div>
            </button>
            <button
              onClick={() => setFilter('approved')}
              className={`p-2 rounded-lg text-center transition ${
                filter === 'approved' ? 'bg-emerald-100 border-2 border-emerald-400' : 'bg-white border border-gray-200'
              }`}
            >
              <div className="text-lg font-bold text-emerald-600">{stats.approved}</div>
              <div className="text-[10px] text-emerald-700">موافق عليها</div>
            </button>
            <button
              onClick={() => setFilter('auto-approved')}
              className={`p-2 rounded-lg text-center transition ${
                filter === 'auto-approved' ? 'bg-teal-100 border-2 border-teal-400' : 'bg-white border border-gray-200'
              }`}
            >
              <div className="text-lg font-bold text-teal-600">{stats.autoApproved}</div>
              <div className="text-[10px] text-teal-700">تلقائي</div>
            </button>
            <button
              onClick={() => setFilter('rejected')}
              className={`p-2 rounded-lg text-center transition ${
                filter === 'rejected' ? 'bg-red-100 border-2 border-red-400' : 'bg-white border border-gray-200'
              }`}
            >
              <div className="text-lg font-bold text-red-600">{stats.rejected}</div>
              <div className="text-[10px] text-red-700">مرفوضة</div>
            </button>
          </div>
        </div>
        
        {/* البحث */}
        <div className="px-5 py-3 border-b border-gray-200">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="🔍 بحث بالاسم أو الكود..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
        
        {/* قائمة الطلبات */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="text-center py-8">
              <div className="inline-block w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-500 mt-2">جاري التحميل...</p>
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <div className="text-5xl mb-2">📭</div>
              <p className="font-medium">
                {filter === 'pending' ? 'لا توجد طلبات قيد المراجعة' : 'لا توجد طلبات'}
              </p>
            </div>
          ) : (
            filteredRequests.map(req => {
              const desc = getMatchDescription(req.matchPercentage);
              const isProcessing = processing === req.id;
              const isPending = req.status === 'pending';
              const isAutoApproved = req.status === 'auto-approved';
              const isApproved = req.status === 'approved';
              const isRejected = req.status === 'rejected';
              const isRejecting = rejectingId === req.id;
              
              return (
                <div
                  key={req.id}
                  className={`border-2 rounded-xl p-4 transition ${
                    isPending ? 'border-amber-300 bg-amber-50' :
                    isAutoApproved ? 'border-teal-300 bg-teal-50' :
                    isApproved ? 'border-emerald-300 bg-emerald-50' :
                    'border-red-300 bg-red-50'
                  }`}
                >
                  {/* الحالة */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                        isPending ? 'bg-amber-200 text-amber-800' :
                        isAutoApproved ? 'bg-teal-200 text-teal-800' :
                        isApproved ? 'bg-emerald-200 text-emerald-800' :
                        'bg-red-200 text-red-800'
                      }`}>
                        {isPending ? '⏳ قيد المراجعة' :
                         isAutoApproved ? '⚡ موافقة تلقائية' :
                         isApproved ? '✅ تمت الموافقة' :
                         '❌ مرفوض'}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(req.createdAt).toLocaleString('ar-EG')}
                      </span>
                    </div>
                    
                    <div className={`text-sm font-bold px-3 py-1 rounded-full ${
                      req.matchPercentage >= AUTO_APPROVE_THRESHOLD ? 'bg-green-500 text-white' :
                      req.matchPercentage >= 60 ? 'bg-amber-500 text-white' :
                      'bg-red-500 text-white'
                    }`}>
                      {desc.emoji} {req.matchPercentage}%
                    </div>
                  </div>
                  
                  {/* مقارنة الأسماء */}
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="bg-white rounded-lg p-3 border border-blue-200">
                      <p className="text-xs text-blue-600 font-bold mb-1">📷 من الهوية:</p>
                      <p className="font-bold text-blue-900 text-sm">{req.nameFromID}</p>
                    </div>
                    <div className="bg-white rounded-lg p-3 border border-purple-200">
                      <p className="text-xs text-purple-600 font-bold mb-1">💾 من النظام:</p>
                      <p className="font-bold text-purple-900 text-sm">{req.nameInSystem}</p>
                      <p className="text-[10px] text-purple-500 mt-0.5">الرمز: {req.studentCode}</p>
                    </div>
                  </div>
                  
                  {/* معلومات إضافية */}
                  <div className="flex gap-2 flex-wrap mb-3">
                    <span className="text-[10px] bg-white border border-gray-300 rounded-full px-2 py-1">
                      🔳 QR: <code className="font-mono">{req.qrCodeId.slice(0, 16)}...</code>
                    </span>
                    <span className="text-[10px] bg-white border border-gray-300 rounded-full px-2 py-1">
                      😊 بصمة وجه مسجلة
                    </span>
                    {req.hasExistingQr && (
                      <span className="text-[10px] bg-amber-100 border border-amber-300 text-amber-800 rounded-full px-2 py-1">
                        ⚠️ سيتم استبدال QR قديم
                      </span>
                    )}
                    {req.hasExistingFace && (
                      <span className="text-[10px] bg-amber-100 border border-amber-300 text-amber-800 rounded-full px-2 py-1">
                        ⚠️ سيتم استبدال بصمة قديمة
                      </span>
                    )}
                  </div>
                  
                  {/* سبب الرفض */}
                  {isRejected && req.rejectionReason && (
                    <div className="mb-3 p-2 bg-red-100 border border-red-300 rounded text-xs text-red-800">
                      <strong>سبب الرفض:</strong> {req.rejectionReason}
                    </div>
                  )}
                  
                  {/* نموذج الرفض */}
                  {isRejecting && (
                    <div className="mb-3 p-3 bg-white border-2 border-red-300 rounded-lg">
                      <textarea
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder="سبب الرفض (اختياري)..."
                        rows={2}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                      />
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <button
                          onClick={() => {
                            setRejectingId(null);
                            setRejectReason('');
                          }}
                          className="py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-bold rounded"
                        >
                          إلغاء
                        </button>
                        <button
                          onClick={() => handleReject(req, rejectReason)}
                          disabled={isProcessing}
                          className="py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded"
                        >
                          {isProcessing ? '⏳' : '✓ تأكيد الرفض'}
                        </button>
                      </div>
                    </div>
                  )}
                  
                  {/* أزرار الإجراءات */}
                  {!isRejecting && (
                    <div className="flex gap-2">
                      {isPending && (
                        <>
                          <button
                            onClick={() => handleApprove(req)}
                            disabled={isProcessing}
                            className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold rounded-lg active:scale-95"
                          >
                            {isProcessing ? '⏳ جاري...' : '✅ موافقة'}
                          </button>
                          <button
                            onClick={() => {
                              setRejectingId(req.id);
                              setRejectReason('');
                            }}
                            disabled={isProcessing}
                            className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-bold rounded-lg active:scale-95"
                          >
                            ❌ رفض
                          </button>
                        </>
                      )}
                      
                      {(isApproved || isAutoApproved || isRejected) && (
                        <button
                          onClick={() => handleDelete(req)}
                          className="flex-1 py-2 bg-gray-500 hover:bg-gray-600 text-white text-sm font-bold rounded-lg"
                        >
                          🗑️ حذف من السجل
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default PendingRegistrations;