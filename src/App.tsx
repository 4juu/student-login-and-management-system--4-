import { useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { Student, AttendanceRecord, AttendanceSession, College, Stage } from './types/student';
import { User } from './types/user';

import './design-system.css';

import { OfflineModal } from './components/OfflineModal';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { usePeriodicSync } from './hooks/usePeriodicSync';
import { Login } from './components/Login';
import { StageSelector } from './components/StageSelector';
import { MorphingSquare } from './components/MorphingSquare';
import { TextScramble } from './components/TextScramble';
import { SendProgressModal } from './components/SendProgressModal';
import { StageBreadcrumb } from './components/StageBreadcrumb';
import { AdminTabBar } from './components/AdminTabBar';
import { ConfirmDialog } from './components/ConfirmDialog';
import { useConfirm } from './hooks/useConfirm';
import useRegistrationToken from './hooks/useRegistrationToken';
import useNavigation from './hooks/useNavigation';
import useSystemConfig from './hooks/useSystemConfig';
import { useAuth } from './hooks/useAuth';
import useInitialData from './hooks/useInitialData';
import { useAutoSaves } from './hooks/useAutoSaves';
import { useAbsenceSender } from './hooks/useAbsenceSender';
import { useUIStore } from './store/useUIStore';
import { useStageStore } from './store/useStageStore';
import { AppHeader } from './layouts/AppHeader';
import { StageContent } from './layouts/StageContent';
import { TabFallback, ModalFallback } from './layouts/Fallbacks';
import { TableSkeleton } from './components/loading/TableSkeleton';
import { StageSkeleton } from './components/loading/StageSkeleton';

// 🚀 تحميل متأخر للمكونات الثقيلة (تُحمَّل عند الحاجة فقط — خفض حجم الحزمة الأولية)
const SmartChatBot = lazy(() =>
  import('./components/SmartChatBot').then(m => ({ default: m.SmartChatBot }))
);
const TeacherManagement = lazy(() =>
  import('./components/TeacherManagement').then(m => ({ default: m.TeacherManagement }))
);
const Settings = lazy(() =>
  import('./components/Settings').then(m => ({ default: m.Settings }))
);
const ProfileSettings = lazy(() =>
  import('./components/ProfileSettings').then(m => ({ default: m.ProfileSettings }))
);
const CollegeManager = lazy(() =>
  import('./components/CollegeManager').then(m => ({ default: m.CollegeManager }))
);
const SelfEnrollPage = lazy(() =>
  import('./components/SelfRegister/SelfEnrollPage').then(m => ({ default: m.SelfEnrollPage }))
);
const SendEnrollLink = lazy(() =>
  import('./components/Admin/SendEnrollLink').then(m => ({ default: m.SendEnrollLink }))
);
const SendAttendanceLink = lazy(() =>
  import('./components/Admin/SendAttendanceLink').then(m => ({ default: m.SendAttendanceLink }))
);
const SendTestLink = lazy(() =>
  import('./components/Admin/SendTestLink').then(m => ({ default: m.SendTestLink }))
);
const FaceTestPage = lazy(() =>
  import('./components/face/FaceTestPage').then(m => ({ default: m.FaceTestPage }))
);
const LazyPendingRegistrations = lazy(() =>
  import('./components/Admin/PendingRegistrations').then(m => ({ default: m.PendingRegistrations }))
);
const StudentProfileModal = lazy(() =>
  import('./components/StudentProfile/StudentProfileModal').then(m => ({ default: m.StudentProfileModal }))
);

import { loadStageData, loadStudents as loadStudentsForStage, deleteStageData, flushAllPendingSaves, cancelAllPendingSaves, applyOutbox } from './firebase/dataService';
import { getCachedStageData, setCachedStageData } from './lib/stageCache';
import { TelegramConfig } from './types/telegram';

function App() {
  const { registerToken, testToken, attToken, tokenChecked, handleExitSelfRegister, handleExitTest, handleExitAtt } = useRegistrationToken();
  const { systemTitle, setSystemTitle, currentAcademicYear } = useSystemConfig();

  const {
    dataLoaded, setDataLoaded,
    stageSyncing, setStageSyncing,
    profileStudent, setProfileStudent,
    offlineModalDismissed, setOfflineModalDismissed,
  } = useUIStore();

  const {
    colleges, stages, setColleges, setStages,
    selectedCollegeId, setSelectedCollegeId,
    selectedStageId, setSelectedStageId,
    students, setStudents,
    records: attendanceRecords, setRecords: setAttendanceRecords,
    sessions, setSessions,
    activeSessionId, setActiveSessionId,
  } = useStageStore();

  const { isOffline, syncDone } = useOnlineStatus();

  // ⏱️ مزامنة دورية كل ساعة: تصفيية صندوق الأوفلاين والكتابات المعلقة
  usePeriodicSync(async () => {
    try {
      await applyOutbox();
    } catch {
      /* تجاهل — ستُعاد المحاولة في الدورة التالية */
    }
    try {
      await flushAllPendingSaves();
    } catch {
      /* تجاهل */
    }
  });

  useEffect(() => {
    if (isOffline) setOfflineModalDismissed(false);
  }, [isOffline]);

  const intentionalDeleteRef = useRef({
    students: false,
    records: false,
    sessions: false,
    colleges: false,
    stages: false,
  });
  const userModifiedStudentsRef = useRef(false);
  const processedAttendanceRef = useRef(new Set<string>());

  // مراجع لكسر تسلسل الاستدعاء بين useAuth و useInitialData
  const loadInitialDataRef = useRef<(user: User) => Promise<void>>(async () => {});
  const resetDataRef = useRef<() => void>(() => {});

  const auth = useAuth({
    resetData: () => resetDataRef.current(),
    loadInitialData: (user) => loadInitialDataRef.current(user),
    registerToken,
  });
  const {
    currentUser, loading, logoutConfirmOpen, loggingOut,
    handleLogin, handleLogout, confirmLogout, cancelLogout, handleUpdateProfile,
    isAdmin, isMainAdmin, isCollegeAdmin,
    getAdminUid, getTeacherId,
  } = auth;

  const {
    allTeachers, allStagesData, universityDataLoading, universityDataLoaded,
    telegramConfig,
    loadInitialData: loadInitialDataBase, loadAllAdminData,
    setTelegramConfig, setAllStagesData,
  } = useInitialData({ currentUser });

  const nav = useNavigation(currentUser);
  const {
    activeTab, setActiveTab,
    showSendLink, setShowSendLink,
    showTestLink, setShowTestLink,
    showAttendanceLink, setShowAttendanceLink,
    showPendingRegistrations, setShowPendingRegistrations,
    pendingCount,
  } = nav;

  const loadInitialData = useCallback(async (user: User) => {
    setDataLoaded(false);
    await loadInitialDataBase(user);
    setActiveTab('stage-selector');
    setTimeout(() => setDataLoaded(true), 500);
  }, [loadInitialDataBase, setActiveTab]);

  const resetData = useCallback(() => {
    setDataLoaded(false);
    setColleges([]);
    setStages([]);
    setStudents([]);
    setAttendanceRecords([]);
    setSessions([]);
    setActiveSessionId(null);
    setSelectedCollegeId(null);
    setSelectedStageId(null);
    setAllStagesData({});
    setActiveTab('stage-selector');
  }, [setColleges, setStages, setAllStagesData, setActiveTab]);

  loadInitialDataRef.current = loadInitialData;
  resetDataRef.current = resetData;

  const handleResetComplete = useCallback(() => resetDataRef.current(), []);

  useAutoSaves({
    currentUser,
    dataLoaded,
    colleges,
    stages,
    students,
    attendanceRecords,
    sessions,
    activeSessionId,
    selectedStageId,
    universityDataLoaded,
    intentionalDeleteRef,
    getAdminUid,
    getTeacherId,
    setAllStagesData,
  });

  useEffect(() => {
    const handleBeforeUnload = () => flushAllPendingSaves();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      flushAllPendingSaves();
    };
  }, []);

  const handleSelectStage = useCallback(async (collegeId: string, stageId: string) => {
    setSelectedCollegeId(collegeId);
    setSelectedStageId(stageId);
    setDataLoaded(false);
    setStageSyncing(true);
    setProfileStudent(null);
    userModifiedStudentsRef.current = false;

    const adminUid = getAdminUid();
    const teacherId = getTeacherId();

    try {
      const cached = await getCachedStageData(adminUid, currentAcademicYear, stageId, teacherId);
      if (cached) {
        if (!userModifiedStudentsRef.current) setStudents(cached.students);
        setAttendanceRecords(cached.records);
        setSessions(cached.sessions);
        setActiveSessionId(cached.activeSessionId);
        setActiveTab('sessions');
        setDataLoaded(true);
      }
    } catch {
      // تجاهل - نعرض شاشة التحميل العادية
    }

    try {
      const data = await loadStageData(adminUid, stageId, teacherId);

      if (!userModifiedStudentsRef.current) setStudents(data.students);
      setAttendanceRecords(data.records);
      setSessions(data.sessions);
      setActiveSessionId(data.activeSessionId);
      setActiveTab('sessions');
      setDataLoaded(true);

      void setCachedStageData(adminUid, currentAcademicYear, stageId, teacherId, data);

      const { loadTelegramConfig } = await import('./firebase/dataService');
      const config = await loadTelegramConfig(adminUid);
      setTelegramConfig(config);
    } catch (e) {
      console.error('Error loading stage:', e);
    } finally {
      setStageSyncing(false);
      setTimeout(() => setDataLoaded(true), 300);
    }
  }, [currentUser, currentAcademicYear, getAdminUid, getTeacherId, setActiveTab, setTelegramConfig]);

  const handleBackToStages = () => {
    flushAllPendingSaves();
    processedAttendanceRef.current.clear();
    markAbsentInFlightRef.current.clear();
    setSelectedCollegeId(null);
    setSelectedStageId(null);
    setProfileStudent(null);
    setStudents([]);
    setAttendanceRecords([]);
    setSessions([]);
    setActiveSessionId(null);
    setActiveTab('stage-selector');
  };

  const handleAddCollege = useCallback((college: College) => setColleges(prev => [...prev, college]), [setColleges]);

  const handleDeleteCollege = useCallback((collegeId: string) => {
    intentionalDeleteRef.current.colleges = true;
    intentionalDeleteRef.current.stages = true;
    setColleges(prev => prev.filter(c => c.id !== collegeId));
    const stagesToDelete = stages.filter(s => s.collegeId === collegeId);
    setStages(prev => prev.filter(s => s.collegeId !== collegeId));
    stagesToDelete.forEach(stage => {
      deleteStageData(currentUser!.uid, stage.id);
      setAllStagesData(prev => { const updated = { ...prev }; delete updated[stage.id]; return updated; });
    });
  }, [stages, currentUser, setColleges, setStages, setAllStagesData]);

  const handleAddStage = useCallback((stage: Stage) => setStages(prev => [...prev, stage]), [setStages]);

  const handleDeleteStage = useCallback((stageId: string) => {
    intentionalDeleteRef.current.stages = true;
    setStages(prev => prev.filter(s => s.id !== stageId));
    deleteStageData(currentUser!.uid, stageId);
    setAllStagesData(prev => { const updated = { ...prev }; delete updated[stageId]; return updated; });
  }, [currentUser, setStages, setAllStagesData]);

  const handleAddStudent = useCallback((student: Student) => {
    userModifiedStudentsRef.current = true;
    setStudents(prev => [...prev, student]);
  }, []);

  const handleAddMultipleStudents = useCallback((newStudents: Student[]) => {
    userModifiedStudentsRef.current = true;
    setStudents(prev => [...prev, ...newStudents]);
  }, []);

  const handleUpdateStudent = useCallback((id: string, updates: Partial<Student>) => {
    userModifiedStudentsRef.current = true;
    setStudents(prev =>
      prev.map(student => {
        if (student.id !== id) return student;
        const merged: any = { ...student, ...updates };
        Object.keys(updates).forEach(key => {
          const value = (updates as any)[key];
          if (value === undefined || value === null || value === '') delete merged[key];
        });
        return merged as Student;
      })
    );
  }, []);

  const { confirm: confirmAction, ConfirmDialog: ConfirmDialogRoot } = useConfirm();

  const handleDeleteStudent = useCallback(async (id: string) => {
    const ok = await confirmAction({
      title: 'حذف طالب',
      message: 'هل أنت متأكد من حذف هذا الطالب؟',
      confirmLabel: 'حذف',
    });
    if (ok) {
      userModifiedStudentsRef.current = true;
      intentionalDeleteRef.current.students = true;
      intentionalDeleteRef.current.records = true;
      setStudents(prev => prev.filter(s => s.id !== id));
      setAttendanceRecords(prev => prev.filter(r => r.studentId !== id));
    }
  }, [confirmAction]);

  const handleDeleteSelectedStudents = useCallback((ids: string[]) => {
    userModifiedStudentsRef.current = true;
    intentionalDeleteRef.current.students = true;
    intentionalDeleteRef.current.records = true;
    setStudents(prev => prev.filter(s => !ids.includes(s.id)));
    setAttendanceRecords(prev => prev.filter(r => !ids.includes(r.studentId)));
  }, []);

  const handleSortByName = useCallback(() => {
    setStudents(prev => [...prev].sort((a, b) => a.name.localeCompare(b.name, 'ar')));
  }, []);

  const handleSortByGroup = useCallback(() => {
    setStudents(prev => [...prev].sort((a, b) => {
      const ga = a.group || 'ZZZ';
      const gb = b.group || 'ZZZ';
      const la = ga.charAt(0).toUpperCase();
      const lb = gb.charAt(0).toUpperCase();
      if (la !== lb) return la.localeCompare(lb);
      const na = parseInt(ga.slice(1)) || 0;
      const nb = parseInt(gb.slice(1)) || 0;
      if (na !== nb) return na - nb;
      return a.name.localeCompare(b.name, 'ar');
    }));
  }, []);

  const handleAttendanceRecord = useCallback((record: AttendanceRecord) => {
    if (record.status === 'present') {
      const cacheKey = `${record.sessionId}_${record.studentId}`;
      if (processedAttendanceRef.current.has(cacheKey)) return;
      processedAttendanceRef.current.add(cacheKey);
      setAttendanceRecords(prev => {
        const filtered = prev.filter(
          r => !(r.sessionId === record.sessionId && r.studentId === record.studentId && r.status === 'absent')
        );
        return [...filtered, record];
      });
    } else {
      setAttendanceRecords(prev => [...prev, record]);
    }
  }, []);

  const {
    sendModalOpen, setSendModalOpen, sendGroups, sendSubjectName,
    isSending, sendDoneCount, sendTotalGroups, currentSendingSessionId,
    absenceSendLogs, completedGroupData, markAbsentInFlightRef, handleMarkAbsent,
  } = useAbsenceSender({
    stages, students, attendanceRecords, selectedStageId, currentUser,
    telegramConfig, currentAcademicYear, setAttendanceRecords,
  });

  const handleClearRecords = useCallback(() => {
    cancelAllPendingSaves();
    intentionalDeleteRef.current.records = true;
    markAbsentInFlightRef.current.clear();
    setAttendanceRecords([]);
  }, [markAbsentInFlightRef]);

  const handleUpdateRecord = useCallback((recordId: string, updates: Partial<AttendanceRecord>) => {
    setAttendanceRecords(prev => prev.map(r => r.id === recordId ? { ...r, ...updates } : r));
  }, []);

  const handleDeleteRecord = useCallback((recordId: string) => {
    intentionalDeleteRef.current.records = true;
    setAttendanceRecords(prev => prev.filter(r => r.id !== recordId));
  }, []);

  const handleCreateSession = useCallback((session: AttendanceSession) => {
    setSessions(prev => [...prev.map(s => ({ ...s, isActive: false })), session]);
    setActiveSessionId(session.id);
  }, []);

  const handleSelectSession = useCallback((sessionId: string) => {
    setSessions(prev => prev.map(s => ({ ...s, isActive: s.id === sessionId })));
    setActiveSessionId(sessionId);
  }, []);

  const handleRenameSession = useCallback((sessionId: string, newName: string) => {
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, name: newName } : s));
  }, []);

  const handleDeleteSession = useCallback((sessionId: string) => {
    intentionalDeleteRef.current.sessions = true;
    intentionalDeleteRef.current.records = true;
    markAbsentInFlightRef.current.clear();
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    setAttendanceRecords(prev => prev.filter(r => r.sessionId !== sessionId));
    if (activeSessionId === sessionId) setActiveSessionId(null);
  }, [activeSessionId, markAbsentInFlightRef]);

  const handleTelegramConfigChange = useCallback((config: TelegramConfig | null) => setTelegramConfig(config), [setTelegramConfig]);

  const attendanceLinkScope = useMemo(() => {
    if (!currentUser || isMainAdmin) {
      return { colleges, stages };
    }
    if (isCollegeAdmin) {
      const collegeId = currentUser.collegeId;
      return {
        colleges: collegeId ? colleges.filter(c => c.id === collegeId) : [],
        stages: collegeId ? stages.filter(s => s.collegeId === collegeId) : [],
      };
    }
    const teacherCollegeId = currentUser.collegeId;
    const allowed = currentUser.permissions?.allowedStages || {};
    if (teacherCollegeId) {
      const allowedIds = allowed[teacherCollegeId] || [];
      return {
        colleges: allowedIds.length > 0 ? colleges.filter(c => c.id === teacherCollegeId) : [],
        stages: allowedIds.length > 0 ? stages.filter(s => s.collegeId === teacherCollegeId && allowedIds.includes(s.id)) : [],
      };
    }
    const grantedCollegeIds = Object.keys(allowed).filter(id => (allowed[id] || []).length > 0);
    const grantedStageIds = new Set(Object.values(allowed).flat());
    return {
      colleges: colleges.filter(c => grantedCollegeIds.includes(c.id)),
      stages: stages.filter(s => grantedStageIds.has(s.id)),
    };
  }, [currentUser, isMainAdmin, isCollegeAdmin, colleges, stages]);

  if (registerToken) {
    return (
      <Suspense fallback={
        <div className="min-h-screen bg-[#0B1220] p-4 md:p-8" dir="rtl">
          <StageSkeleton />
        </div>
      }>
        <SelfEnrollPage token={registerToken} onExit={handleExitSelfRegister} />
      </Suspense>
    );
  }

  if (attToken) {
    return (
      <Suspense fallback={
        <div className="min-h-screen bg-[#0B1220] p-4 md:p-8" dir="rtl">
          <StageSkeleton />
        </div>
      }>
        <SelfEnrollPage token={attToken} onExit={handleExitAtt} />
      </Suspense>
    );
  }

  if (testToken) {
    return (
      <Suspense fallback={
        <div className="min-h-screen bg-[#0B1220] p-4 md:p-8" dir="rtl">
          <StageSkeleton />
        </div>
      }>
        <FaceTestPage testToken={testToken} onExit={handleExitTest} />
      </Suspense>
    );
  }

  if (loading || !tokenChecked) {
    return (
      <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-5">
          <MorphingSquare />
          <p className="text-sm text-slate-400 font-medium">جاري تحميل النظام…</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#0B1220]">
        <Login onLogin={handleLogin} />
      </div>
    );
  }

  const selectedStage = stages.find(s => s.id === selectedStageId);
  const selectedCollege = colleges.find(c => c.id === selectedCollegeId);

  return (
    <div className="min-h-screen bg-[#0B1220]" dir="rtl">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:start-4 focus:z-[9999] focus:bg-white focus:text-black focus:px-4 focus:py-2 focus:rounded-lg focus:font-bold">
        تخطي إلى المحتوى الرئيسي
      </a>
      <div className="container mx-auto px-3 md:px-4 py-3 md:py-6">
        <AppHeader
          systemTitle={systemTitle}
          currentAcademicYear={currentAcademicYear}
          isOffline={isOffline}
          syncDone={syncDone}
          onLogout={handleLogout}
        />

        {selectedStage && (
          <StageBreadcrumb
            selectedCollege={selectedCollege}
            selectedStage={selectedStage}
            stageSyncing={stageSyncing}
            onBack={handleBackToStages}
          />
        )}

        <main id="main-content">
        {!selectedStageId && (
          <div className="max-w-6xl mx-auto">
            <AdminTabBar
              activeTab={activeTab}
              isMainAdmin={isMainAdmin}
              isCollegeAdmin={isCollegeAdmin}
              pendingCount={pendingCount}
              onTabChange={setActiveTab}
              onOpenSendLink={() => setShowSendLink(true)}
              onOpenTestLink={() => setShowTestLink(true)}
              onOpenPending={() => setShowPendingRegistrations(true)}
            />

            {isMainAdmin && activeTab === 'stage-selector' && (
              <div className="mb-6 p-4 glass-card-sm">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">📊</span>
                    <div>
                      <h3 className="font-bold text-white">بيانات الجامعة الشاملة</h3>
                      <p className="text-xs text-white/60">
                        {universityDataLoaded
                          ? `✅ تم تحميل بيانات ${Object.keys(allStagesData).length} مرحلة`
                          : 'حمّل بيانات كل الكليات والمراحل للتحليلات والتقارير الشاملة'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={loadAllAdminData}
                    disabled={universityDataLoading || stages.length === 0}
                    className={`px-5 py-2.5 rounded-lg font-bold text-white transition shadow-md btn-base ${
                      universityDataLoading
                        ? 'opacity-60 cursor-wait'
                        : universityDataLoaded
                        ? 'btn-primary'
                        : 'btn-primary'
                    } ${stages.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {universityDataLoading ? '⏳ جاري التحميل...' : universityDataLoaded ? '🔄 تحديث البيانات' : '⚡ تحميل بيانات الجامعة'}
                  </button>
                </div>
              </div>
            )}

            <div key={`tab-${activeTab}`} className="animate-pageEnter">
              {activeTab === 'stage-selector' && (
                <StageSelector user={currentUser} colleges={colleges} stages={stages} onSelect={handleSelectStage} />
              )}
              {activeTab === 'colleges' && isMainAdmin && (
                <Suspense fallback={<TabFallback />}>
                  <CollegeManager
                    colleges={colleges} stages={stages} adminUid={currentUser.uid}
                    onAddCollege={handleAddCollege} onDeleteCollege={handleDeleteCollege}
                    onAddStage={handleAddStage} onDeleteStage={handleDeleteStage}
                    onSelectStage={handleSelectStage}
                  />
                </Suspense>
              )}
              {activeTab === 'teachers' && (isMainAdmin || isCollegeAdmin) && (
                <Suspense fallback={<TableSkeleton />}>
                  <TeacherManagement
                    currentUser={currentUser}
                    colleges={isCollegeAdmin ? colleges.filter(c => c.id === currentUser.collegeId) : colleges}
                    stages={isCollegeAdmin ? stages.filter(s => s.collegeId === currentUser.collegeId) : stages}
                  />
                </Suspense>
              )}
              {activeTab === 'system-settings' && isMainAdmin && (
                <Suspense fallback={<TabFallback />}>
                  <Settings
                    students={students} attendanceRecords={attendanceRecords} currentUser={currentUser}
                    onResetComplete={handleResetComplete}
                    stages={stages} colleges={colleges} onTelegramConfigChange={handleTelegramConfigChange}
                    systemTitle={systemTitle} onSystemTitleChange={setSystemTitle}
                  />
                </Suspense>
              )}
              {activeTab === 'profile' && (
                <Suspense fallback={<TabFallback />}>
                  <ProfileSettings currentUser={currentUser} onUpdateProfile={handleUpdateProfile} />
                </Suspense>
              )}
            </div>
          </div>
        )}

        {selectedStageId && (
          <StageContent
            onCreateSession={handleCreateSession}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
            onRenameSession={handleRenameSession}
            onMarkAbsent={handleMarkAbsent}
            onAttendanceRecord={handleAttendanceRecord}
            onUpdateStudent={handleUpdateStudent}
            onAddStudent={handleAddStudent}
            onAddMultipleStudents={handleAddMultipleStudents}
            onDeleteStudent={handleDeleteStudent}
            onDeleteSelectedStudents={handleDeleteSelectedStudents}
            onSortByName={handleSortByName}
            onSortByGroup={handleSortByGroup}
            onClearRecords={handleClearRecords}
            onUpdateRecord={handleUpdateRecord}
            onDeleteRecord={handleDeleteRecord}
            absenceSendLogs={absenceSendLogs}
            isSending={isSending}
            currentSendingSessionId={currentSendingSessionId}
            sendGroups={sendGroups}
            sendDoneCount={sendDoneCount}
            sendTotalGroups={sendTotalGroups}
            completedGroupData={completedGroupData}
          />
        )}

        </main>

        {/* ✨ Footer */}
        <div className="mt-12 pt-6 border-t border-white/10 text-center text-slate-500">
          <p className="text-sm">{systemTitle} - {new Date().getFullYear()}</p>
          <div className="mt-2 flex justify-center">
            <TextScramble text="BY - PH. Mujtaba Haitham" />
          </div>
        </div>
      </div>

      {/* ✨ الشات بوت الذكي */}
      {(!(currentUser?.role === 'teacher') || !!selectedStageId) && (
        <Suspense fallback={null}>
          <SmartChatBot
            user={currentUser} colleges={colleges} stages={stages}
            currentCollegeId={selectedCollegeId} currentStageId={selectedStageId}
            students={students} records={attendanceRecords} sessions={sessions}
            activeSessionId={activeSessionId}
            allTeachers={isMainAdmin ? allTeachers : []}
            allStagesData={isMainAdmin && universityDataLoaded ? allStagesData : {}}
            onRequestUniversityData={isAdmin ? loadAllAdminData : undefined}
            universityDataLoaded={universityDataLoaded}
            universityDataLoading={universityDataLoading}
          />
        </Suspense>
      )}

      {showSendLink && currentUser && isMainAdmin && (
        <Suspense fallback={<ModalFallback />}>
          <SendEnrollLink
            adminUid={currentUser.uid}
            colleges={colleges}
            stages={stages}
            loadStudents={async (stageId: string) => loadStudentsForStage(getAdminUid(), stageId)}
            onClose={() => setShowSendLink(false)}
          />
        </Suspense>
      )}

      {showTestLink && currentUser && isMainAdmin && (
        <Suspense fallback={<ModalFallback />}>
          <SendTestLink
            adminUid={currentUser.uid}
            colleges={colleges}
            stages={stages}
            onClose={() => setShowTestLink(false)}
          />
        </Suspense>
      )}

      {showAttendanceLink && currentUser && (
        <Suspense fallback={<ModalFallback />}>
          <SendAttendanceLink
            adminUid={getAdminUid()}
            colleges={attendanceLinkScope.colleges}
            stages={attendanceLinkScope.stages}
            loadStudents={async (stageId: string) => loadStudentsForStage(getAdminUid(), stageId)}
            telegramConfig={telegramConfig}
            subjectName={currentUser?.bio || currentUser?.displayName || 'المادة'}
            teacherId={getTeacherId()}
            onClose={() => setShowAttendanceLink(false)}
          />
        </Suspense>
      )}

      {showPendingRegistrations && currentUser && (isMainAdmin || isCollegeAdmin) && (
        <Suspense fallback={<ModalFallback />}>
          <LazyPendingRegistrations
            adminUid={currentUser.uid}
            dataAdminUid={isCollegeAdmin ? getAdminUid() : undefined}
            onClose={() => setShowPendingRegistrations(false)}
          />
        </Suspense>
      )}

      {/* 🚀 نافذة إرسال الغيابات */}
      <SendProgressModal
        isOpen={sendModalOpen}
        subjectName={sendSubjectName}
        groups={sendGroups}
        onHide={() => setSendModalOpen(false)}
        isSending={isSending}
        totalDone={sendDoneCount}
        totalGroups={sendTotalGroups}
      />

      {/* 📋 ملف الطالب (يُحمَّل عند الطلب) */}
      {profileStudent && (
        <Suspense fallback={<ModalFallback />}>
          <StudentProfileModal
            student={profileStudent}
            records={attendanceRecords}
            sessions={sessions}
            stageName={selectedStage?.name}
            onClose={() => setProfileStudent(null)}
          />
        </Suspense>
      )}

      {/* 🌐 نافذة فقدان الاتصال بالإنترنت */}
      <OfflineModal
        open={isOffline && !offlineModalDismissed}
        onDismiss={() => setOfflineModalDismissed(true)}
      />

      {/* 🔒 تأكيد تسجيل الخروج */}
      <ConfirmDialog
        open={logoutConfirmOpen}
        title="تسجيل الخروج"
        message="هل أنت متأكد من تسجيل الخروج؟ سيتم حفظ كل التغييرات قبل الخروج."
        confirmLabel={loggingOut ? 'جاري الخروج...' : 'تسجيل الخروج'}
        cancelLabel="إبقاء الجلسة"
        onConfirm={confirmLogout}
        onCancel={cancelLogout}
      />

      {/* 🔒 تأكيدات عامة (حذف الطالب وغيرها) */}
      {ConfirmDialogRoot}
    </div>
  );
}

export default App;
