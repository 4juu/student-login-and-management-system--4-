import React, { useState, useMemo } from 'react';
import { AttendanceSession, Student, AttendanceRecord } from '../types/student';
import { getCurrentAcademicYear } from '../firebase/dataService';

interface SessionManagerProps {
  sessions: AttendanceSession[];
  activeSessionId: string | null;
  onCreateSession: (session: AttendanceSession) => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, newName: string) => void;
  students?: Student[];
  records?: AttendanceRecord[];
  onMarkAbsent?: (sessionId: string, studentIds: string[]) => void;
}

export const SessionManager: React.FC<SessionManagerProps> = ({
  sessions,
  activeSessionId,
  onCreateSession,
  onSelectSession,
  onDeleteSession,
  students = [],
  records = [],
  onMarkAbsent,
  onRenameSession,
}) => {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [absentSessionId, setAbsentSessionId] = useState<string | null>(null);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editSessionName, setEditSessionName] = useState('');

  const currentAcademicYear = useMemo(() => getCurrentAcademicYear(), []);

  const allGroups = useMemo(() => {
    const groups = new Set<string>();
    students.forEach(s => { if (s.group) groups.add(s.group); });
    return Array.from(groups).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [students]);

  const presentStudentIdsForSession = useMemo(() => {
    if (!absentSessionId) return new Set<string>();
    return new Set(
      records.filter(r => r.sessionId === absentSessionId).map(r => r.studentId)
    );
  }, [records, absentSessionId]);

  const getAbsentCandidates = useMemo(() => {
    if (!absentSessionId || selectedGroups.size === 0) return [];
    return students.filter(s =>
      s.group && selectedGroups.has(s.group) && !presentStudentIdsForSession.has(s.id)
    );
  }, [students, selectedGroups, presentStudentIdsForSession, absentSessionId]);

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
      academicYear: currentAcademicYear,
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
      academicYear: currentAcademicYear,
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

  const handleOpenAbsent = (sessionId: string) => {
    setAbsentSessionId(sessionId);
    setSelectedGroups(new Set());
  };

  const handleGroupToggle = (group: string) => {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const handleConfirmAbsent = () => {
    if (!absentSessionId || getAbsentCandidates.length === 0) return;
    if (window.confirm(`تأكيد تسجيل غياب (${getAbsentCandidates.length}) طالب من الكروبات المحددة؟`)) {
      onMarkAbsent?.(absentSessionId, getAbsentCandidates.map(s => s.id));
      setAbsentSessionId(null);
      setSelectedGroups(new Set());
    }
  };

  const sessionPresentCount = (sessionId: string) =>
    records.filter(r => r.sessionId === sessionId).length;

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
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
              className={`p-3 sm:p-4 rounded-lg border-2 transition-all ${
                session.id === activeSessionId
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {session.id === activeSessionId && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-green-500 text-white shrink-0">
                        نشط الآن
                      </span>
                    )}
                    <h3 className="text-base sm:text-lg font-bold text-gray-800 truncate">
                      {editingSessionId === session.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editSessionName}
                            onChange={e => setEditSessionName(e.target.value)}
                            className="px-3 py-1 border border-blue-400 rounded text-base sm:text-lg font-bold"
                            autoFocus
                            onKeyDown={e => {
                              if (e.key === 'Enter' && editSessionName.trim()) {
                                onRenameSession?.(session.id, editSessionName.trim());
                                setEditingSessionId(null);
                              }
                              if (e.key === 'Escape') setEditingSessionId(null);
                            }}
                            onBlur={() => setEditingSessionId(null)}
                            dir="rtl"
                          />
                        </div>
                      ) : (
                        <span>{session.name}</span>
                      )}
                    </h3>
                    {onRenameSession && editingSessionId !== session.id && (
                      <button
                        onClick={() => { setEditingSessionId(session.id); setEditSessionName(session.name); }}
                        className="text-blue-500 hover:text-blue-700 text-xs sm:text-sm shrink-0"
                        title="تعديل الاسم"
                      >
                        ✏️
                      </button>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm text-gray-600 mt-1">
                    📅 {session.date} | ✅ {sessionPresentCount(session.id)} حاضر
                  </p>
                </div>
                
                <div className="flex gap-1.5 sm:gap-2 flex-wrap">
                  {session.id !== activeSessionId && (
                    <button
                      onClick={() => onSelectSession(session.id)}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-1.5 sm:py-2 px-3 sm:px-4 rounded-md transition duration-200 text-xs sm:text-sm"
                    >
                      تفعيل
                    </button>
                  )}
                  <button
                    onClick={() => handleOpenAbsent(session.id)}
                    className="bg-orange-500 hover:bg-orange-600 text-white font-medium py-1.5 sm:py-2 px-3 sm:px-4 rounded-md transition duration-200 text-xs sm:text-sm"
                  >
                    🔴 غياب
                  </button>
                  <button
                    onClick={() => handleDelete(session.id)}
                    className="bg-red-600 hover:bg-red-700 text-white font-medium py-1.5 sm:py-2 px-3 sm:px-4 rounded-md transition duration-200 text-xs sm:text-sm"
                  >
                    حذف
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* نافذة اختيار الكروبات للغياب */}
      {absentSessionId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-800">🔴 تسجيل غياب الكروبات</h3>
              <button onClick={() => setAbsentSessionId(null)} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              حدد الكروبات اللي عندها محاضرة اليوم. الطلاب المنتمين لهذه الكروبات واللي ما حضروا راح يسجلون غياب.
            </p>

            {allGroups.length === 0 ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center text-yellow-700">
                ⚠️ لا توجد كروبات للطلاب في هذه المرحلة
              </div>
            ) : (
              <div className="space-y-2 mb-4">
                <label className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedGroups.size === allGroups.length}
                    onChange={() => {
                      if (selectedGroups.size === allGroups.length) setSelectedGroups(new Set());
                      else setSelectedGroups(new Set(allGroups));
                    }}
                    className="accent-orange-500 w-5 h-5"
                  />
                  <span className="font-bold text-gray-700">تحديد الكل</span>
                </label>
                {allGroups.map(group => (
                  <label key={group} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 cursor-pointer border border-gray-100">
                    <input
                      type="checkbox"
                      checked={selectedGroups.has(group)}
                      onChange={() => handleGroupToggle(group)}
                      className="accent-orange-500 w-5 h-5"
                    />
                    <span className="font-medium text-gray-800">{group}</span>
                    <span className="text-xs text-gray-500 mr-auto">
                      {students.filter(s => s.group === group).length} طالب
                    </span>
                  </label>
                ))}
              </div>
            )}

            {getAbsentCandidates.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                <p className="text-sm font-bold text-red-700 mb-1">
                  🚨 ({getAbsentCandidates.length}) طالب غائب
                </p>
                <div className="text-xs text-red-600 max-h-24 overflow-y-auto">
                  {getAbsentCandidates.map(s => (
                    <span key={s.id} className="inline-block ml-1">{s.name} | </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleConfirmAbsent}
                disabled={getAbsentCandidates.length === 0}
                className="flex-1 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300 text-white font-bold py-3 px-4 rounded-lg transition"
              >
                ✅ تسجيل غياب ({getAbsentCandidates.length})
              </button>
              <button
                onClick={() => setAbsentSessionId(null)}
                className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-3 px-4 rounded-lg transition"
              >
                إلغاء
              </button>
            </div>
          </div>
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
              <p className="mt-1">
                🔴 يمكنك تسجيل غياب الكروبات بالضغط على زر <strong>"غياب"</strong> بجانب أي سجل.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
