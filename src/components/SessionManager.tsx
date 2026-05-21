import React, { useState, useMemo } from 'react';
import { AttendanceSession } from '../types/student';
import { getCurrentAcademicYear } from '../firebase/dataService';

interface SessionManagerProps {
  sessions: AttendanceSession[];
  activeSessionId: string | null;
  onCreateSession: (session: AttendanceSession) => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}

export const SessionManager: React.FC<SessionManagerProps> = ({
  sessions,
  activeSessionId,
  onCreateSession,
  onSelectSession,
  onDeleteSession,
}) => {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [sessionName, setSessionName] = useState('');

  // 🆕 السنة الأكاديمية الحالية
  const currentAcademicYear = useMemo(() => getCurrentAcademicYear(), []);

  const handleQuickCreate = () => {
    const now = new Date();
    const dateStr = now.toLocaleDateString('ar-EG', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    const name = `حضور ${dateStr}`;
    
    const newSession: AttendanceSession = {
      id: Date.now().toString(),
      name,
      date: now.toLocaleDateString('ar-EG'),
      createdAt: now.toISOString(),
      isActive: true,
      academicYear: currentAcademicYear, // 🆕 ربط بالسنة الأكاديمية
    };
    
    onCreateSession(newSession);
  };

  const handleCustomCreate = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!sessionName.trim()) {
      alert('الرجاء إدخال اسم السجل');
      return;
    }

    const now = new Date();
    const newSession: AttendanceSession = {
      id: Date.now().toString(),
      name: sessionName.trim(),
      date: now.toLocaleDateString('ar-EG'),
      createdAt: now.toISOString(),
      isActive: true,
      academicYear: currentAcademicYear, // 🆕 ربط بالسنة الأكاديمية
    };
    
    onCreateSession(newSession);
    setSessionName('');
    setShowCreateForm(false);
  };

  const handleDelete = (sessionId: string) => {
    if (window.confirm('هل أنت متأكد من حذف هذا السجل؟ سيتم حذف جميع سجلات الحضور المرتبطة به.')) {
      onDeleteSession(sessionId);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      {/* 🆕 شريط السنة الأكاديمية */}
      <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-lg flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🎓</span>
          <div>
            <p className="text-sm font-bold text-indigo-800">
              السنة الأكاديمية: {currentAcademicYear.replace('_', ' - ')}
            </p>
            <p className="text-xs text-indigo-600">
              جميع السجلات تنتمي لهذه السنة
            </p>
          </div>
        </div>
        <div className="text-xs bg-white px-3 py-1 rounded-full border border-indigo-200 text-indigo-700">
          📊 {sessions.length} سجل
        </div>
      </div>

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">إدارة السجلات</h2>
        <div className="flex gap-2">
          <button
            onClick={handleQuickCreate}
            className="bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-md transition duration-200 flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            سجل جديد (اليوم)
          </button>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition duration-200"
          >
            سجل مخصص
          </button>
        </div>
      </div>

      {showCreateForm && (
        <form onSubmit={handleCustomCreate} className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <div className="flex gap-4">
            <input
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="أدخل اسم السجل (مثال: حضور الاختبار النهائي)"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              dir="rtl"
            />
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-md transition duration-200"
            >
              إنشاء
            </button>
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="bg-gray-400 hover:bg-gray-500 text-white font-medium py-2 px-4 rounded-md transition duration-200"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {sessions.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-gray-600 mb-4">لا توجد سجلات حضور</p>
          <p className="text-sm text-gray-500">انقر على "سجل جديد" لإنشاء سجل حضور لليوم</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`p-4 rounded-lg border-2 transition-all ${
                session.id === activeSessionId
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    {session.id === activeSessionId && (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-500 text-white">
                        نشط الآن
                      </span>
                    )}
                    <h3 className="text-lg font-bold text-gray-800">{session.name}</h3>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    📅 {session.date}
                  </p>
                </div>
                
                <div className="flex gap-2">
                  {session.id !== activeSessionId && (
                    <button
                      onClick={() => onSelectSession(session.id)}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition duration-200"
                    >
                      تفعيل
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(session.id)}
                    className="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-md transition duration-200"
                  >
                    حذف
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {sessions.length > 0 && (
        <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm text-yellow-800">
              <p className="font-medium mb-1">💡 ملاحظة</p>
              <p>السجل النشط هو الذي سيتم تسجيل الحضور فيه. يمكنك تبديل السجل في أي وقت.</p>
              <p className="mt-1 text-xs">
                🔄 <strong>التصفير السنوي:</strong> عند بداية السنة الأكاديمية الجديدة، يمكن للأدمن تصفير كل السجلات من إعدادات النظام.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};