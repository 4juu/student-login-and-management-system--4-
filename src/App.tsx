import { useState, useEffect, useRef, useCallback } from 'react';
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
import Aurora from './components/Aurora';
import { SendProgressModal } from './components/SendProgressModal';

// 🆕 نظام التسجيل الذاتي
import { SelfRegisterPage } from './components/SelfRegister/SelfRegisterPage';
import { SendRegisterLink } from './components/Admin/SendRegisterLink';
import { PendingRegistrations } from './components/Admin/PendingRegistrations';

import { auth, database } from './firebase/config';
import { signIn, signOut } from './firebase/authService';
import { TelegramConfig, AbsenceSendLogEntry, GroupSendProgress } from './types/telegram';
import { buildQueueFromGroups, sendQueuedMessages } from './services/telegramService';
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
  cancelAllPendingSaves,
  getCurrentAcademicYear,
} from './firebase/dataService';
import { startDetectorPreload, startBackgroundPreload } from './services/faceRecognition';

type Tab = 'stage-selector' | 'colleges' | 'login' | 'manage' | 'records' | 'settings' | 'sessions' | 'teachers' | 'profile' | 'system-settings';

interface AllStagesData {
  [stageId: string]: {
    students: Student[];
    records: AttendanceRecord[];
    sessions: AttendanceSession[];
  };
}

// ✨ TextScramble Component
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*";

function TextScramble({ text }: { text: string }) {
  const [displayText, setDisplayText] = useState(text);
  const [isHovering, setIsHovering] = useState(false);
  const [isScrambling, setIsScrambling] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const frameRef = useRef(0);

  const scramble = useCallback(() => {
    setIsScrambling(true);
    frameRef.current = 0;
    const duration = text.length * 3;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      frameRef.current++;
      const progress = frameRef.current / duration;
      const revealedLength = Math.floor(progress * text.length);
      const newText = text
        .split("")
        .map((char, i) => {
          if (char === " ") return " ";
          if (i < revealedLength) return text[i];
          return CHARS[Math.floor(Math.random() * CHARS.length)];
        })
        .join("");
      setDisplayText(newText);
      if (frameRef.current >= duration) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setDisplayText(text);
        setIsScrambling(false);
      }
    }, 30);
  }, [text]);

  const handleMouseEnter = () => {
    setIsHovering(true);
    scramble();
  };

  const handleMouseLeave = () => {
    setIsHovering(false);
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <div
      className="group relative inline-flex flex-col cursor-pointer select-none"
      dir="ltr"
      style={{ unicodeBidi: 'embed' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span className="relative font-mono tracking-widest" style={{ fontSize: '0.7rem' }}>
        {displayText.split("").map((char, i) => (
          <span
            key={i}
            className="inline-block transition-all duration-150"
            style={{
              transitionDelay: `${i * 10}ms`,
              color: isScrambling && char !== text[i] ? '#60a5fa' : '#94a3b8',
              transform: isScrambling && char !== text[i] ? 'scale(1.15)' : 'scale(1)',
              fontWeight: isScrambling && char !== text[i] ? 700 : 500,
            }}
          >
            {char}
          </span>
        ))}
      </span>

      {/* Animated underline */}
      <span className="relative h-px w-full mt-1 overflow-hidden">
        <span
          className="absolute inset-0 transition-transform duration-500 ease-out origin-left"
          style={{
            background: '#94a3b8',
            transform: isHovering ? 'scaleX(1)' : 'scaleX(0)',
          }}
        />
        <span className="absolute inset-0" style={{ background: '#1e293b' }} />
      </span>

      {/* Subtle glow on hover */}
      <span
        className="absolute rounded-lg transition-opacity duration-300"
        style={{
          inset: '-12px',
          background: 'rgba(96, 165, 250, 0.05)',
          opacity: isHovering ? 1 : 0,
          zIndex: -1,
        }}
      />
    </div>
  );
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

  // 🚀 حالة إرسال الغيابات
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sendGroups, setSendGroups] = useState<GroupSendProgress[]>([]);
  const [sendSubjectName, setSendSubjectName] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendDoneCount, setSendDoneCount] = useState(0);
  const [sendTotalGroups, setSendTotalGroups] = useState(0);
  const sendAbortRef = useRef<AbortController | null>(null);
  const [currentSendingSessionId, setCurrentSendingSessionId] = useState<string | null>(null);

  // 📋 سجل إرسال الغيابات (جلسة فقط)
  const [absenceSendLogs, setAbsenceSendLogs] = useState<AbsenceSendLogEntry[]>([]);
  const [completedGroupData, setCompletedGroupData] = useState<Record<string, GroupSendProgress[]>>({});

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
        const params = new URLSearchParams(window.location.search);
        token = params.get('reg');

        if (!token && window.location.hash) {
          const hashStr = window.location.hash.replace(/^#\/?/, '');
          const hashParams = new URLSearchParams(hashStr);
          token = hashParams.get('reg');
        }

        if (!token) {
          const match = window.location.href.match(/[?&#]reg=([^&#]+)/);
          if (match?.[1]) token = decodeURIComponent(match[1]);
        }

        if (!token) token = sessionStorage.getItem('pendingRegToken');

        if (token) {
          sessionStorage.setItem('pendingRegToken', token);
          setRegisterToken(token);
        }

        setTokenChecked(true);
      } catch (e) {
        console.error(e);
        setTokenChecked(true);
      }
    };

    detectToken();
    window.addEventListener('pageshow', detectToken);
    return () => window.removeEventListener('pageshow', detectToken);
  }, []);

  useEffect(() => {
    // 🚀 تحميل موديل الكشف الخفيف بالخلفية من أول لحظة فتح الموقع (بدون تثبيت)
    startDetectorPreload();
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => flushAllPendingSaves();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      flushAllPendingSaves();
    };
  }, []);

  useEffect(() => {
    if (registerToken) {
      setLoading(false);
      // 🚀 تحميل موديل الكشف الخفيف فوراً
      setTimeout(() => startDetectorPreload(), 500);
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
          // 🚀 تحميل موديل الكشف الخفيف فور تحميل الواجهة
          setTimeout(() => startDetectorPreload(), 500);
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
      if (!snapshot.exists()) { setPendingCount(0); return; }
      const data = snapshot.val();
      const count = Object.values(data).filter((r: any) => r.status === 'pending').length;
      setPendingCount(count);
    };

    const unsubscribe = onValue(requestsRef, handleSnapshot, (error) => {
      console.warn('⚠️ فشل الاستماع لطلبات التسجيل:', error);
    });

    return () => { off(requestsRef); unsubscribe(); };
  }, [currentUser]);

  const loadInitialData = async (user: User) => {
    setDataLoaded(false);
    try {
      const adminUid = user.role === 'admin' ? user.uid : (user.adminId || user.uid);
      const [collegesData, stagesData] = await Promise.all([loadColleges(adminUid), loadStages(adminUid)]);

      setColleges(collegesData);
      setStages(stagesData);
      setActiveTab('stage-selector');

      try {
        const { loadTelegramConfig } = await import('./firebase/dataService');
        const config = await loadTelegramConfig(adminUid);
        setTelegramConfig(config);
      } catch (e) { console.warn('فشل تحميل تهيئة التلغرام:', e); }

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
        } catch (e) { console.warn('فشل تحميل قائمة التدريسيين:', e); }
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
            const studentsSnap = await get(dbRefImport(database, `${yearPath}/stageData/${stage.id}/students`));
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
                  const recSnap = await get(dbRefImport(database, `${yearPath}/stageData/${stage.id}/teacherRecords/${userId}/records`));
                  if (recSnap.exists()) {
                    const data = recSnap.val();
                    allRecords.push(...(Array.isArray(data) ? data : Object.values(data)));
                  }
                  const sesSnap = await get(dbRefImport(database, `${yearPath}/stageData/${stage.id}/teacherRecords/${userId}/sessions`));
                  if (sesSnap.exists()) {
                    const data = sesSnap.val();
                    allSessions.push(...(Array.isArray(data) ? data : Object.values(data)));
                  }
                } catch (e) { console.warn(`فشل جلب بيانات المستخدم ${userId}`); }
              })
            );

            stagesDataMap[stage.id] = { students: stageStudents, records: allRecords, sessions: allSessions };
          } catch (e) { console.warn(`فشل تحميل بيانات المرحلة ${stage.id}`); }
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
    startBackgroundPreload();
    setSelectedCollegeId(collegeId);
    setSelectedStageId(stageId);
    setDataLoaded(false);
    userModifiedStudentsRef.current = false;

    try {
      const adminUid = getAdminUid();
      const teacherId = getTeacherId();
      const data = await loadStageData(adminUid, stageId, teacherId);

      if (!userModifiedStudentsRef.current) setStudents(data.students);
      setAttendanceRecords(data.records);
      setSessions(data.sessions);
      setActiveSessionId(data.activeSessionId);
      setActiveTab('sessions');

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

  const handleResetComplete = () => resetData();

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
          [selectedStageId]: { ...(prev[selectedStageId] || { records: [], sessions: [] }), students },
        }));
      }
    }
  }, [students, currentUser, dataLoaded, selectedStageId, universityDataLoaded]);

  useEffect(() => {
    if (currentUser && dataLoaded && selectedStageId) {
      const force = intentionalDeleteRef.current.records;
      saveAttendanceRecords(getAdminUid(), selectedStageId, getTeacherId(), attendanceRecords, force);
      if (force) intentionalDeleteRef.current.records = false;
      if (currentUser.role === 'admin' && universityDataLoaded) {
        setAllStagesData(prev => ({
          ...prev,
          [selectedStageId]: { ...(prev[selectedStageId] || { students: [], sessions: [] }), records: attendanceRecords },
        }));
      }
    }
  }, [attendanceRecords, currentUser, dataLoaded, selectedStageId, universityDataLoaded]);

  useEffect(() => {
    if (currentUser && dataLoaded && selectedStageId) {
      const force = intentionalDeleteRef.current.sessions;
      saveSessions(getAdminUid(), selectedStageId, getTeacherId(), sessions, force);
      if (force) intentionalDeleteRef.current.sessions = false;
      if (currentUser.role === 'admin' && universityDataLoaded) {
        setAllStagesData(prev => ({
          ...prev,
          [selectedStageId]: { ...(prev[selectedStageId] || { students: [], records: [] }), sessions },
        }));
      }
    }
  }, [sessions, currentUser, dataLoaded, selectedStageId, universityDataLoaded]);

  useEffect(() => {
    if (currentUser && dataLoaded && selectedStageId) {
      saveActiveSession(getAdminUid(), selectedStageId, getTeacherId(), activeSessionId);
    }
  }, [activeSessionId, currentUser, dataLoaded, selectedStageId]);

  useEffect(() => {
    if (currentUser && dataLoaded) saveUserData(currentUser.uid, currentUser);
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
      setAllStagesData(prev => { const updated = { ...prev }; delete updated[stage.id]; return updated; });
    });
  };

  const handleAddStage = (stage: Stage) => setStages(prev => [...prev, stage]);

  const handleDeleteStage = (stageId: string) => {
    intentionalDeleteRef.current.stages = true;
    setStages(prev => prev.filter(s => s.id !== stageId));
    deleteStageData(currentUser!.uid, stageId);
    setAllStagesData(prev => { const updated = { ...prev }; delete updated[stageId]; return updated; });
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
          if (value === undefined || value === null || value === '') delete merged[key];
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

  const processedAttendanceRef = useRef(new Set<string>());
  const markAbsentInFlightRef = useRef(new Set<string>());

  const handleAttendanceRecord = (record: AttendanceRecord) => {
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
  };

  const handleClearRecords = () => {
    cancelAllPendingSaves();
    intentionalDeleteRef.current.records = true;
    markAbsentInFlightRef.current.clear();
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
    markAbsentInFlightRef.current.clear();
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    setAttendanceRecords(prev => prev.filter(r => r.sessionId !== sessionId));
    if (activeSessionId === sessionId) setActiveSessionId(null);
  };

  const handleMarkAbsent = async (sessionId: string, studentIds: string[]) => {
    const stage = stages.find(s => s.id === selectedStageId);
    const stageName = stage?.name || '';
    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);
    const time = now.toLocaleTimeString('ar-EG');

    const subjectName = currentUser?.bio || currentUser?.displayName || stageName || '';
    const teacherName = currentUser?.displayName || '';

    const studentsByGroup = new Map<string, typeof studentIds>();
    for (const studentId of studentIds) {
      const student = students.find(s => s.id === studentId);
      if (!student) continue;
      const group = student.group || 'بدون كروب';
      if (!studentsByGroup.has(group)) studentsByGroup.set(group, []);
      studentsByGroup.get(group)!.push(studentId);
    }

    const allNewRecords: AttendanceRecord[] = [];
    const groupDataList: Array<{
      groupName: string;
      absentStudents: Array<{ name: string; count: number }>;
    }> = [];

    for (const [group, groupStudentIds] of studentsByGroup) {
      const absentStudents: Array<{ name: string; count: number }> = [];
      const groupRecords: AttendanceRecord[] = [];

      for (const studentId of groupStudentIds) {
        const student = students.find(s => s.id === studentId);
        if (!student) continue;

        const alreadyMarked = attendanceRecords.some(
          r => r.studentId === studentId &&
               r.sessionId === sessionId &&
               (r.status === 'absent' || r.status === 'present')
        );
        if (alreadyMarked) continue;

        const dedupeKey = `${sessionId}_${studentId}`;
        if (markAbsentInFlightRef.current.has(dedupeKey)) continue;
        markAbsentInFlightRef.current.add(dedupeKey);

        const existingCount = attendanceRecords.filter(
          r => r.studentId === studentId && r.status === 'absent'
        ).length;

        const absenceCount = existingCount + 1;

        const record: AttendanceRecord = {
          id: `absent_${Date.now()}_${studentId}`,
          studentId,
          studentName: student.name,
          studentCode: student.code || '',
          studentGroup: student.group,
          timestamp: now.toISOString(),
          date: dateKey,
          time,
          sessionId,
          status: 'absent',
          method: 'manual',
          academicYear: currentAcademicYear,
          teacherName,
          subjectName,
          absenceCount,
        };

        groupRecords.push(record);
        absentStudents.push({ name: student.name, count: absenceCount });
      }

      if (groupRecords.length > 0) {
        allNewRecords.push(...groupRecords);
        groupDataList.push({ groupName: group, absentStudents });
      }
    }

    if (allNewRecords.length > 0) {
      setAttendanceRecords(prev => [...prev, ...allNewRecords]);
    }

    // 🚀 إرسال عبر التلغرام (خلفية)
    if (groupDataList.length > 0) {
      const channel = telegramConfig && selectedStageId ? telegramConfig.channels[selectedStageId] : undefined;

      if (!telegramConfig || !selectedStageId || !channel?.chatId) {
        alert(
          telegramConfig
            ? '⚠️ إشعارات الغياب لم تُرسل: لا يوجد Chat ID مرتبط بهذه المرحلة.\nاذهب إلى الإعدادات ← بوت التلغرام وأدخل Chat ID لقناة هذه المادة.'
            : '⚠️ إشعارات الغياب لم تُرسل: لم يتم إعداد بوت التلغرام.\nاذهب إلى الإعدادات ← بوت التلغرام لربط البوت والقناة أولاً.'
        );
        return;
      }

      const queue = buildQueueFromGroups(telegramConfig, selectedStageId, subjectName, dateKey, groupDataList);
      if (queue.length === 0) return;

      const progressGroups: GroupSendProgress[] = groupDataList.map(g => ({
        groupName: g.groupName,
        channels: [{
          channelLabel: telegramConfig.channels[selectedStageId]?.stageName || '',
          status: 'pending' as const,
        }],
        allDone: false,
      }));

      setSendSubjectName(subjectName);
      setSendGroups(progressGroups);
      setSendDoneCount(0);
      setSendTotalGroups(groupDataList.length);
      setSendModalOpen(true);
      setIsSending(true);
      setCurrentSendingSessionId(sessionId);

      const controller = new AbortController();
      sendAbortRef.current = controller;

      sendQueuedMessages(queue, telegramConfig.botToken, (updatedItems) => {
        const done = updatedItems.filter(i => i.status === 'sent' || i.status === 'failed').length;
        setSendDoneCount(done);
        setSendGroups(prev => prev.map(g => {
          const item = updatedItems.find(i => i.groupName === g.groupName);
          if (!item) return g;
          return {
            ...g,
            channels: g.channels.map(ch => ({
              ...ch,
              status: item.status,
            })),
            allDone: item.status === 'sent' || item.status === 'failed',
          };
        }));
      }, controller.signal).then(() => {
        setIsSending(false);
        if (!controller.signal.aborted) {
          const allSent = queue.filter(i => i.status === 'sent').length;
          const logEntry: AbsenceSendLogEntry = {
            id: `log_${Date.now()}`,
            sessionId,
            date: dateKey,
            time,
            subjectName,
            groups: groupDataList.map(g => g.groupName),
            studentCount: allNewRecords.length,
            channelsSent: allSent,
            totalChannels: queue.length,
            completedAt: new Date().toISOString(),
          };
          setAbsenceSendLogs(prev => [logEntry, ...prev]);
          const completedGroups: GroupSendProgress[] = groupDataList.map(g => {
            const items = queue.filter(i => i.groupName === g.groupName);
            return {
              groupName: g.groupName,
              channels: items.map(i => ({
                channelLabel: i.channelLabel,
                status: i.status as 'sent' | 'failed' | 'pending',
              })),
              allDone: items.every(i => i.status === 'sent' || i.status === 'failed'),
            };
          });
          setCompletedGroupData(prev => ({ ...prev, [sessionId]: completedGroups }));
        }
        setCurrentSendingSessionId(null);
      }).catch(() => {
        setIsSending(false);
        setCurrentSendingSessionId(null);
      });
    }
  };

  const handleTelegramConfigChange = (config: TelegramConfig | null) => setTelegramConfig(config);
  const handleUpdateProfile = (updatedUser: User) => setCurrentUser(updatedUser);

  const handleExitSelfRegister = () => {
    setRegisterToken(null);
    sessionStorage.removeItem('pendingRegToken');
    const url = new URL(window.location.href);
    url.searchParams.delete('reg');
    url.hash = '';
    window.history.replaceState({}, '', url.toString());
  };

  useEffect(() => {
    // ⚡ ميزة التوهج تعمل فقط بأجهزة الماوس، ومقيدة بـ rAF لتقليل العمل
    if (window.matchMedia?.('(hover: none)').matches) return;

    let ticking = false;
    let lastX = 0;
    let lastY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const target = (document.elementFromPoint(lastX, lastY)?.closest('button')) as HTMLElement | null;
        if (!target) return;
        const rect = target.getBoundingClientRect();
        target.style.setProperty('--glow-x', `${lastX - rect.left}px`);
        target.style.setProperty('--glow-y', `${lastY - rect.top}px`);
      });
    };

    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const isAdmin = currentUser?.role === 'admin';
  const isCollegeAdmin = currentUser?.role === 'college_admin';
  const canEditStudents = isAdmin || isCollegeAdmin;
  const isMainAdmin = isAdmin;

  if (registerToken) {
    return <SelfRegisterPage token={registerToken} onExit={handleExitSelfRegister} />;
  }

  if (loading || !tokenChecked) {
    return (
      <div className="min-h-screen relative">
        <Aurora
          colorStops={['#0A0A0F', '#4F46E5', '#7C3AED']}
          blend={0.5}
          amplitude={1.0}
          speed={0.3}
        />
        <div className="relative z-10 flex items-center justify-center min-h-screen">
          <MorphingSquare className="w-16 h-16 bg-blue-500" />
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="relative min-h-screen">
        <Aurora
          colorStops={['#0A0A0F', '#4F46E5', '#7C3AED']}
          blend={0.5}
          amplitude={1.0}
          speed={0.3}
        />
        <div className="relative z-10">
          <Login onLogin={handleLogin} />
        </div>
      </div>
    );
  }

  const selectedStage = stages.find(s => s.id === selectedStageId);
  const selectedCollege = colleges.find(c => c.id === selectedCollegeId);

  return (
    <div className="relative min-h-screen" dir="rtl">
      <Aurora
        colorStops={['#0A0A0F', '#4F46E5', '#7C3AED']}
        blend={0.5}
        amplitude={1.0}
        speed={0.3}
      />
      <div className="relative z-10">
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
            <div className="overflow-x-auto scrollbar-none">
              <div className="flex flex-nowrap md:flex-wrap gap-2 md:gap-3 pt-3 pb-3 md:pb-3 md:pt-3 justify-start md:justify-center mb-4 md:mb-6">
                <button
                  onClick={() => setActiveTab('stage-selector')}
                  className={`tab-btn shrink-0 ${activeTab === 'stage-selector' ? 'active' : ''}`}
                >
                   اختيار المرحلة
                </button>
                {isMainAdmin && (
                  <>
                    <button
                      onClick={() => setActiveTab('colleges')}
                      className={`tab-btn shrink-0 ${activeTab === 'colleges' ? 'active' : ''}`}
                    >
                       إدارة الكليات
                    </button>
                    <button
                      onClick={() => setActiveTab('teachers')}
                      className={`tab-btn shrink-0 ${activeTab === 'teachers' ? 'active' : ''}`}
                    >
                       التدريسيين
                    </button>
                    <button
                      onClick={() => setActiveTab('system-settings')}
                      className={`tab-btn shrink-0 ${activeTab === 'system-settings' ? 'active' : ''}`}
                    >
                       إعدادات النظام
                    </button>
                  </>
                )}
                {(isMainAdmin || isCollegeAdmin) && (
                  <>
                    <button
                      onClick={() => setShowSendLink(true)}
                      className="btn-base btn-primary shrink-0"
                    >
                       إرسال روابط تسجيل
                    </button>
                    <div className="shrink-0 relative" style={{ overflow: 'visible' }}>
                      <button
                        onClick={() => setShowPendingRegistrations(true)}
                        className="btn-base btn-secondary"
                      >
                         طلبات التسجيل
                      </button>
                      {pendingCount > 0 && (
                        <span
                          className="absolute bg-red-500 text-white text-xs font-bold rounded-full min-w-[22px] h-[22px] px-1.5 flex items-center justify-center shadow-lg"
                          style={{ top: '-8px', left: '-8px', zIndex: 9999, animation: 'pulse-badge 1.5s ease-in-out infinite' }}
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
                    className={`tab-btn shrink-0 ${activeTab === 'teachers' ? 'active' : ''}`}
                  >
                    👨‍🏫 صلاحيات التدريسيين
                  </button>
                )}
                <button
                  onClick={() => setActiveTab('profile')}
                  className={`tab-btn shrink-0 ${activeTab === 'profile' ? 'active' : ''}`}
                >
                   الملف الشخصي
                </button>
              </div>
            </div>

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
                <CollegeManager
                  colleges={colleges} stages={stages} adminUid={currentUser.uid}
                  onAddCollege={handleAddCollege} onDeleteCollege={handleDeleteCollege}
                  onAddStage={handleAddStage} onDeleteStage={handleDeleteStage}
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
                  students={students} attendanceRecords={attendanceRecords} currentUser={currentUser}
                  onResetComplete={handleResetComplete}
                  stages={stages} colleges={colleges} onTelegramConfigChange={handleTelegramConfigChange}
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
                className={`tab-btn shrink-0 ${activeTab === 'sessions' ? 'active' : ''}`}
              >
                📋 السجلات ({sessions.length})
              </button>
              <button
                onClick={() => setActiveTab('login')}
                className={`tab-btn shrink-0 ${activeTab === 'login' ? 'active' : ''}`}
              >
                📝 تسجيل الحضور
              </button>
              <button
                onClick={() => setActiveTab('manage')}
                className={`tab-btn shrink-0 ${activeTab === 'manage' ? 'active' : ''}`}
              >
                👥 {canEditStudents ? `إدارة الطلاب (${students.length})` : `الطلاب (${students.length})`}
              </button>
              <button
                onClick={() => setActiveTab('records')}
                className={`tab-btn shrink-0 ${activeTab === 'records' ? 'active' : ''}`}
              >
                📊 سجل الحضور ({attendanceRecords.length})
              </button>
              {(isMainAdmin || isCollegeAdmin) && (
                <div className="shrink-0 relative" style={{ overflow: 'visible' }}>
                  <button
                    onClick={() => setShowPendingRegistrations(true)}
                    className="btn-base btn-secondary text-xs py-1.5 px-2"
                  >
                    📋 طلبات التسجيل
                  </button>
                  {pendingCount > 0 && (
                    <span
                      className="absolute bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[20px] h-[20px] px-1 flex items-center justify-center shadow-lg"
                      style={{ top: '-7px', left: '-7px', zIndex: 9999, animation: 'pulse-badge 1.5s ease-in-out infinite' }}
                    >
                      {pendingCount > 99 ? '99+' : pendingCount}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div key={`stage-tab-${activeTab}`} className="animate-pageEnter">
              {activeTab === 'sessions' && (
                <SessionManager
                  sessions={sessions} activeSessionId={activeSessionId}
                  onCreateSession={handleCreateSession} onSelectSession={handleSelectSession}
                  onDeleteSession={handleDeleteSession} onRenameSession={handleRenameSession}
                  students={students} records={attendanceRecords} onMarkAbsent={handleMarkAbsent}
                  absenceSendLogs={absenceSendLogs}
                  isSending={isSending}
                  currentSendingSessionId={currentSendingSessionId}
                  sendGroups={sendGroups}
                  sendDoneCount={sendDoneCount}
                  sendTotalGroups={sendTotalGroups}
                  completedGroupData={completedGroupData}
                />
              )}
              {activeTab === 'login' && (
                <div className="max-w-lg mx-auto">
                  {!activeSessionId ? (
                    <div className="glass-card-sm p-6 text-center">
                      <p className="text-amber-300 font-medium mb-4">لا يوجد سجل نشط!</p>
                      <button onClick={() => setActiveTab('sessions')} className="btn-base btn-primary px-6 py-2">
                        انتقل لإدارة السجلات
                      </button>
                    </div>
                  ) : students.length === 0 ? (
                    <div className="glass-card-sm p-6 text-center">
                      <p className="text-amber-300 font-medium">لا يوجد طلاب في هذه المرحلة</p>
                    </div>
                  ) : (
                    <AttendanceLogin
                      students={students} activeSessionId={activeSessionId}
                      activeSession={sessions.find(s => s.id === activeSessionId) || null}
                      records={attendanceRecords} onAttendanceRecord={handleAttendanceRecord}
                      onUpdateStudent={handleUpdateStudent} currentUser={currentUser}
                    />
                  )}
                </div>
              )}
              {activeTab === 'manage' && (
                canEditStudents ? (
                  <StudentManager
                    students={students} onAddStudent={handleAddStudent}
                    onAddMultipleStudents={handleAddMultipleStudents} onUpdateStudent={handleUpdateStudent}
                    onDeleteStudent={handleDeleteStudent} onDeleteSelectedStudents={handleDeleteSelectedStudents}
                    onSortByName={handleSortByName} onSortByGroup={handleSortByGroup}
                  />
                ) : (
                  <StudentsViewer students={students} />
                )
              )}
              {activeTab === 'records' && (
                <AttendanceRecords
                  records={attendanceRecords} sessions={sessions} students={students}
                  activeSessionId={activeSessionId} onClearRecords={handleClearRecords}
                />
              )}
            </div>
          </div>
        )}

        {/* ✨ Footer */}
        <div className="mt-12 text-center text-white/40">
          <p className="text-sm">نظام تسجيل الحضور الإلكتروني - {new Date().getFullYear()}</p>
          <div className="mt-2 flex justify-center">
            <TextScramble text="BY - PH. Mujtaba Haitham" />
          </div>
        </div>
      </div>

      {/* ✨ الشات بوت الذكي */}
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

      {showPendingRegistrations && currentUser && (isMainAdmin || isCollegeAdmin) && (
        <PendingRegistrations
          adminUid={currentUser.uid}
          dataAdminUid={isCollegeAdmin ? getAdminUid() : undefined}
          onClose={() => setShowPendingRegistrations(false)}
        />
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
      </div>
    </div>
  );
}

export default App;