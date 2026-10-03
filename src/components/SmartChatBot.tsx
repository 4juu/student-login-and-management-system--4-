import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import {
  Student,
  AttendanceRecord,
  AttendanceSession,
  College,
  Stage,
} from '../types/student';
import { User } from '../types/user';
import { MorphPanel } from './MorphPanel';
import { ChevronLeft, CircleCheck, CircleX, ClipboardList, Search } from 'lucide-react';
import { formatDateWithDay } from '../lib/date';
import { useChatBrain } from '../hooks/useChatBrain';

interface SmartChatBotProps {
  user: User;
  colleges: College[];
  stages: Stage[];
  currentStageId?: string | null | undefined;
  students: Student[];
  records: AttendanceRecord[];
  sessions: AttendanceSession[];
  allStagesData?: {
    [stageId: string]: {
      students: Student[];
      records: AttendanceRecord[];
      sessions: AttendanceSession[];
    };
  } | undefined;
}

export const SmartChatBot: React.FC<SmartChatBotProps> = React.memo(({
  user,
  colleges,
  stages,
  currentStageId,
  students,
  records,
  sessions,
  allStagesData = {},
}) => {
  const isAdmin = user.role === 'admin';

  const [isOpen, setIsOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showSessionsModal, setShowSessionsModal] = useState(false);
  const [showDayDetails, setShowDayDetails] = useState(false);

  useBodyScrollLock(isOpen || showSessionsModal || showDayDetails);

  const studentSearchRef = useRef<HTMLDivElement>(null);

  const accessibleData = useMemo(() => {
    if (isAdmin) {
      const allStudents: Student[] = [];
      const allRecords: AttendanceRecord[] = [];
      const allSessions: AttendanceSession[] = [];
      const stagesMap: {
        [stageId: string]: {
          students: Student[];
          records: AttendanceRecord[];
          sessions: AttendanceSession[];
          stageName: string;
          collegeName: string;
        };
      } = {};

      Object.entries(allStagesData).forEach(([stageId, stageData]) => {
        allStudents.push(...stageData.students);
        allRecords.push(...stageData.records);
        allSessions.push(...stageData.sessions);
        const stage = stages.find(s => s.id === stageId);
        const college = colleges.find(c => c.id === stage?.collegeId);
        stagesMap[stageId] = {
          ...stageData,
          stageName: stage?.name || 'غير معروف',
          collegeName: college?.name || 'غير معروف',
        };
      });

      return {
        accessibleColleges: colleges,
        accessibleStages: stages,
        allStudents: allStudents.length > 0 ? allStudents : students,
        allRecords: allRecords.length > 0 ? allRecords : records,
        allSessions: allSessions.length > 0 ? allSessions : sessions,
        stagesMap,
      };
    }

    const allowedStagesMap = user.permissions?.allowedStages ?? {};
    const accessibleColleges = colleges.filter(c => {
      const stagesForCollege = allowedStagesMap[c.id];
      return !!stagesForCollege && stagesForCollege.length > 0;
    });
    const accessibleStageIds = Object.values(allowedStagesMap).flat();
    const accessibleStages = stages.filter(s => accessibleStageIds.includes(s.id));

    return {
      accessibleColleges,
      accessibleStages,
      allStudents: students,
      allRecords: records,
      allSessions: sessions,
      stagesMap: {},
    };
  }, [isAdmin, colleges, stages, user.permissions, students, records, sessions, allStagesData]);

  const scope = useMemo(() => {
    const stage = currentStageId ? stages.find(s => s.id === currentStageId) : null;
    const college = stage ? colleges.find(c => c.id === stage.collegeId) : null;
    const meta = {
      colleges: accessibleData.accessibleColleges,
      stages: accessibleData.accessibleStages,
      stagesMap: accessibleData.stagesMap,
      stageName: stage?.name,
      collegeName: college?.name,
    };
    if (isAdmin && !currentStageId && accessibleData.allStudents.length > 0) {
      return {
        ...meta,
        students: accessibleData.allStudents,
        records: accessibleData.allRecords,
        sessions: accessibleData.allSessions,
      };
    }
    return { ...meta, students, records, sessions };
  }, [isAdmin, currentStageId, accessibleData, students, records, sessions, stages, colleges]);

  const dataLoaded = accessibleData.allStudents.length > 0;

  // بحث الطلاب + بطاقة الطالب + الاقتراحات — حالة معزولة في useChatBrain
  // (الدوال النقية في lib/chatBrain: computeStudentCard/fixDate)
  const {
    studentSearchQuery,
    studentSuggestions,
    selectedStudentCard,
    showStudentCard,
    showSuggestions,
    setShowSuggestions,
    handleStudentSearch,
    handleSelectStudent,
    clearStudentSearch,
  } = useChatBrain({ scope });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (studentSearchRef.current && !studentSearchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [setShowSuggestions]);

  const requestClose = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => { setIsOpen(false); setClosing(false); }, 280);
  }, []);

  return (
    <>
      {/* 🟢 الحبة المصغرة (زر فتح البحث) */}
      {!isOpen && (
        <MorphPanel onToggle={() => setIsOpen(true)} />
      )}

      {/* 📄 نافذة البحث — بعرض ثابت يملأ النافذة */}
      {isOpen && (
        <div
          key="chat-window"
          className={`fixed bottom-3 right-3 sm:bottom-6 sm:right-6 z-50 overflow-hidden border border-white/10 shadow-2xl w-[calc(100vw-1.5rem)] sm:w-[38rem] max-h-[calc(100vh-3rem)] overscroll-contain ${closing ? 'animate-chatClose' : 'animate-chatOpen'}`}
          style={{ backgroundColor: '#0f172a' }}
          onKeyDown={e => { e.stopPropagation(); }}
          onKeyUp={e => { e.stopPropagation(); }}
        >
          <div className="flex flex-col max-h-[calc(100vh-3rem)]">
            {/* شريط علوي: زر الإغلاق (يمين) مع خط فاصل تحته */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/10 flex-shrink-0">
              <span className="text-xs text-slate-400 font-medium">بحث الطلاب</span>
              <button
                onClick={requestClose}
                aria-label="إغلاق"
                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-red-500/20 text-red-400 hover:text-red-300 text-sm transition"
              >
                ✕
              </button>
            </div>

            {/* 🔍 شريط البحث — بعرض النافذة بالكامل، والنتائج تنزل تحته */}
            <div
              ref={studentSearchRef}
              className="w-full px-3 pt-3 pb-2.5 border-b border-white/10 bg-white/[0.03] flex-shrink-0"
            >
              <div className="relative">
                <div className="flex items-center gap-2 bg-slate-800 rounded-xl border border-white/10 focus-within:border-indigo-500/60 focus-within:ring-1 focus-within:ring-indigo-500/30 transition shadow-sm">
                  <span className="pr-3 text-slate-400 text-sm flex items-center"><Search className="w-4 h-4" /></span>
                  <input
                    type="text"
                    value={studentSearchQuery}
                    onChange={e => handleStudentSearch(e.target.value)}
                    onFocus={() => { if (studentSuggestions.length > 0) setShowSuggestions(true); }}
                    placeholder="اكتب اسم الطالب أو كوده..."
                    className="flex-1 py-2.5 pl-3 text-sm bg-transparent outline-none text-right text-white placeholder:text-slate-500"
                    dir="rtl"
                    autoComplete="off"
                    aria-label="ابحث عن طالب بالاسم أو الكود"
                  />
                  {studentSearchQuery && (
                    <button
                      onClick={clearStudentSearch}
                      aria-label="مسح البحث"
                      className="pl-2 pr-1 text-slate-400 hover:text-slate-200 transition"
                    >
                      ×
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-slate-500 mt-1.5 text-right">اضغط على الطالب لعرض تقرير حضوره وغيابه</p>

                {showSuggestions && studentSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 rounded-xl shadow-xl border border-white/10 z-[70] overflow-hidden max-h-[320px] overflow-y-auto">
                    {studentSuggestions.map(student => {
                      const sRecords = scope.records.filter(r => r.studentId === student.id);
                      const presentIds = new Set(sRecords.filter(r => r.status === 'present').map(r => r.sessionId));
                      const absentIds = new Set(sRecords.filter(r => r.status === 'absent').map(r => r.sessionId));
                      const sAttended = presentIds.size;
                      const sAbsent = absentIds.size;
                      const sPct = (sAttended + sAbsent) > 0 ? ((sAttended / (sAttended + sAbsent)) * 100).toFixed(1) : '0';
                      return (
                        <button
                          key={student.id}
                          onClick={() => handleSelectStudent(student)}
                          className="w-full text-right px-4 py-3 hover:bg-white/5 flex items-center gap-3 transition border-b border-white/10 last:border-0"
                        >
                          <div className="w-10 h-10 bg-blue-500/15 rounded-full flex items-center justify-center text-blue-300 font-bold text-sm border border-blue-500/30">
                            {student.name.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-white truncate">{student.name}</p>
                            <p className="text-[11px] text-slate-400">
                              {student.code && `كود: ${student.code}`}
                              {student.group && ` • كروب: ${student.group}`}
                            </p>
                            <p className="text-[10px] mt-0.5 text-slate-500">
                              ✅ {sAttended} / ❌ {sAbsent} — {sPct}%
                            </p>
                          </div>
                          <span className="text-slate-500 text-xs"><ChevronLeft className="w-4 h-4" /></span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* 🎯 النتائج — بطاقة الطالب أو حالة فارغة */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              {showStudentCard && selectedStudentCard ? (
                <div className="bg-slate-800 rounded-xl border border-white/10 shadow-md overflow-hidden">
                  <div className="bg-blue-500/10 px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-500/15 rounded-full flex items-center justify-center text-lg font-bold border border-blue-500/30 text-blue-300">
                          {selectedStudentCard.student.name.charAt(0)}
                        </div>
                        <div>
                          <h4 className="font-bold text-sm text-white">{selectedStudentCard.student.name}</h4>
                          <p className="text-[11px] text-slate-400">
                            {selectedStudentCard.student.code && `كود: ${selectedStudentCard.student.code}`}
                            {selectedStudentCard.student.group && ` • كروب: ${selectedStudentCard.student.group}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedStudentCard.isPresentToday ? (
                          <div className="text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1 bg-green-500/15 text-green-300">
                            <CircleCheck className="w-3.5 h-3.5" /> حاضر اليوم
                          </div>
                        ) : selectedStudentCard.isAbsentToday ? (
                          <div className="text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1 bg-red-500/15 text-red-300">
                            <CircleX className="w-3.5 h-3.5" /> غائب اليوم
                          </div>
                        ) : (
                          <div className="text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1 bg-slate-500/15 text-slate-300">
                            <CircleX className="w-3.5 h-3.5" /> غير مسجل اليوم
                          </div>
                        )}
                        <button
                          onClick={clearStudentSearch}
                          aria-label="إغلاق بطاقة الطالب"
                          className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-red-500/20 text-red-400 hover:text-red-300 text-sm transition flex-shrink-0"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-x-reverse divide-white/10">
                    <div className="text-center py-3 px-2">
                      <p className="text-lg font-bold text-green-400">{selectedStudentCard.attendedCount}</p>
                      <p className="text-[10px] text-slate-400 flex items-center justify-center gap-1"><CircleCheck className="w-3 h-3" /> حضور</p>
                    </div>
                    <div className="text-center py-3 px-2">
                      <p className="text-lg font-bold text-red-400">{selectedStudentCard.absentCount}</p>
                      <p className="text-[10px] text-slate-400 flex items-center justify-center gap-1"><CircleX className="w-3 h-3" /> غياب</p>
                    </div>
                    <div className="text-center py-3 px-2">
                      <p className={`text-lg font-bold ${parseFloat(selectedStudentCard.percentage) >= 75 ? 'text-green-400' : parseFloat(selectedStudentCard.percentage) >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {selectedStudentCard.percentage}%
                      </p>
                      <p className="text-[10px] text-slate-400">النسبة</p>
                    </div>
                  </div>

                  <div className="border-t border-white/10">
                    <button
                      onClick={() => setShowDayDetails(v => !v)}
                      aria-expanded={showDayDetails}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-white/5 transition"
                    >
                      <span className="flex items-center gap-1.5"><ClipboardList className="w-3.5 h-3.5 text-blue-400" /> أيام الحضور والغياب</span>
                      <span className="text-slate-400">{showDayDetails ? '▲' : '▼'}</span>
                    </button>
                    {showDayDetails && (
                      <div className="px-3 pb-3 space-y-2.5 max-h-48 overflow-y-auto">
                        <div>
                          <p className="text-[11px] font-bold text-green-400 mb-1">✅ أيام الحضور ({selectedStudentCard.attendedDays.length})</p>
                          <div className="space-y-1">
                            {selectedStudentCard.attendedDays.length === 0 ? (
                              <p className="text-[11px] text-slate-500 px-1">لا يوجد</p>
                            ) : selectedStudentCard.attendedDays.map(d => (
                              <div key={d.date} className="flex items-center justify-between bg-green-500/10 border border-green-500/30 rounded-lg px-2.5 py-1.5 text-xs text-green-300">
                                <span>{d.label}</span>
                                <span className="text-[10px] text-green-400">{d.count} محاضرة</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-[11px] font-bold text-red-400 mb-1">❌ أيام الغياب ({selectedStudentCard.absentDays.length})</p>
                          <div className="space-y-1">
                            {selectedStudentCard.absentDays.length === 0 ? (
                              <p className="text-[11px] text-slate-500 px-1">لا يوجد</p>
                            ) : selectedStudentCard.absentDays.map(d => (
                              <div key={d.date} className="flex items-center justify-between bg-red-500/10 border border-red-500/30 rounded-lg px-2.5 py-1.5 text-xs text-red-300">
                                <span>{d.label}</span>
                                <span className="text-[10px] text-red-400">{d.count} محاضرة</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="p-3 bg-white/5 border-t border-white/10">
                    <button
                      onClick={() => setShowSessionsModal(true)}
                      className="w-full bg-gradient-to-l from-emerald-500 to-green-600 text-white text-[11px] py-2.5 rounded-lg hover:from-emerald-600 hover:to-green-700 transition font-medium shadow-sm flex items-center justify-center gap-1.5"
                    >
                      <ClipboardList className="w-3.5 h-3.5" /> سجلات الحضور ({selectedStudentCard.attendedSessions.length})
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-10 px-4">
                  <div className="mx-auto w-14 h-14 rounded-full bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center mb-4">
                    <Search className="w-7 h-7 text-indigo-300" />
                  </div>
                  <p className="font-bold text-white text-sm">ابحث عن طالب</p>
                  <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                    اكتب اسم الطالب أو كوده في البحث بالأعلى — ويطلع تقرير حضوره وغيابه فوراً.
                  </p>
                  {isAdmin && !dataLoaded && (
                    <p className="text-[11px] text-amber-300 mt-4 leading-relaxed">
                      💡 اضغط «⚡ تحميل بيانات الجامعة» في أعلى الشاشة لتحميل طلبة كل المراحل.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* نافذة منبثقة لكل السجلات */}
            {showSessionsModal && selectedStudentCard && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                   onMouseDown={() => setShowSessionsModal(false)}>
                <div className="bg-slate-900 rounded-2xl shadow-2xl border border-white/10 w-[calc(100%-16px)] max-h-[calc(100%-16px)] flex flex-col overflow-hidden"
                     onMouseDown={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/5 flex-shrink-0">
                    <span className="text-sm font-bold text-white flex items-center gap-1.5"><ClipboardList className="w-4 h-4" /> سجلات حضور {selectedStudentCard.student.name}</span>
                    <button
                      onClick={() => setShowSessionsModal(false)}
                      aria-label="إغلاق"
                      className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-red-500/20 text-red-400 hover:text-red-300 text-sm transition"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                    {selectedStudentCard.attendedSessions.length === 0 ? (
                      <div className="text-center py-8 text-slate-400 text-sm">لا توجد سجلات</div>
                    ) : (
                      selectedStudentCard.attendedSessions.map((as_, idx) => (
                        <div key={idx}
                             className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm ${
                               as_.present
                                 ? 'bg-green-500/10 border border-green-500/30 text-green-300'
                                 : as_.absent
                                 ? 'bg-red-500/10 border border-red-500/30 text-red-300'
                                 : 'bg-white/5 border border-white/10 text-slate-400'
                             }`}>
                          <span className="flex-shrink-0">{as_.present ? <CircleCheck className="w-5 h-5 text-green-400" /> : as_.absent ? <CircleX className="w-5 h-5 text-red-400" /> : <CircleX className="w-5 h-5 text-slate-400" />}</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold truncate">{as_.session.name}</p>
                            <p className={`text-[11px] mt-0.5 ${as_.present ? 'text-green-400' : as_.absent ? 'text-red-400' : 'text-slate-400'}`}>
                              {formatDateWithDay(as_.session._normalizedDate)}
                            </p>
                          </div>
                          {!as_.present && !as_.absent && (
                            <span className="text-[10px] font-medium text-slate-400 flex-shrink-0">غير مسجل</span>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                  <div className="px-4 py-2.5 border-t border-white/10 bg-white/5 flex-shrink-0 flex justify-between items-center">
                    <span className="text-[11px] text-slate-400 flex items-center gap-1">
                      <CircleCheck className="w-3 h-3" /> {selectedStudentCard.attendedCount} حضور • <CircleX className="w-3 h-3" /> {selectedStudentCard.absentCount} غياب
                    </span>
                    <button
                      onClick={() => setShowSessionsModal(false)}
                      className="px-4 py-1.5 bg-white/10 hover:bg-white/20 text-slate-300 text-xs rounded-lg transition font-medium"
                    >
                      إغلاق
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
});
