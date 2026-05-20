import { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { Student, AttendanceRecord, AttendanceSession, College, Stage } from './types/student';
import { User } from './types/user';
import { StudentManager } from './components/StudentManager';
import { StudentsViewer } from './components/StudentsViewer';
import { AttendanceLogin } from './components/AttendanceLogin';
import { AttendanceRecords } from './components/AttendanceRecords';
import { SessionManager } from './components/SessionManager';
import { Login } from './components/Login';
import { TeacherManagement } from './components/TeacherManagement';
import { ProfileSettings } from './components/ProfileSettings';
import { CollegeManager } from './components/CollegeManager';
import { StageSelector } from './components/StageSelector';
import { SmartChatBot } from './components/SmartChatBot';
import { auth } from './firebase/config';
import { signIn, signOut } from './firebase/authService';
import {
  loadColleges,
  saveColleges,
  loadStages,
  saveStages,
  loadStageData,
  saveStudents,
  saveAttendanceRecords,
  saveSessions,
  saveActiveSession,
  saveUserData,
  deleteStageData,
  flushAllPendingSaves,
} from './firebase/dataService';

type Tab = 'stage-selector' | 'colleges' | 'login' | 'manage' | 'records' | 'settings' | 'sessions' | 'teachers' | 'profile';

interface AllStagesData {
  [stageId: string]: {
    students: Student[];
    records: AttendanceRecord[];
    sessions: AttendanceSession[];
  };
}

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataLoaded, setDataLoaded] = useState(false);

  const [colleges, setColleges] = useState<College[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);

  const [selectedCollegeId, setSelectedCollegeId] = useState<string | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);

  const [students, setStudents] = useState<Student[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const [allTeachers, setAllTeachers] = useState<User[]>([]);
  const [allStagesData, setAllStagesData] = useState<AllStagesData>({});

  // 🆕 حالة تحميل بيانات الجامعة الشاملة (للأدمن فقط - يدوي)
  const [universityDataLoading, setUniversityDataLoading] = useState(false);
  const [universityDataLoaded, setUniversityDataLoaded] = useState(false);

  const [activeTab, setActiveTab] = useState<Tab>('stage-selector');

  const intentionalDeleteRef = useRef({
    students: false,
    records: false,
    sessions: false,
    colleges: false,
    stages: false,
  });

  // 🔑 معرف الأدمن
  const getAdminUid = (): string => {
    if (!currentUser) return '';
    if (currentUser.role === 'admin') return currentUser.uid;
    return currentUser.adminId || currentUser.uid;
  };

  // 🆕 معرف التدريسي
  const getTeacherId = (): string => {
    return currentUser?.uid || '';
  };

  // 🆕 احفظ كل التعديلات المعلقة قبل إغلاق الصفحة
  useEffect(() => {
    const handleBeforeUnload = () => {
      flushAllPendingSaves();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      flushAllPendingSaves();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const { ref: dbRef, get, set } = await import('firebase/database');
          const { database } = await import('./firebase/config');
          const userRef = dbRef(database, `users/${firebaseUser.uid}`);
          const snapshot = await get(userRef);

          let userData: User;
          if (snapshot.exists()) {
            userData = snapshot.val();
          } else {
            userData = {
              uid: firebaseUser.uid,
              email: firebaseUser.email || '',
              displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
              role: firebaseUser.email?.toLowerCase() === 'mujtabahaitham@gmail.com' ? 'admin' : 'teacher',
              createdAt: firebaseUser.metadata.creationTime || new Date().toISOString(),
              lastLogin: new Date().toISOString()
            };
            await set(userRef, userData);
          }

          setCurrentUser(userData);
          await loadInitialData(userData);
        } catch (error) {
          console.error('❌ Error loading user:', error);
          setCurrentUser(null);
        }
      } else {
        setCurrentUser(null);
        resetData();
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 🚀 تحميل البيانات الأساسية فقط (كليات + مراحل)
  // 🚀 لا نحمل بيانات الجامعة الشاملة تلقائياً!
  const loadInitialData = async (user: User) => {
    setDataLoaded(false);
    try {
      const adminUid = user.role === 'admin' ? user.uid : (user.adminId || user.uid);

      const [collegesData, stagesData] = await Promise.all([
        loadColleges(adminUid),
        loadStages(adminUid),
      ]);

      setColleges(collegesData);
      setStages(stagesData);
      setActiveTab('stage-selector');

      // ✅ تحميل قائمة التدريسيين فقط (خفيف جداً)
      if (user.role === 'admin') {
        try {
          const { ref: dbRef, get } = await import('firebase/database');
          const { database } = await import('./firebase/config');
          const usersSnap = await get(dbRef(database, 'users'));
          if (usersSnap.exists()) {
            const teachersList = (Object.values(usersSnap.val()) as User[]).filter(
              u => u.role === 'teacher' && u.adminId === user.uid
            );
            setAllTeachers(teachersList);
          }
        } catch (e) {
          console.warn('فشل تحميل قائمة التدريسيين:', e);
        }
      }
    } catch (error) {
      console.error('Error loading initial data:', error);
    } finally {
      setTimeout(() => setDataLoaded(true), 500);
    }
  };

  // 🆕 تحميل بيانات الجامعة الشاملة - يدوي فقط عند الطلب
  const loadAllAdminData = async () => {
    if (!currentUser || currentUser.role !== 'admin') return;

    setUniversityDataLoading(true);
    try {
      const { ref: dbRef, get } = await import('firebase/database');
      const { database } = await import('./firebase/config');
      const adminUid = currentUser.uid;

      const allUserIds = [adminUid, ...allTeachers.map(t => t.uid)];
      const stagesDataMap: AllStagesData = {};

      await Promise.all(
        stages.map(async (stage) => {
          try {
            const studentsSnap = await get(
              dbRef(database, `userData/${adminUid}/stageData/${stage.id}/students`)
            );
            let stageStudents: Student[] = [];
            if (studentsSnap.exists()) {
              const data = studentsSnap.val();
              stageStudents = Array.isArray(data) ? data : Object.values(data);
            }

            const allRecords: AttendanceRecord[] = [];
            const allSessions: AttendanceSession[] = [];

            await Promise.all(
              allUserIds.map(async (userId) => {
                try {
                  const recSnap = await get(
                    dbRef(
                      database,
                      `userData/${adminUid}/stageData/${stage.id}/teacherRecords/${userId}/records`
                    )
                  );
                  if (recSnap.exists()) {
                    const data = recSnap.val();
                    const arr: AttendanceRecord[] = Array.isArray(data)
                      ? data
                      : Object.values(data);
                    allRecords.push(...arr);
                  }

                  const sesSnap = await get(
                    dbRef(
                      database,
                      `userData/${adminUid}/stageData/${stage.id}/teacherRecords/${userId}/sessions`
                    )
                  );
                  if (sesSnap.exists()) {
                    const data = sesSnap.val();
                    const arr: AttendanceSession[] = Array.isArray(data)
                      ? data
                      : Object.values(data);
                    allSessions.push(...arr);
                  }
                } catch (e) {
                  console.warn(`فشل جلب بيانات المستخدم ${userId} للمرحلة ${stage.id}`);
                }
              })
            );

            stagesDataMap[stage.id] = {
              students: stageStudents,
              records: allRecords,
              sessions: allSessions,
            };
          } catch (e) {
            console.warn(`فشل تحميل بيانات المرحلة ${stage.id}:`, e);
          }
        })
      );

      setAllStagesData(stagesDataMap);
      setUniversityDataLoaded(true);
    } catch (error) {
      console.error('❌ خطأ في تحميل بيانات الأدمن الشاملة:', error);
      alert('❌ فشل تحميل بيانات الجامعة. حاول مرة ثانية.');
    } finally {
      setUniversityDataLoading(false);
    }
  };

  const handleSelectStage = async (collegeId: string, stageId: string) => {
    setSelectedCollegeId(collegeId);
    setSelectedStageId(stageId);
    setDataLoaded(false);

    try {
      const adminUid = getAdminUid();
      const teacherId = getTeacherId();
      const data = await loadStageData(adminUid, stageId, teacherId);
      setStudents(data.students);
      setAttendanceRecords(data.records);
      setSessions(data.sessions);
      setActiveSessionId(data.activeSessionId);
      setActiveTab('sessions');
    } catch (e) {
      console.error('Error loading stage:', e);
    } finally {
      setTimeout(() => setDataLoaded(true), 300);
    }
  };

  const handleBackToStages = () => {
    // 🆕 احفظ التعديلات المعلقة قبل المغادرة
    flushAllPendingSaves();

    setSelectedCollegeId(null);
    setSelectedStageId(null);
    setStudents([]);
    setAttendanceRecords([]);
    setSessions([]);
    setActiveSessionId(null);
    setActiveTab('stage-selector');
  };

  const resetData = () => {
    setDataLoaded(false);
    setColleges([]);
    setStages([]);
    setStudents([]);
    setAttendanceRecords([]);
    setSessions([]);
    setActiveSessionId(null);
    setSelectedCollegeId(null);
    setSelectedStageId(null);
    setAllTeachers([]);
    setAllStagesData({});
    setUniversityDataLoaded(false);
    setActiveTab('stage-selector');
  };

  // ✅ مشترك - الأدمن فقط يحفظ الكليات (مع Debounce)
  useEffect(() => {
    if (currentUser?.role === 'admin' && dataLoaded) {
      const force = intentionalDeleteRef.current.colleges;
      saveColleges(currentUser.uid, colleges, force);
      if (force) intentionalDeleteRef.current.colleges = false;
    }
  }, [colleges, currentUser, dataLoaded]);

  // ✅ مشترك - الأدمن فقط يحفظ المراحل (مع Debounce)
  useEffect(() => {
    if (currentUser?.role === 'admin' && dataLoaded) {
      const force = intentionalDeleteRef.current.stages;
      saveStages(currentUser.uid, stages, force);
      if (force) intentionalDeleteRef.current.stages = false;
    }
  }, [stages, currentUser, dataLoaded]);

  // ✅ الطلاب مشتركون (مع Debounce)
  useEffect(() => {
    if (currentUser && dataLoaded && selectedStageId) {
      const force = intentionalDeleteRef.current.students;
      saveStudents(getAdminUid(), selectedStageId, students, force);
      if (force) intentionalDeleteRef.current.students = false;

      if (currentUser.role === 'admin' && universityDataLoaded) {
        setAllStagesData(prev => ({
          ...prev,
          [selectedStageId]: {
            ...(prev[selectedStageId] || { records: [], sessions: [] }),
            students,
          },
        }));
      }
    }
  }, [students, currentUser, dataLoaded, selectedStageId, universityDataLoaded]);

  // 🆕 منفصل لكل تدريسي (مع Debounce)
  useEffect(() => {
    if (currentUser && dataLoaded && selectedStageId) {
      const force = intentionalDeleteRef.current.records;
      saveAttendanceRecords(
        getAdminUid(),
        selectedStageId,
        getTeacherId(),
        attendanceRecords,
        force
      );
      if (force) intentionalDeleteRef.current.records = false;

      if (currentUser.role === 'admin' && universityDataLoaded) {
        setAllStagesData(prev => ({
          ...prev,
          [selectedStageId]: {
            ...(prev[selectedStageId] || { students: [], sessions: [] }),
            records: attendanceRecords,
          },
        }));
      }
    }
  }, [attendanceRecords, currentUser, dataLoaded, selectedStageId, universityDataLoaded]);

  // 🆕 منفصل لكل تدريسي (مع Debounce)
  useEffect(() => {
    if (currentUser && dataLoaded && selectedStageId) {
      const force = intentionalDeleteRef.current.sessions;
      saveSessions(
        getAdminUid(),
        selectedStageId,
        getTeacherId(),
        sessions,
        force
      );
      if (force) intentionalDeleteRef.current.sessions = false;

      if (currentUser.role === 'admin' && universityDataLoaded) {
        setAllStagesData(prev => ({
          ...prev,
          [selectedStageId]: {
            ...(prev[selectedStageId] || { students: [], records: [] }),
            sessions,
          },
        }));
      }
    }
  }, [sessions, currentUser, dataLoaded, selectedStageId, universityDataLoaded]);

  // 🆕 الجلسة النشطة (فوري - مهم)
  useEffect(() => {
    if (currentUser && dataLoaded && selectedStageId) {
      saveActiveSession(
        getAdminUid(),
        selectedStageId,
        getTeacherId(),
        activeSessionId
      );
    }
  }, [activeSessionId, currentUser, dataLoaded, selectedStageId]);

  useEffect(() => {
    if (currentUser && dataLoaded) {
      saveUserData(currentUser.uid, currentUser);
    }
  }, [currentUser, dataLoaded]);

  const handleLogin = async (email: string, password: string) => {
    const user = await signIn(email, password);
    setCurrentUser(user);
  };

  const handleLogout = async () => {
    if (window.confirm('هل أنت متأكد من تسجيل الخروج؟')) {
      flushAllPendingSaves();
      await signOut();
      setCurrentUser(null);
      resetData();
    }
  };

  const handleAddCollege = (college: College) => setColleges(prev => [...prev, college]);

  const handleDeleteCollege = (collegeId: string) => {
    intentionalDeleteRef.current.colleges = true;
    intentionalDeleteRef.current.stages = true;

    setColleges(prev => prev.filter(c => c.id !== collegeId));
    const stagesToDelete = stages.filter(s => s.collegeId === collegeId);
    setStages(prev => prev.filter(s => s.collegeId !== collegeId));

    stagesToDelete.forEach(stage => {
      deleteStageData(currentUser!.uid, stage.id);
      setAllStagesData(prev => {
        const updated = { ...prev };
        delete updated[stage.id];
        return updated;
      });
    });
  };

  const handleAddStage = (stage: Stage) => setStages(prev => [...prev, stage]);

  const handleDeleteStage = (stageId: string) => {
    intentionalDeleteRef.current.stages = true;
    setStages(prev => prev.filter(s => s.id !== stageId));
    deleteStageData(currentUser!.uid, stageId);
    setAllStagesData(prev => {
      const updated = { ...prev };
      delete updated[stageId];
      return updated;
    });
  };

  const handleAddStudent = (student: Student) => setStudents(prev => [...prev, student]);

  // ✅ تحديث طالب (يدعم الحذف الصريح للحقول)
  const handleUpdateStudent = (id: string, updates: Partial<Student>) => {
    setStudents(prev =>
      prev.map(student => {
        if (student.id !== id) return student;
        const merged: any = { ...student, ...updates };
        Object.keys(updates).forEach(key => {
          const value = (updates as any)[key];
          if (value === undefined || value === null || value === '') {
            delete merged[key];
          }
        });
        return merged as Student;
      })
    );
  };

  const handleDeleteStudent = (id: string) => {
    if (window.confirm('هل أنت متأكد من حذف هذا الطالب؟')) {
      intentionalDeleteRef.current.students = true;
      setStudents(prev => prev.filter(s => s.id !== id));
    }
  };

  const handleDeleteSelectedStudents = (ids: string[]) => {
    intentionalDeleteRef.current.students = true;
    setStudents(prev => prev.filter(s => !ids.includes(s.id)));
  };

  const handleSortByName = () => {
    setStudents(prev => [...prev].sort((a, b) => a.name.localeCompare(b.name, 'ar')));
  };

  const handleSortByGroup = () => {
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
  };

  const handleAttendanceRecord = (record: AttendanceRecord) => {
    setAttendanceRecords(prev => [...prev, record]);
  };

  const handleClearRecords = () => {
    intentionalDeleteRef.current.records = true;
    setAttendanceRecords([]);
  };

  const handleCreateSession = (session: AttendanceSession) => {
    setSessions(prev => [...prev.map(s => ({ ...s, isActive: false })), session]);
    setActiveSessionId(session.id);
  };

  const handleSelectSession = (sessionId: string) => {
    setSessions(prev => prev.map(s => ({ ...s, isActive: s.id === sessionId })));
    setActiveSessionId(sessionId);
  };

  const handleDeleteSession = (sessionId: string) => {
    intentionalDeleteRef.current.sessions = true;
    intentionalDeleteRef.current.records = true;
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    setAttendanceRecords(prev => prev.filter(r => r.sessionId !== sessionId));
    if (activeSessionId === sessionId) setActiveSessionId(null);
  };

  const handleUpdateProfile = (updatedUser: User) => setCurrentUser(updatedUser);

  const canEditStudents = currentUser?.role === 'admin';
  const isAdmin = currentUser?.role === 'admin';

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-12 w-12 text-blue-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          <p className="text-gray-600">جارٍ التحميل...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <Login onLogin={handleLogin} />;
  }

  const selectedStage = stages.find(s => s.id === selectedStageId);
  const selectedCollege = colleges.find(c => c.id === selectedCollegeId);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100" dir="rtl">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4 flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center overflow-hidden border-2 border-white shadow-lg cursor-pointer"
                onClick={() => setActiveTab('profile')}
              >
                {currentUser.photoURL ? (
                  <img src={currentUser.photoURL} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-white font-bold text-lg">{currentUser.displayName.charAt(0)}</span>
                )}
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-600">مرحباً،</p>
                <p className="font-bold text-gray-800">{currentUser.displayName}</p>
                {isAdmin && (
                  <span className="inline-block mt-1 px-2 py-1 bg-purple-100 text-purple-800 text-xs font-medium rounded-full">
                    👑 أدمن
                  </span>
                )}
                {!isAdmin && (
                  <span className="inline-block mt-1 px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full">
                    👨‍🏫 تدريسي
                  </span>
                )}
              </div>
            </div>

            <button onClick={handleLogout} className="bg-red-500 hover:bg-red-600 text-white font-medium py-2 px-4 rounded-md flex items-center gap-2">
              تسجيل الخروج
            </button>
          </div>

          <h1 className="text-3xl md:text-4xl font-bold text-gray-800 mb-2 text-center">
            نظام إدارة الحضور
          </h1>

          {selectedStage && (
            <div className="bg-white rounded-lg shadow-sm p-3 flex items-center gap-2 text-sm flex-wrap mt-4">
              <button onClick={handleBackToStages} className="text-blue-600 hover:underline font-medium">
                🏠 جميع المراحل
              </button>
              <span className="text-gray-400">›</span>
              <span className="font-bold text-gray-700">{selectedCollege?.icon} {selectedCollege?.name}</span>
              <span className="text-gray-400">›</span>
              <span className="font-bold text-blue-700">📖 {selectedStage.name}</span>
            </div>
          )}
        </div>

        {!selectedStageId && (
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-wrap justify-center gap-3 mb-6">
              <button
                onClick={() => setActiveTab('stage-selector')}
                className={`px-5 py-2 rounded-lg font-medium ${activeTab === 'stage-selector' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
              >
                🎯 اختيار المرحلة
              </button>
              {isAdmin && (
                <>
                  <button
                    onClick={() => setActiveTab('colleges')}
                    className={`px-5 py-2 rounded-lg font-medium ${activeTab === 'colleges' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
                  >
                    🏛️ إدارة الكليات
                  </button>
                  <button
                    onClick={() => setActiveTab('teachers')}
                    className={`px-5 py-2 rounded-lg font-medium ${activeTab === 'teachers' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
                  >
                    👨‍🏫 التدريسيين
                  </button>
                </>
              )}
              <button
                onClick={() => setActiveTab('profile')}
                className={`px-5 py-2 rounded-lg font-medium ${activeTab === 'profile' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
              >
                👤 الملف الشخصي
              </button>
            </div>

            {/* 🆕 زر تحميل بيانات الجامعة الشاملة (للأدمن فقط) */}
            {isAdmin && activeTab === 'stage-selector' && (
              <div className="mb-6 p-4 bg-gradient-to-r from-purple-50 to-pink-50 border-2 border-purple-300 rounded-xl">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">📊</span>
                    <div>
                      <h3 className="font-bold text-purple-900">بيانات الجامعة الشاملة</h3>
                      <p className="text-xs text-purple-700">
                        {universityDataLoaded
                          ? `✅ تم تحميل بيانات ${Object.keys(allStagesData).length} مرحلة`
                          : 'حمّل بيانات كل الكليات والمراحل للتحليلات والتقارير الشاملة'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={loadAllAdminData}
                    disabled={universityDataLoading || stages.length === 0}
                    className={`px-5 py-2.5 rounded-lg font-bold text-white transition shadow-md ${
                      universityDataLoading
                        ? 'bg-gray-400 cursor-wait'
                        : universityDataLoaded
                        ? 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700'
                        : 'bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700'
                    } ${stages.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {universityDataLoading
                      ? '⏳ جاري التحميل...'
                      : universityDataLoaded
                      ? '🔄 تحديث البيانات'
                      : '⚡ تحميل بيانات الجامعة'}
                  </button>
                </div>
                {!universityDataLoaded && (
                  <p className="text-[11px] text-purple-600 mt-2 bg-white/50 px-2 py-1 rounded">
                    💡 الميزة موفرة - يتم التحميل فقط عند الحاجة لتقليل استهلاك الإنترنت
                  </p>
                )}
              </div>
            )}

            {activeTab === 'stage-selector' && (
              <StageSelector user={currentUser} colleges={colleges} stages={stages} onSelect={handleSelectStage} />
            )}

            {activeTab === 'colleges' && isAdmin && (
              <CollegeManager
                colleges={colleges}
                stages={stages}
                adminUid={currentUser.uid}
                onAddCollege={handleAddCollege}
                onDeleteCollege={handleDeleteCollege}
                onAddStage={handleAddStage}
                onDeleteStage={handleDeleteStage}
                onSelectStage={handleSelectStage}
              />
            )}

            {activeTab === 'teachers' && isAdmin && (
              <TeacherManagement currentUser={currentUser} colleges={colleges} stages={stages} />
            )}

            {activeTab === 'profile' && (
              <ProfileSettings currentUser={currentUser} onUpdateProfile={handleUpdateProfile} />
            )}
          </div>
        )}

        {selectedStageId && (
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-wrap justify-center gap-3 mb-6">
              <button
                onClick={() => setActiveTab('sessions')}
                className={`px-5 py-2 rounded-lg font-medium ${activeTab === 'sessions' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
              >
                📋 السجلات ({sessions.length})
              </button>
              <button
                onClick={() => setActiveTab('login')}
                className={`px-5 py-2 rounded-lg font-medium ${activeTab === 'login' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
              >
                📝 تسجيل الحضور
              </button>
              <button
                onClick={() => setActiveTab('manage')}
                className={`px-5 py-2 rounded-lg font-medium ${activeTab === 'manage' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
              >
                👥 {canEditStudents ? `إدارة الطلاب (${students.length})` : `الطلاب (${students.length})`}
              </button>
              <button
                onClick={() => setActiveTab('records')}
                className={`px-5 py-2 rounded-lg font-medium ${activeTab === 'records' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
              >
                📊 سجل الحضور ({attendanceRecords.length})
              </button>
            </div>

            {activeTab === 'sessions' && (
              <SessionManager
                sessions={sessions}
                activeSessionId={activeSessionId}
                onCreateSession={handleCreateSession}
                onSelectSession={handleSelectSession}
                onDeleteSession={handleDeleteSession}
              />
            )}

            {activeTab === 'login' && (
              <div className="max-w-lg mx-auto">
                {!activeSessionId ? (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
                    <p className="text-yellow-800 font-medium mb-4">لا يوجد سجل نشط!</p>
                    <button onClick={() => setActiveTab('sessions')} className="bg-yellow-600 text-white py-2 px-6 rounded-md">
                      انتقل لإدارة السجلات
                    </button>
                  </div>
                ) : students.length === 0 ? (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
                    <p className="text-yellow-800 font-medium">لا يوجد طلاب في هذه المرحلة</p>
                  </div>
                ) : (
                  <AttendanceLogin
                    students={students}
                    activeSessionId={activeSessionId}
                    activeSession={sessions.find(s => s.id === activeSessionId) || null}
                    records={attendanceRecords}
                    onAttendanceRecord={handleAttendanceRecord}
                    onUpdateStudent={handleUpdateStudent}
                  />
                )}
              </div>
            )}

            {activeTab === 'manage' && (
              canEditStudents ? (
                <StudentManager
                  students={students}
                  onAddStudent={handleAddStudent}
                  onUpdateStudent={handleUpdateStudent}
                  onDeleteStudent={handleDeleteStudent}
                  onDeleteSelectedStudents={handleDeleteSelectedStudents}
                  onSortByName={handleSortByName}
                  onSortByGroup={handleSortByGroup}
                />
              ) : (
                <StudentsViewer students={students} />
              )
            )}

            {activeTab === 'records' && (
              <AttendanceRecords
                records={attendanceRecords}
                sessions={sessions}
                students={students}
                activeSessionId={activeSessionId}
                onClearRecords={handleClearRecords}
              />
            )}
          </div>
        )}

        <div className="mt-12 text-center text-gray-600">
          <p className="text-sm">نظام تسجيل الحضور الإلكتروني - {new Date().getFullYear()}</p>
        </div>
      </div>

      {/* ✨ الشات بوت الذكي */}
      <SmartChatBot
        user={currentUser}
        colleges={colleges}
        stages={stages}
        currentCollegeId={selectedCollegeId}
        currentStageId={selectedStageId}
        students={students}
        records={attendanceRecords}
        sessions={sessions}
        activeSessionId={activeSessionId}
        allTeachers={isAdmin ? allTeachers : []}
        allStagesData={isAdmin && universityDataLoaded ? allStagesData : {}}
        onRequestUniversityData={isAdmin ? loadAllAdminData : undefined}
        universityDataLoaded={universityDataLoaded}
        universityDataLoading={universityDataLoading}
      />
    </div>
  );
}

export default App;