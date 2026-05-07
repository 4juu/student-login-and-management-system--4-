import { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { Student, AttendanceRecord, AttendanceSession } from './types/student';
import { User } from './types/user';
import { StudentManager } from './components/StudentManager';
import { AttendanceLogin } from './components/AttendanceLogin';
import { AttendanceRecords } from './components/AttendanceRecords';
import { Settings } from './components/Settings';
import { SessionManager } from './components/SessionManager';
import { Login } from './components/Login';
import { TeacherManagement } from './components/TeacherManagement';
import { ProfileSettings } from './components/ProfileSettings';
import { auth } from './firebase/config';
import { signIn, signOut } from './firebase/authService';
import {
  loadAllData,
  saveStudents,
  saveAttendanceRecords,
  saveSessions,
  saveActiveSession,
  saveUserData,
} from './firebase/dataService';

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);

  const [students, setStudents] = useState<Student[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'login' | 'manage' | 'records' | 'settings' | 'sessions' | 'teachers' | 'profile'>('sessions');

 // Check auth state
useEffect(() => {
  const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      // User is signed in - Load full user data from database
      try {
        const { ref: dbRef, get } = await import('firebase/database');
        const { database } = await import('./firebase/config');
        
        const userRef = dbRef(database, `users/${firebaseUser.uid}`);
        const snapshot = await get(userRef);
        
        let userData: User;
        
        if (snapshot.exists()) {
          // User data exists in database - use it
          userData = snapshot.val();
          console.log('✅ Loaded user data from Firebase:', userData);
        } else {
          // First time user - create basic data
          userData = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
            role: firebaseUser.email?.toLowerCase() === 'mujtabahaitham@gmail.com' ? 'admin' : 'teacher',
            createdAt: firebaseUser.metadata.creationTime || new Date().toISOString(),
            lastLogin: new Date().toISOString()
          };
          
          // Save to database
          const { set } = await import('firebase/database');
          await set(userRef, userData);
          console.log('✅ Created new user data in Firebase:', userData);
        }
        
        setCurrentUser(userData);
        
        // Load user data from Firebase
        await loadUserData(firebaseUser.uid);
      } catch (error) {
        console.error('❌ Error loading user:', error);
        setCurrentUser(null);
      }
    } else {
      // User is signed out
      setCurrentUser(null);
      resetData();
    }
    setLoading(false);
  });
  return () => unsubscribe();
}, []);
  
  // Load user data from Firebase
  const loadUserData = async (uid: string) => {
    setDataLoading(true);
    try {
      console.log('Loading data for user:', uid);
      const data = await loadAllData(uid);
      console.log('Loaded data:', data);
      setStudents(data.students || []);
      setAttendanceRecords(data.attendanceRecords || []);
      setSessions(data.sessions || []);
      setActiveSessionId(data.activeSessionId || null);
    } catch (error) {
      console.error('Error loading user data:', error);
    } finally {
      setDataLoading(false);
    }
  };

  // Reset data on logout
  const resetData = () => {
    setStudents([]);
    setAttendanceRecords([]);
    setSessions([]);
    setActiveSessionId(null);
    setActiveTab('sessions');
  };

  // Auto-save to Firebase
  useEffect(() => {
    if (currentUser) {
      saveStudents(currentUser.uid, students);
    }
  }, [students, currentUser]);
  useEffect(() => {
  if (currentUser) {
    saveUserData(currentUser.uid, currentUser);
  }
}, [currentUser]);

  useEffect(() => {
    if (currentUser) {
      saveAttendanceRecords(currentUser.uid, attendanceRecords);
    }
  }, [attendanceRecords, currentUser]);

  useEffect(() => {
    if (currentUser) {
      saveSessions(currentUser.uid, sessions);
    }
  }, [sessions, currentUser]);

  useEffect(() => {
    if (currentUser) {
      saveActiveSession(currentUser.uid, activeSessionId);
    }
  }, [activeSessionId, currentUser]);

  // Handlers
  const handleLogin = async (email: string, password: string) => {
    const user = await signIn(email, password);
    setCurrentUser(user);
  };

  const handleLogout = async () => {
    if (window.confirm('هل أنت متأكد من تسجيل الخروج؟')) {
      await signOut();
      setCurrentUser(null);
      resetData();
    }
  };

  const handleAddStudent = (student: Student) => {
    setStudents([...students, student]);
  };

  const handleDeleteStudent = (id: string) => {
    if (window.confirm('هل أنت متأكد من حذف هذا الطالب؟')) {
      setStudents(students.filter(s => s.id !== id));
    }
  };

  const handleAttendanceRecord = (record: AttendanceRecord) => {
    setAttendanceRecords([...attendanceRecords, record]);
  };

  const handleClearRecords = () => {
    setAttendanceRecords([]);
  };

  const handleDataRestored = () => {
    if (currentUser) {
      loadUserData(currentUser.uid);
    }
  };

  const handleUpdateProfile = (updatedUser: User) => {
    setCurrentUser(updatedUser);
  };

  const handleCreateSession = (session: AttendanceSession) => {
    const updatedSessions = sessions.map(s => ({ ...s, isActive: false }));
    setSessions([...updatedSessions, session]);
    setActiveSessionId(session.id);
  };

  const handleSelectSession = (sessionId: string) => {
    const updatedSessions = sessions.map(s => ({
      ...s,
      isActive: s.id === sessionId,
    }));
    setSessions(updatedSessions);
    setActiveSessionId(sessionId);
  };

  const handleDeleteSession = (sessionId: string) => {
    const updatedSessions = sessions.filter(s => s.id !== sessionId);
    setSessions(updatedSessions);
    
    const updatedRecords = attendanceRecords.filter(r => r.sessionId !== sessionId);
    setAttendanceRecords(updatedRecords);
    
    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
    }
  };

  // Show loading spinner
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-12 w-12 text-blue-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600">جارٍ التحميل...</p>
        </div>
      </div>
    );
  }

  // Show login page if not authenticated
  if (!currentUser) {
    return <Login onLogin={handleLogin} />;
  }

  // Main app
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100" dir="rtl">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
          <div className="text-center mb-8">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-3">
                <div 
                  className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center overflow-hidden border-2 border-white shadow-lg cursor-pointer hover:scale-105 transition-transform"
                  onClick={() => setActiveTab('profile')}
                  title="إعدادات الملف الشخصي"
                >
                  {currentUser.photoURL ? (
                    <img
                      src={currentUser.photoURL}
                      alt={currentUser.displayName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-white font-bold text-lg">
                      {currentUser.displayName.charAt(0)}
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-600">مرحباً،</p>
                  <p className="font-bold text-gray-800">{currentUser.displayName}</p>
                  {currentUser.bio && (
                    <p className="text-xs text-gray-500 mt-1 max-w-xs truncate">
                      {currentUser.bio}
                    </p>
                  )}
                  {currentUser.role === 'admin' && (
                    <span className="inline-block mt-1 px-2 py-1 bg-purple-100 text-purple-800 text-xs font-medium rounded-full">
                      👑 أدمن
                    </span>
                  )}
                </div>
            </div>
            
            <button
              onClick={handleLogout}
              className="bg-red-500 hover:bg-red-600 text-white font-medium py-2 px-4 rounded-md transition duration-200 flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              تسجيل الخروج
            </button>
          </div>

          <h1 className="text-4xl md:text-5xl font-bold text-gray-800 mb-2">
            نظام تسجيل حضور الطلاب
          </h1>
          <p className="text-gray-600 text-lg">
            نظام متكامل لإدارة حضور الطلاب بسهولة وفعالية
          </p>
          <div className="mt-4 inline-flex items-center gap-2 bg-green-100 text-green-800 px-4 py-2 rounded-full text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>متصل بـ Firebase - البيانات محفوظة في السحابة ✓</span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap justify-center gap-4 mb-8">
          <button
            onClick={() => setActiveTab('sessions')}
            className={`px-6 py-3 rounded-lg font-medium transition duration-200 ${
              activeTab === 'sessions'
                ? 'bg-blue-600 text-white shadow-lg'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            📋 السجلات ({sessions.length})
          </button>
          <button
            onClick={() => setActiveTab('login')}
            className={`px-6 py-3 rounded-lg font-medium transition duration-200 ${
              activeTab === 'login'
                ? 'bg-blue-600 text-white shadow-lg'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            📝 تسجيل الحضور
          </button>
          <button
            onClick={() => setActiveTab('manage')}
            className={`px-6 py-3 rounded-lg font-medium transition duration-200 ${
              activeTab === 'manage'
                ? 'bg-blue-600 text-white shadow-lg'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            👥 إدارة الطلاب ({students.length})
          </button>
          <button
            onClick={() => setActiveTab('records')}
            className={`px-6 py-3 rounded-lg font-medium transition duration-200 ${
              activeTab === 'records'
                ? 'bg-blue-600 text-white shadow-lg'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            📊 سجل الحضور ({attendanceRecords.length})
          </button>
          {currentUser.role === 'admin' && (
            <button
              onClick={() => setActiveTab('teachers')}
              className={`px-6 py-3 rounded-lg font-medium transition duration-200 ${
                activeTab === 'teachers'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              👨‍🏫 إدارة التدريسيين
            </button>
          )}
          <button
            onClick={() => setActiveTab('profile')}
            className={`px-6 py-3 rounded-lg font-medium transition duration-200 ${
              activeTab === 'profile'
                ? 'bg-blue-600 text-white shadow-lg'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            👤 الملف الشخصي
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-6 py-3 rounded-lg font-medium transition duration-200 ${
              activeTab === 'settings'
                ? 'bg-blue-600 text-white shadow-lg'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            ⚙️ الإعدادات
          </button>
        </div>

        {/* Loading indicator */}
        {dataLoading && (
          <div className="text-center py-4">
            <p className="text-gray-600">جارٍ تحميل البيانات...</p>
          </div>
        )}

        {/* Content */}
        <div className="max-w-6xl mx-auto">
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
                  <svg className="w-16 h-16 text-yellow-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <p className="text-yellow-800 font-medium mb-4">
                    لا يوجد سجل نشط!
                  </p>
                  <p className="text-yellow-700 mb-4">
                    يجب تفعيل سجل حضور أولاً قبل البدء بتسجيل حضور الطلاب
                  </p>
                  <button
                    onClick={() => setActiveTab('sessions')}
                    className="bg-yellow-600 hover:bg-yellow-700 text-white font-medium py-2 px-6 rounded-md transition duration-200"
                  >
                    انتقل لإدارة السجلات
                  </button>
                </div>
              ) : students.length === 0 ? (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
                  <p className="text-yellow-800 font-medium mb-4">
                    لا يوجد طلاب مسجلين في النظام
                  </p>
                  <button
                    onClick={() => setActiveTab('manage')}
                    className="bg-yellow-600 hover:bg-yellow-700 text-white font-medium py-2 px-6 rounded-md transition duration-200"
                  >
                    انتقل لإضافة الطلاب
                  </button>
                </div>
              ) : (
                <AttendanceLogin
                  students={students}
                  activeSessionId={activeSessionId}
                  onAttendanceRecord={handleAttendanceRecord}
                />
              )}
            </div>
          )}

          {activeTab === 'manage' && (
            <StudentManager
              students={students}
              onAddStudent={handleAddStudent}
              onDeleteStudent={handleDeleteStudent}
            />
          )}

          {activeTab === 'records' && (
            <AttendanceRecords
              records={attendanceRecords}
              sessions={sessions}
              activeSessionId={activeSessionId}
              onClearRecords={handleClearRecords}
            />
          )}

          {activeTab === 'teachers' && currentUser.role === 'admin' && (
            <TeacherManagement currentUser={currentUser} />
          )}

          {activeTab === 'profile' && (
            <ProfileSettings
              currentUser={currentUser}
              onUpdateProfile={handleUpdateProfile}
            />
          )}

          {activeTab === 'settings' && (
            <Settings
              students={students}
              attendanceRecords={attendanceRecords}
              onDataRestored={handleDataRestored}
            />
          )}
        </div>

        {/* Footer */}
        <div className="mt-12 text-center text-gray-600">
          <p className="text-sm">
            نظام تسجيل الحضور الإلكتروني - {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;
