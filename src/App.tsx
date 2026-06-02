import { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { ref as dbRef, onValue, off } from 'firebase/database';
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
import { Settings } from './components/Settings';
import { CollegeManager } from './components/CollegeManager';
import { StageSelector } from './components/StageSelector';
import { SmartChatBot } from './components/SmartChatBot';
import { MorphingSquare } from './components/MorphingSquare';

// 🆕 نظام التسجيل الذاتي
import { SelfRegisterPage } from './components/SelfRegister/SelfRegisterPage';
import { SendRegisterLink } from './components/Admin/SendRegisterLink';
import { PendingRegistrations } from './components/Admin/PendingRegistrations';

import { auth, database } from './firebase/config';
import { signIn, signOut } from './firebase/authService';
import { TelegramConfig } from './types/telegram';
import { sendAbsenceNotification } from './services/telegramService';
import {
  loadColleges,
  saveColleges,
  loadStages,
  saveStages,
  loadStageData,
  loadStudents as loadStudentsForStage,
  saveStudents,
  saveAttendanceRecords,
  saveSessions,
  saveActiveSession,
  saveUserData,
  deleteStageData,
  flushAllPendingSaves,
  getCurrentAcademicYear,
} from './firebase/dataService';

type Tab = 'stage-selector' | 'colleges' | 'login' | 'manage' | 'records' | 'settings' | 'sessions' | 'teachers' | 'profile' | 'system-settings';

interface AllStagesData {
  [stageId: string]: {
    students: Student[];
    records: AttendanceRecord[];
    sessions: AttendanceSession[];
  };
}

function App() {
  // 🆕 كشف توكن التسجيل الذاتي من URL - بطرق متعددة لدعم كل المتصفحات
const [registerToken, setRegisterToken] = useState<string | null>(null);
const [tokenChecked, setTokenChecked] = useState(false);

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

  const [universityDataLoading, setUniversityDataLoading] = useState(false);
  const [universityDataLoaded, setUniversityDataLoaded] = useState(false);

  const [activeTab, setActiveTab] = useState<Tab>('stage-selector');

  // 🆕 نظام التسجيل الذاتي - حالات الأدمن
  const [showSendLink, setShowSendLink] = useState(false);
  const [showPendingRegistrations, setShowPendingRegistrations] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // 🤖 تهيئة التلغرام
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig | null>(null);

  // 🆕 السنة الأكاديمية الحالية
  const currentAcademicYear = getCurrentAcademicYear();

  const intentionalDeleteRef = useRef({
    students: false,
    records: false,
    sessions: false,
    colleges: false,
    stages: false,
  });

  const userModifiedStudentsRef = useRef(false);

  const getAdminUid = (): string => {
    if (!currentUser) return '';
    if (currentUser.role === 'admin') return currentUser.uid;
    return currentUser.adminId || currentUser.uid;
  };

  const getTeacherId = (): string => {
    return currentUser?.uid || '';
  };

  // 🆕 فحص متأخر للتوكن (للموبايل والـ in-app browsers)
useEffect(() => {
  const detectToken = () => {
    try {
      let token: string | null = null;

      const params = new URLSearchParams(
        window.location.search
      );

      token = params.get('reg');

      // Safari / in-app browser
      if (!token && window.location.hash) {
        const hashStr =
          window.location.hash.replace(/^#\/?/, '');

        const hashParams =
          new URLSearchParams(hashStr);

        token = hashParams.get('reg');
      }

      // fallback
      if (!token) {
        const match =
          window.location.href.match(
            /[?&#]reg=([^&#]+)/
          );

        if (match?.[1]) {
          token = decodeURIComponent(
            match[1]
          );
        }
      }

      // session backup
      if (!token) {
        token =
          sessionStorage.getItem(
            'pendingRegToken'
          );
      }

      if (token) {
        sessionStorage.setItem(
          'pendingRegToken',
          token
        );

        console.log(
          '✅ token:',
          token
        );

        setRegisterToken(token);
      }

      setTokenChecked(true);

    } catch (e) {
      console.error(e);
      setTokenChecked(true);
    }
  };

  detectToken();

  window.addEventListener(
    'pageshow',
    detectToken
  );

  return () => {
    window.removeEventListener(
      'pageshow',
      detectToken
    );
  };

}, []);

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
    if (registerToken) {
      console.log('🎯 registerToken موجود، نعرض صفحة التسجيل');
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const { ref: dbRefImport, get, set } = await import('firebase/database');
          const userRef = dbRefImport(database, `users/${firebaseUser.uid}`);
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
              active: true,
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
  }, [registerToken]);

  useEffect(() => {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'college_admin')) {
      setPendingCount(0);
      return;
    }

    const path = `registrationSystem/pending/${currentUser.uid}`;
    const requestsRef = dbRef(database, path);

    const handleSnapshot = (snapshot: any) => {
      if (!snapshot.exists()) {
        setPendingCount(0);
        return;
      }
      const data = snapshot.val();
      const count = Object.values(data).filter((r: any) => r.status === 'pending').length;
      setPendingCount(count);
    };

    const unsubscribe = onValue(requestsRef, handleSnapshot, (error) => {
      console.warn('⚠️ فشل الاستماع لطلبات التسجيل:', error);
    });

    return () => {
      off(requestsRef);
      unsubscribe();
    };
  }, [currentUser]);

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

      // 🤖 تحميل تهيئة التلغرام
      try {
        const { loadTelegramConfig } = await import('./firebase/dataService');
        const config = await loadTelegramConfig(adminUid);
        setTelegramConfig(config);
      } catch (e) {
        console.warn('فشل تحميل تهيئة التلغرام:', e);
      }

      if (user.role === 'admin') {
        try {
          const { ref: dbRefImport, get } = await import('firebase/database');
          const usersSnap = await get(dbRefImport(database, 'users'));
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

  const loadAllAdminData = async () => {
    if (!currentUser || currentUser.role !== 'admin') return;

    setUniversityDataLoading(true);
    try {
      const { ref: dbRefImport, get } = await import('firebase/database');
      const adminUid = currentUser.uid;

      const allUserIds = [adminUid, ...allTeachers.map(t => t.uid)];
      const stagesDataMap: AllStagesData = {};

      const yearPath = `academicYears/${currentAcademicYear}/userData/${adminUid}`;

      await Promise.all(
        stages.map(async (stage) => {
          try {
            const studentsSnap = await get(
              dbRefImport(database, `${yearPath}/stageData/${stage.id}/students`)
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
                    dbRefImport(database, `${yearPath}/stageData/${stage.id}/teacherRecords/${userId}/records`)
                  );
                  if (recSnap.exists()) {
                    const data = recSnap.val();
                    const arr: AttendanceRecord[] = Array.isArray(data) ? data : Object.values(data);
                    allRecords.push(...arr);
                  }

                  const sesSnap = await get(
                    dbRefImport(database, `${yearPath}/stageData/${stage.id}/teacherRecords/${userId}/sessions`)
                  );
                  if (sesSnap.exists()) {
                    const data = sesSnap.val();
                    const arr: AttendanceSession[] = Array.isArray(data) ? data : Object.values(data);
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
    userModifiedStudentsRef.current = false;

    try {
      const adminUid = getAdminUid();
      const teacherId = getTeacherId();
      const data = await loadStageData(adminUid, stageId, teacherId);

      if (!userModifiedStudentsRef.current) {
        setStudents(data.students);
      }
      setAttendanceRecords(data.records);
      setSessions(data.sessions);
      setActiveSessionId(data.activeSessionId);
      setActiveTab('sessions');

      // 🤖 تحميل تهيئة التلغرام
      const { loadTelegramConfig } = await import('./firebase/dataService');
      const config = await loadTelegramConfig(adminUid);
      setTelegramConfig(config);
    } catch (e) {
      console.error('Error loading stage:', e);
    } finally {
      setTimeout(() => setDataLoaded(true), 300);
    }
  };

  const handleBackToStages = () => {
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

  const handleResetComplete = () => {
    resetData();
  };

  useEffect(() => {
    if (currentUser?.role === 'admin' && dataLoaded) {
      const force = intentionalDeleteRef.current.colleges;
      saveColleges(currentUser.uid, colleges, force);
      if (force) intentionalDeleteRef.current.colleges = false;
    }
  }, [colleges, currentUser, dataLoaded]);

  useEffect(() => {
    if (currentUser?.role === 'admin' && dataLoaded) {
      const force = intentionalDeleteRef.current.stages;
      saveStages(currentUser.uid, stages, force);
      if (force) intentionalDeleteRef.current.stages = false;
    }
  }, [stages, currentUser, dataLoaded]);

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

  const handleAddStudent = (student: Student) => {
    userModifiedStudentsRef.current = true;
    setStudents(prev => [...prev, student]);
  };

  const handleAddMultipleStudents = (newStudents: Student[]) => {
    userModifiedStudentsRef.current = true;
    setStudents(prev => [...prev, ...newStudents]);
  };

  const handleUpdateStudent = (id: string, updates: Partial<Student>) => {
    userModifiedStudentsRef.current = true;
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
      userModifiedStudentsRef.current = true;
      intentionalDeleteRef.current.students = true;
      intentionalDeleteRef.current.records = true;
      setStudents(prev => prev.filter(s => s.id !== id));
      setAttendanceRecords(prev => prev.filter(r => r.studentId !== id));
    }
  };

  const handleDeleteSelectedStudents = (ids: string[]) => {
    userModifiedStudentsRef.current = true;
    intentionalDeleteRef.current.students = true;
    intentionalDeleteRef.current.records = true;
    setStudents(prev => prev.filter(s => !ids.includes(s.id)));
    setAttendanceRecords(prev => prev.filter(r => !ids.includes(r.studentId)));
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

  // 🛑 Local cache — يمنع أي Read/Write مكرر من Firebase لنفس الطالب في نفس الجلسة
  const processedAttendanceRef = useRef(new Set<string>());

  const handleAttendanceRecord = (record: AttendanceRecord) => {
    // 🛑 تحقق من الـ Cache المحلي — إذا تمت معالجة هذا الطالب مسبقاً، ارفض فوراً (لا Firebase, لا State, لا Notification)
    const cacheKey = `${record.sessionId}_${record.studentId}`;
    if (processedAttendanceRef.current.has(cacheKey)) return;
    processedAttendanceRef.current.add(cacheKey);

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

  const handleRenameSession = (sessionId: string, newName: string) => {
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, name: newName } : s));
  };

  const handleDeleteSession = (sessionId: string) => {
    intentionalDeleteRef.current.sessions = true;
    intentionalDeleteRef.current.records = true;
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    setAttendanceRecords(prev => prev.filter(r => r.sessionId !== sessionId));
    if (activeSessionId === sessionId) setActiveSessionId(null);
  };

  const handleMarkAbsent = async (sessionId: string, studentIds: string[]) => {
    const stage = stages.find(s => s.id === selectedStageId);
    const stageName = stage?.name || '';
    const now = new Date();
    const date = now.toLocaleDateString('ar-EG');
    const time = now.toLocaleTimeString('ar-EG');

    const newRecords: AttendanceRecord[] = studentIds.map(studentId => {
      const student = students.find(s => s.id === studentId);
      return {
        id: `absent_${Date.now()}_${studentId}`,
        studentId,
        studentName: student?.name || '',
        studentCode: student?.code || '',
        studentGroup: student?.group,
        timestamp: now.toISOString(),
        date,
        time,
        sessionId,
        status: 'absent' as const,
        method: 'manual' as const,
        academicYear: currentAcademicYear,
        teacherName: currentUser?.displayName,
        subjectName: currentUser?.bio || currentUser?.displayName,
      };
    });

    setAttendanceRecords(prev => [...prev, ...newRecords]);

    if (telegramConfig && selectedStageId) {
      for (const record of newRecords) {
        const absentCount = attendanceRecords.filter(
          r => r.studentId === record.studentId && r.status === 'absent'
        ).length + 1;

        sendAbsenceNotification(
          telegramConfig,
          selectedStageId,
          record.studentName,
          date,
          absentCount,
          record.subjectName || stageName,
          record.teacherName
        ).catch(() => {});
      }
    }
  };

  const handleTelegramConfigChange = (config: TelegramConfig | null) => setTelegramConfig(config);

  const handleUpdateProfile = (updatedUser: User) => setCurrentUser(updatedUser);

  // 🆕 معالجة خروج الطالب من صفحة التسجيل الذاتي
  const handleExitSelfRegister = () => {
    setRegisterToken(null);

    // ✅ نظف sessionStorage
    sessionStorage.removeItem('pendingRegToken');

    // ✅ نظف URL
    const url = new URL(window.location.href);
    url.searchParams.delete('reg');
    url.hash = ''; // نظف الـ hash أيضاً
    window.history.replaceState({}, '', url.toString());
  };

  // ✨ متابعة الفأرة لتأثير التوهج الأبيض المتدرج (دخان)
  useEffect(() => {
    let lastButton: HTMLElement | null = null;
    const handleMouseMove = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('button') as HTMLElement | null;
      if (target && target !== lastButton) {
        if (lastButton) {
          lastButton.style.setProperty('--glow-x', `${e.clientX - lastButton.getBoundingClientRect().left}px`);
          lastButton.style.setProperty('--glow-y', `${e.clientY - lastButton.getBoundingClientRect().top}px`);
        }
        lastButton = target;
      }
      if (target) {
        const rect = target.getBoundingClientRect();
        target.style.setProperty('--glow-x', `${e.clientX - rect.left}px`);
        target.style.setProperty('--glow-y', `${e.clientY - rect.top}px`);
      }
    };
    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const isAdmin = currentUser?.role === 'admin';
  const isCollegeAdmin = currentUser?.role === 'college_admin';
  const canEditStudents = isAdmin || isCollegeAdmin;
  const isMainAdmin = isAdmin;

  // ════════════════════════════════════════════════════════════
  // 🆕 صفحة التسجيل الذاتي - تظهر بمعزل تام عن باقي النظام
  // ════════════════════════════════════════════════════════════
  if (registerToken) {
    return (
      <SelfRegisterPage
        token={registerToken}
        onExit={handleExitSelfRegister}
      />
    );
  }

if (loading || !tokenChecked) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <MorphingSquare className="w-16 h-16 bg-blue-500" />
      </div>
    );
  }

  if (!currentUser) {
    return <Login onLogin={handleLogin} />;
  }

  const selectedStage = stages.find(s => s.id === selectedStageId);
  const selectedCollege = colleges.find(c => c.id === selectedCollegeId);

  return (
    <div className="min-h-screen bg-slate-900" dir="rtl">
      <div className="container mx-auto px-3 md:px-4 py-3 md:py-6">
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
                {isMainAdmin && (
                  <span className="inline-block mt-1 px-2 py-1 bg-purple-100 text-purple-800 text-xs font-medium rounded-full">
                    👑 أدمن رئيسي
                  </span>
                )}
                {isCollegeAdmin && (
                  <span className="inline-block mt-1 px-2 py-1 bg-amber-100 text-amber-800 text-xs font-medium rounded-full">
                    🏛️ أدمن كلية
                  </span>
                )}
                {currentUser?.role === 'teacher' && (
                  <span className="inline-block mt-1 px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full">
                    👨‍🏫 تدريسي
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden md:flex items-center gap-2 px-3 py-2 bg-indigo-100 text-indigo-800 rounded-lg text-sm font-medium">
                🎓 {currentAcademicYear.replace('_', ' - ')}
              </div>

              <button
                onClick={handleLogout}
                className="bg-red-500 hover:bg-red-600 text-white font-medium py-2 px-4 rounded-md flex items-center gap-2"
              >
                تسجيل الخروج
              </button>
            </div>
          </div>

          <h1 className="text-xl sm:text-3xl md:text-4xl font-bold text-gray-800 mb-1 sm:mb-2 text-center">
            نظام إدارة الحضور
          </h1>

          <div className="md:hidden text-center mb-2">
            <span className="inline-block px-3 py-1 bg-indigo-100 text-indigo-800 rounded-full text-xs font-medium">
              🎓 السنة الأكاديمية: {currentAcademicYear.replace('_', ' - ')}
            </span>
          </div>

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
            {/* ✅ التعديل الأساسي: أضفنا py-3 للـ container ليتيح مساحة للـ badge فوق الأزرار */}
            <div className="overflow-x-auto scrollbar-none">
              <div className="flex flex-nowrap md:flex-wrap gap-2 md:gap-3 pt-3 pb-3 md:pb-3 md:pt-3 justify-start md:justify-center mb-4 md:mb-6">
                <button
                  onClick={() => setActiveTab('stage-selector')}
                  className={`shrink-0 px-3 sm:px-5 py-1.5 sm:py-2 rounded-lg font-medium text-sm sm:text-base ${activeTab === 'stage-selector' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
                >
                  🎯 اختيار المرحلة
                </button>
                {isMainAdmin && (
                  <>
                    <button
                      onClick={() => setActiveTab('colleges')}
                      className={`shrink-0 px-3 sm:px-5 py-1.5 sm:py-2 rounded-lg font-medium text-sm sm:text-base ${activeTab === 'colleges' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
                    >
                      🏛️ إدارة الكليات
                    </button>
                    <button
                      onClick={() => setActiveTab('teachers')}
                      className={`shrink-0 px-3 sm:px-5 py-1.5 sm:py-2 rounded-lg font-medium text-sm sm:text-base ${activeTab === 'teachers' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
                    >
                      👨‍🏫 التدريسيين
                    </button>
                    <button
                      onClick={() => setActiveTab('system-settings')}
                      className={`shrink-0 px-3 sm:px-5 py-1.5 sm:py-2 rounded-lg font-medium text-sm sm:text-base ${activeTab === 'system-settings' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
                    >
                      ⚙️ إعدادات النظام
                    </button>
                  </>
                )}
                {(isMainAdmin || isCollegeAdmin) && (
                  <>
                    <button
                      onClick={() => setShowSendLink(true)}
                      className="shrink-0 px-3 sm:px-5 py-1.5 sm:py-2 rounded-lg font-medium text-sm sm:text-base bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-md hover:from-purple-700 hover:to-pink-700 transition"
                    >
                      📨 إرسال روابط تسجيل
                    </button>

                    {/* ✅ الإصلاح الرئيسي: wrapper div مع overflow-visible يحمل الـ badge خارج الزر */}
                    <div className="shrink-0 relative" style={{ overflow: 'visible' }}>
                      <button
                        onClick={() => setShowPendingRegistrations(true)}
                        className="px-3 sm:px-5 py-1.5 sm:py-2 rounded-lg font-medium text-sm sm:text-base bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md hover:from-amber-600 hover:to-orange-600 transition"
                      >
                        📋 طلبات التسجيل
                      </button>
                      {pendingCount > 0 && (
                        <span
                          className="absolute bg-red-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center animate-pulse shadow-lg"
                          style={{ top: '-10px', right: '-10px', zIndex: 9999 }}
                        >
                          {pendingCount > 99 ? '99+' : pendingCount}
                        </span>
                      )}
                    </div>
                  </>
                )}
                {isCollegeAdmin && (
                  <button
                    onClick={() => setActiveTab('teachers')}
                    className={`shrink-0 px-3 sm:px-5 py-1.5 sm:py-2 rounded-lg font-medium text-sm sm:text-base ${activeTab === 'teachers' ? 'bg-amber-600 text-white' : 'bg-white text-gray-700'}`}
                  >
                    👨‍🏫 صلاحيات التدريسيين
                  </button>
                )}
                <button
                  onClick={() => setActiveTab('profile')}
                  className={`shrink-0 px-3 sm:px-5 py-1.5 sm:py-2 rounded-lg font-medium text-sm sm:text-base ${activeTab === 'profile' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
                >
                  👤 الملف الشخصي
                </button>
              </div>
            </div>

            {isMainAdmin && activeTab === 'stage-selector' && (
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
              </div>
            )}

            <div key={`tab-${activeTab}`} className="animate-pageEnter">
              {activeTab === 'stage-selector' && (
                <StageSelector user={currentUser} colleges={colleges} stages={stages} onSelect={handleSelectStage} />
              )}

              {activeTab === 'colleges' && isMainAdmin && (
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

              {activeTab === 'teachers' && (isMainAdmin || isCollegeAdmin) && (
                <TeacherManagement 
                  currentUser={currentUser} 
                  colleges={isCollegeAdmin ? colleges.filter(c => c.id === currentUser.collegeId) : colleges} 
                  stages={isCollegeAdmin ? stages.filter(s => s.collegeId === currentUser.collegeId) : stages} 
                />
              )}

              {activeTab === 'system-settings' && isMainAdmin && (
                <Settings
                  students={students}
                  attendanceRecords={attendanceRecords}
                  currentUser={currentUser}
                  onDataRestored={() => loadInitialData(currentUser)}
                  onResetComplete={handleResetComplete}
                  stages={stages}
                  colleges={colleges}
                  onTelegramConfigChange={handleTelegramConfigChange}
                />
              )}

              {activeTab === 'profile' && (
                <ProfileSettings currentUser={currentUser} onUpdateProfile={handleUpdateProfile} />
              )}
            </div>
          </div>
        )}

        {selectedStageId && (
          <div className="max-w-6xl mx-auto">
            <div className="flex overflow-x-auto flex-nowrap md:flex-wrap gap-2 md:gap-3 pb-1 md:pb-0 justify-start md:justify-center mb-4 md:mb-6 scrollbar-none">
              <button
                onClick={() => setActiveTab('sessions')}
                className={`shrink-0 px-3 sm:px-5 py-1.5 sm:py-2 rounded-lg font-medium text-sm sm:text-base ${activeTab === 'sessions' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
              >
                📋 السجلات ({sessions.length})
              </button>
              <button
                onClick={() => setActiveTab('login')}
                className={`shrink-0 px-3 sm:px-5 py-1.5 sm:py-2 rounded-lg font-medium text-sm sm:text-base ${activeTab === 'login' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
              >
                📝 تسجيل الحضور
              </button>
              <button
                onClick={() => setActiveTab('manage')}
                className={`shrink-0 px-3 sm:px-5 py-1.5 sm:py-2 rounded-lg font-medium text-sm sm:text-base ${activeTab === 'manage' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
              >
                👥 {canEditStudents ? `إدارة الطلاب (${students.length})` : `الطلاب (${students.length})`}
              </button>
              <button
                onClick={() => setActiveTab('records')}
                className={`shrink-0 px-3 sm:px-5 py-1.5 sm:py-2 rounded-lg font-medium text-sm sm:text-base ${activeTab === 'records' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
              >
                📊 سجل الحضور ({attendanceRecords.length})
              </button>
            </div>

            <div key={`stage-tab-${activeTab}`} className="animate-pageEnter">
              {activeTab === 'sessions' && (
                <SessionManager
                  sessions={sessions}
                  activeSessionId={activeSessionId}
                  onCreateSession={handleCreateSession}
                  onSelectSession={handleSelectSession}
                onDeleteSession={handleDeleteSession}
                onRenameSession={handleRenameSession}
                students={students}
                records={attendanceRecords}
                onMarkAbsent={handleMarkAbsent}
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
                      currentUser={currentUser}
                    />
                  )}
                </div>
              )}

              {activeTab === 'manage' && (
                canEditStudents ? (
                  <StudentManager
                    students={students}
                    onAddStudent={handleAddStudent}
                    onAddMultipleStudents={handleAddMultipleStudents}
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
          </div>
        )}

        <div className="mt-12 text-center text-gray-600">
          <p className="text-sm">نظام تسجيل الحضور الإلكتروني - {new Date().getFullYear()}</p>
<p className="text-xs mt-1 overflow-hidden">
  <span
    style={{
      display: 'inline-block',
      WebkitTextFillColor: 'transparent',
      background: 'linear-gradient(to right, #94a3b8 0%, rgba(255,255,255,0.85) 40%, rgba(255,255,255,0.85) 60%, #94a3b8 100%)',
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      backgroundRepeat: 'no-repeat',
      backgroundSize: '50% 200%',
      animation: 'shimmerSlide 2.5s linear 1.5s infinite',
    }}
  >
    BY PH. Mujtaba Haitham
  </span>
</p>        </div>
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
        allTeachers={isMainAdmin ? allTeachers : []}
        allStagesData={isMainAdmin && universityDataLoaded ? allStagesData : {}}
        onRequestUniversityData={isAdmin ? loadAllAdminData : undefined}
        universityDataLoaded={universityDataLoaded}
        universityDataLoading={universityDataLoading}
      />

      {/* 🆕 نافذة إرسال روابط التسجيل الذاتي */}
      {showSendLink && currentUser && (isMainAdmin || isCollegeAdmin) && (
        <SendRegisterLink
          adminUid={currentUser.uid}
          colleges={isCollegeAdmin ? colleges.filter(c => c.id === currentUser.collegeId) : colleges}
          stages={isCollegeAdmin ? stages.filter(s => s.collegeId === currentUser.collegeId) : stages}
          loadStudents={async (stageId: string) => {
            const uid = isCollegeAdmin ? getAdminUid() : currentUser.uid;
            return await loadStudentsForStage(uid, stageId);
          }}
          telegramConfig={telegramConfig}
          onClose={() => setShowSendLink(false)}
        />
      )}

      {/* 🆕 نافذة مراجعة طلبات التسجيل الذاتي */}
      {showPendingRegistrations && currentUser && (isMainAdmin || isCollegeAdmin) && (
        <PendingRegistrations
          adminUid={currentUser.uid}
          dataAdminUid={isCollegeAdmin ? getAdminUid() : undefined}
          onClose={() => setShowPendingRegistrations(false)}
        />
      )}
    </div>
  );
}

export default App;