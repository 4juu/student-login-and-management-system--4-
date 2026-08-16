import React, { useState, useEffect } from 'react';
import { 
  createTeacherAccount, 
  updateTeacherPermissions,
  updateTeacherPassword,
  deleteTeacherAccount,
  reactivateTeacher,
  getAllTeachers,
  getAllTeachersForCollege,
  promoteToCollegeAdmin,
  demoteFromCollegeAdmin
} from '../firebase/authService';
import { User, TeacherPermissions } from '../types/user';
import { College, Stage } from '../types/student';
import { ArrowLeft, BookOpen, CircleCheck, Crown, GraduationCap, KeyRound, Landmark, Lightbulb, LoaderCircle, Lock, Plus, RefreshCw, Save, Settings, SquarePen, Trash2, TriangleAlert, Truck, User as UserIcon, UserCheck, Users, Wrench } from 'lucide-react';

interface TeacherManagementProps {
  currentUser: User;
  colleges: College[];
  stages: Stage[];
}

export const TeacherManagement: React.FC<TeacherManagementProps> = React.memo(({ 
  currentUser, 
  colleges, 
  stages 
}) => {
  const [teachers, setTeachers] = useState<User[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showMigrationModal, setShowMigrationModal] = useState(false);
  const [selectedTeacher, setSelectedTeacher] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editProfileName, setEditProfileName] = useState('');
  const [editProfileBio, setEditProfileBio] = useState('');
  // للأدمن الرئيسي: اختيار كلية لعرض تدريسييها
  const [selectedCollegeId, setSelectedCollegeId] = useState<string | null>(null);
  // migratoryja: تعيين كلية للتدريسيين القدامى
  const [migrationMap, setMigrationMap] = useState<{[uid: string]: string}>({});

  // 🆕 إدارة أدمن الكلية من بطاقة الكلية
  const [showAssignAdminModal, setShowAssignAdminModal] = useState(false);
  const [assignAdminCollegeId, setAssignAdminCollegeId] = useState<string | null>(null);
  const [assignAdminCollegeName, setAssignAdminCollegeName] = useState('');
  const [showRemoveAdminConfirm, setShowRemoveAdminConfirm] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    displayName: '',
    collegeId: ''
  });

  const isMainAdmin = currentUser.role === 'admin';
  const isCollegeAdmin = currentUser.role === 'college_admin';

  useEffect(() => {
    loadTeachers();
  }, [selectedCollegeId]);

  const loadTeachers = async () => {
    try {
      if (isCollegeAdmin && currentUser.collegeId) {
        const list = await getAllTeachersForCollege(currentUser.collegeId);
        setTeachers(list);
        return;
      }

      if (isMainAdmin && selectedCollegeId) {
        if (selectedCollegeId === '__all__') {
          const { ref, get } = await import('firebase/database');
          const { database } = await import('../firebase/config');
          const snapshot = await get(ref(database, 'users'));
          const allList = snapshot.exists() ? Object.values(snapshot.val()).filter((u: any) => u.role === 'teacher' || u.role === 'college_admin') as User[] : [];
          setTeachers(allList);
        } else {
          const list = await getAllTeachersForCollege(selectedCollegeId);
          setTeachers(list);
        }
        return;
      }

      if (isMainAdmin && !selectedCollegeId) {
        const list = await getAllTeachers(currentUser.uid);
        const { ref, get } = await import('firebase/database');
        const { database } = await import('../firebase/config');
        const snapshot = await get(ref(database, 'users'));
        if (snapshot.exists()) {
          const allList = Object.values(snapshot.val()).filter(
            (u: any) => u.role === 'teacher' || u.role === 'college_admin'
          ) as User[];
          const merged = [...list];
          for (const t of allList) {
            if (!merged.find(m => m.uid === t.uid)) {
              merged.push(t);
            }
          }
          setTeachers(merged);
          return;
        }
        setTeachers(list);
        return;
      }

      setTeachers([]);
    } catch (e) { 
      console.error('Error loading teachers:', e); 
    }
  };

  const handleFixOldTeachers = async () => {
    if (!window.confirm('هذه الأداة ستربط جميع التدريسيين القدامى بحسابك (كأدمن) وتجهزهم لاستقبال الصلاحيات. متابعة؟')) return;
    setLoading(true);
    try {
      const { ref: dbRef, update } = await import('firebase/database');
      const { database } = await import('../firebase/config');
      let fixed = 0;
      for (const t of teachers) {
        const updates: any = { lastUpdated: new Date().toISOString() };
        let needsFix = false;
        if (!t.adminId) {
          updates.adminId = currentUser.uid;
          needsFix = true;
        }
        if (!t.permissions) {
          updates.permissions = {
            allowedStages: {},
            canViewRecords: true,
            canTakeAttendance: true,
          };
          needsFix = true;
        }
        if (t.active === undefined) {
          updates.active = true;
          updates.lastActivatedAt = new Date().toISOString();
          needsFix = true;
        }
        if (needsFix) {
          await update(dbRef(database, `users/${t.uid}`), updates);
          fixed++;
        }
      }
      await loadTeachers();
      alert(`تم إصلاح ${fixed} تدريسي.\nالآن تقدر تضغط "الصلاحيات" لكل واحد منهم وتحدد له المراحل.`);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReactivateTeacher = async (teacher: User) => {
    if (!window.confirm(
      `إعادة تفعيل ${teacher.displayName}؟\n\n` +
      `سيتم تفعيل حسابه بدون صلاحيات.\n` +
      `بعد ذلك يجب تحديد المراحل المسموحة له من زر "الصلاحيات".`
    )) return;
    setLoading(true);
    try {
      await reactivateTeacher(teacher.uid, {
        allowedStages: {},
        canViewRecords: true,
        canTakeAttendance: true,
      });
      setSuccess(`تم تفعيل ${teacher.displayName}. الآن حدد له المراحل من زر "الصلاحيات".`);
      await loadTeachers();
      setTimeout(() => setSuccess(''), 5000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStage = async (teacher: User, collegeId: string, stageId: string) => {
    const currentAllowed = teacher.permissions?.allowedStages || {};
    const stagesInCollege = currentAllowed[collegeId] || [];
    let newStages: string[];
    if (stagesInCollege.includes(stageId)) {
      newStages = stagesInCollege.filter(id => id !== stageId);
    } else {
      newStages = [...stagesInCollege, stageId];
    }
    const newAllowedStages = { ...currentAllowed };
    if (newStages.length === 0) {
      delete newAllowedStages[collegeId];
    } else {
      newAllowedStages[collegeId] = newStages;
    }
    const newPermissions: TeacherPermissions = {
      allowedStages: newAllowedStages,
      canViewRecords: teacher.permissions?.canViewRecords ?? true,
      canTakeAttendance: teacher.permissions?.canTakeAttendance ?? true,
    };
    try {
      await updateTeacherPermissions(teacher.uid, newPermissions);
      await loadTeachers();
      setSelectedTeacher({ ...teacher, permissions: newPermissions });
    } catch (e) {
      alert('فشل تحديث الصلاحيات');
    }
  };

  const handleSelectAllStagesInCollege = async (teacher: User, collegeId: string) => {
    const collegeStages = stages.filter(s => s.collegeId === collegeId);
    const allStageIds = collegeStages.map(s => s.id);
    const currentAllowed = teacher.permissions?.allowedStages || {};
    const newAllowedStages = { ...currentAllowed, [collegeId]: allStageIds };
    const newPermissions: TeacherPermissions = {
      allowedStages: newAllowedStages,
      canViewRecords: teacher.permissions?.canViewRecords ?? true,
      canTakeAttendance: teacher.permissions?.canTakeAttendance ?? true,
    };
    try {
      await updateTeacherPermissions(teacher.uid, newPermissions);
      await loadTeachers();
      setSelectedTeacher({ ...teacher, permissions: newPermissions });
    } catch (e) {
      alert('فشل تحديث الصلاحيات');
    }
  };

  const handleDeselectAllStagesInCollege = async (teacher: User, collegeId: string) => {
    const currentAllowed = teacher.permissions?.allowedStages || {};
    const newAllowedStages = { ...currentAllowed };
    delete newAllowedStages[collegeId];
    const newPermissions: TeacherPermissions = {
      allowedStages: newAllowedStages,
      canViewRecords: teacher.permissions?.canViewRecords ?? true,
      canTakeAttendance: teacher.permissions?.canTakeAttendance ?? true,
    };
    try {
      await updateTeacherPermissions(teacher.uid, newPermissions);
      await loadTeachers();
      setSelectedTeacher({ ...teacher, permissions: newPermissions });
    } catch (e) {
      alert('فشل تحديث الصلاحيات');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!formData.email || !formData.password || !formData.displayName) {
      return setError('املأ جميع الحقول');
    }
    if (formData.password.length < 6) {
      return setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
    }
    const collegeId = formData.collegeId || (selectedCollegeId || (isCollegeAdmin ? currentUser.collegeId : undefined));
    setLoading(true);
    try {
      await createTeacherAccount(
        formData.email,
        formData.password,
        formData.displayName,
        currentUser.uid,
        collegeId
      );
      setSuccess(`تم إنشاء حساب ${formData.displayName} بنجاح!\n\nالآن اضغط على "الصلاحيات" بجنب اسمه لتحديد المراحل المسموحة.`);
      setShowAddForm(false);
      setFormData({ email: '', password: '', displayName: '', collegeId: '' });
      await loadTeachers();
      setTimeout(() => setSuccess(''), 8000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenPasswordModal = (teacher: User) => {
    setSelectedTeacher(teacher);
    setNewPassword('');
    setShowPasswordModal(true);
    setError('');
  };

  const handleChangePassword = async () => {
    if (!selectedTeacher) return;
    setError('');
    if (!newPassword.trim() || newPassword.length < 6) {
      return setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
    }
    setLoading(true);
    try {
      await updateTeacherPassword(selectedTeacher.uid, newPassword);
      setSuccess(`تم تغيير كلمة مرور ${selectedTeacher.displayName}\n\nالكلمة الجديدة: ${newPassword}`);
      setShowPasswordModal(false);
      setNewPassword('');
      setSelectedTeacher(null);
      setTimeout(() => setSuccess(''), 8000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEditProfile = async () => {
    if (!selectedTeacher || !editProfileName.trim()) return;
    setLoading(true);
    setError('');
    try {
      const { ref: dbRef, update } = await import('firebase/database');
      const { database } = await import('../firebase/config');
      await update(dbRef(database, `users/${selectedTeacher.uid}`), {
        displayName: editProfileName.trim(),
        bio: editProfileBio.trim(),
        lastUpdated: new Date().toISOString()
      });
      setSuccess(`تم تحديث ملف ${editProfileName.trim()}`);
      setShowProfileModal(false);
      await loadTeachers();
      setTimeout(() => setSuccess(''), 5000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTeacher = async (teacher: User) => {
    if (!window.confirm(`هل أنت متأكد من حذف حساب ${teacher.displayName}؟\n\nسيتم حذف جميع بياناته نهائياً!`)) return;
    setLoading(true);
    try {
      await deleteTeacherAccount(teacher.uid);
      setSuccess(`تم حذف حساب ${teacher.displayName}`);
      await loadTeachers();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ترحيل التدريسيين القدامى لتعيين كلية
  const handleMigrateCollege = async () => {
    setLoading(true);
    setError('');
    try {
      const { ref: dbRef, update } = await import('firebase/database');
      const { database } = await import('../firebase/config');
      let count = 0;
      for (const [uid, collegeId] of Object.entries(migrationMap)) {
        if (collegeId) {
          await update(dbRef(database, `users/${uid}`), {
            collegeId,
            lastUpdated: new Date().toISOString()
          });
          count++;
        }
      }
      setSuccess(`تم تعيين كلية لـ ${count} تدريسي`);
      setShowMigrationModal(false);
      setMigrationMap({});
      await loadTeachers();
      setTimeout(() => setSuccess(''), 5000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const countAllowedStages = (teacher: User): number => {
    if (!teacher.permissions?.allowedStages) return 0;
    return Object.values(teacher.permissions.allowedStages).flat().length;
  };

  const activeTeachers = teachers.filter(t => t.active !== false).length;
  const deactivatedTeachers = teachers.filter(t => t.active === false).length;

  // خريطة كل كلية → أدمنها الحالي
  const collegeAdminMap: {[collegeId: string]: User} = {};
  teachers.forEach(t => {
    if (t.role === 'college_admin' && t.collegeId) {
      collegeAdminMap[t.collegeId] = t;
    }
  });

  // --- شاشة كروت الكليات للأدمن الرئيسي ---
  if (isMainAdmin && !selectedCollegeId) {
    const allTeachersFull = teachers;
    const collegeTeacherCount: {[collegeId: string]: number} = {};
    for (const c of colleges) {
      collegeTeacherCount[c.id] = allTeachersFull.filter(t => t.collegeId === c.id).length;
    }
    const unassignedCount = allTeachersFull.filter(t => !t.collegeId).length;

    return (
      <div className="glass-card rounded-xl p-6">
        <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2"><GraduationCap className="w-6 h-6" /> اختيار الكلية لعرض التدريسيين</h2>
          <div className="flex gap-2 flex-wrap">
            {!selectedCollegeId && allTeachersFull.some(t => !t.collegeId) && (
              <button
                onClick={() => setShowMigrationModal(true)}
                disabled={loading}
                className="bg-orange-500 hover:bg-orange-600 disabled:bg-white/10 text-white font-medium py-2 px-4 rounded-md flex items-center gap-2 shadow-md"
              >
                <Truck className="w-4 h-4" /> ترحيل التدريسيين القدامى
              </button>
            )}
            <button
              onClick={handleFixOldTeachers}
              disabled={loading}
              className="bg-orange-500 hover:bg-orange-600 disabled:bg-white/10 text-white font-medium py-2 px-4 rounded-md flex items-center gap-2 shadow-md"
            >
              <Wrench className="w-4 h-4" /> إصلاح التدريسيين القدامى
            </button>
          </div>
        </div>

        {success && (
          <div className="mb-4 p-4 bg-green-500/10 border-2 border-green-500/40 text-green-300 rounded-md font-medium">{success}</div>
        )}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/40 text-red-300 rounded-md">{error}</div>
        )}

        {unassignedCount > 0 && (
          <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-center gap-3">
            <TriangleAlert className="w-7 h-7 text-yellow-600" />
            <div className="flex-1">
              <p className="text-sm font-bold text-yellow-300">
                يوجد {unassignedCount} تدريسي بدون كلية محددة — اضغط "ترحيل التدريسيين القدامى" لتعيين كلية لهم
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {colleges.map((college, idx) => {
            const count = collegeTeacherCount[college.id] || 0;
            const admin = collegeAdminMap[college.id];
            return (
              <div
                key={college.id}
                className="animate-cardEnter border-2 border-white/10 rounded-xl hover:border-blue-400 hover:shadow-lg transition-all duration-300 overflow-hidden bg-white/5"
                style={{ animationDelay: `${idx * 60}ms` }}
              >
                {/* رأس البطاقة - قابلة للضغط للدخول للكلية */}
                <button
                  onClick={() => setSelectedCollegeId(college.id)}
                  className="w-full p-5 text-right hover:bg-blue-500/10 transition-colors"
                >
                  <div className="text-4xl mb-3">{college.icon || '🏛️'}</div>
                  <h3 className="text-xl font-bold text-white">{college.name}</h3>
                  <p className="text-sm text-slate-400 mt-1">
                    {count} تدريسي{count !== 1 ? 'ين' : ''}
                    {count === 0 && ' — لا يوجد تدريسيين بعد'}
                  </p>
                </button>

                {/* شريط أدمن الكلية */}
                <div className={`px-5 py-3 border-t ${admin ? 'bg-amber-500/10 border-amber-500/30' : 'bg-white/5 border-white/10'}`}>
                  {admin ? (
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Landmark className="w-5 h-5 text-amber-300" />
                        <div className="min-w-0">
                          <p className="text-xs text-amber-300 font-medium">أدمن الكلية</p>
                          <p className="text-sm font-bold text-amber-200 truncate">{admin.displayName}</p>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setAssignAdminCollegeId(college.id);
                            setAssignAdminCollegeName(college.name);
                            setShowAssignAdminModal(true);
                          }}
                          className="text-xs bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 px-2.5 py-1.5 rounded-md font-medium transition"
                        >
                          <RefreshCw className="w-3.5 h-3.5" /> تغيير
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowRemoveAdminConfirm(college.id);
                          }}
                          className="text-xs bg-red-500/10 hover:bg-red-500/25 text-red-300 px-2.5 py-1.5 rounded-md font-medium transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> إلغاء
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-slate-400">لا يوجد أدمن للكلية</p>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setAssignAdminCollegeId(college.id);
                          setAssignAdminCollegeName(college.name);
                          setShowAssignAdminModal(true);
                        }}
                        disabled={count === 0}
                        className={`text-xs font-medium px-3 py-1.5 rounded-md transition ${
                          count === 0
                            ? 'bg-white/10 text-slate-500 cursor-not-allowed'
                            : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300'
                        }`}
                      >
                        تعيين أدمن
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {/* بطاقة عرض الكل */}
          <button
            onClick={() => setSelectedCollegeId('__all__')}
            className="p-6 border-2 border-dashed border-slate-600 rounded-xl hover:border-slate-400 hover:shadow-lg transition-all duration-300 text-center bg-white/5"
          >
            <Users className="w-12 h-12 text-slate-500 mx-auto mb-3" />
            <h3 className="text-xl font-bold text-white">عرض الكل</h3>
            <p className="text-sm text-slate-400 mt-2">{allTeachersFull.length} تدريسي</p>
          </button>
        </div>

        {/* 🆕 مودال تعيين أدمن لكلية */}
        {showAssignAdminModal && assignAdminCollegeId && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 animate-fadeIn">
            <div className="bg-slate-900 border border-white/10 text-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-xl font-bold text-white flex items-center gap-2"><Landmark className="w-5 h-5 text-amber-300" /> تعيين أدمن لكلية {assignAdminCollegeName}</h3>
                  <p className="text-sm text-slate-400 mt-1">اختر التدريسي من القائمة لتعيينه أدمن للكلية</p>
                </div>
                <button onClick={() => setShowAssignAdminModal(false)} className="text-3xl text-slate-500 hover:text-slate-400 leading-none">&times;</button>
              </div>

              {(() => {
                const collegeTeachers = allTeachersFull.filter(t => 
                  t.collegeId === assignAdminCollegeId && t.role !== 'college_admin' && t.active !== false
                );
                const currentAdmin = collegeAdminMap[assignAdminCollegeId];

                if (collegeTeachers.length === 0) {
                  return (
                    <div className="text-center py-10 text-slate-400">
                      <UserIcon className="w-14 h-14 text-slate-600 mx-auto mb-4" />
                      <p className="font-medium">لا يوجد تدريسيين في هذه الكلية</p>
                      <p className="text-sm mt-1">أضف تدريسيين أولاً من داخل الكلية</p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-2">
                    {currentAdmin && (
                      <div className="p-3 bg-amber-500/10 border-2 border-amber-500/30 rounded-xl mb-4 flex items-center gap-3">
                        <Crown className="w-8 h-8 text-amber-400" />
                        <div>
                          <p className="text-xs text-amber-300 font-medium">الأدمن الحالي</p>
                          <p className="font-bold text-amber-200">{currentAdmin.displayName}</p>
                        </div>
                      </div>
                    )}
                    {collegeTeachers.map(t => (
                      <button
                        key={t.uid}
                        onClick={async () => {
                          if (!window.confirm(`تعيين ${t.displayName} أدمن لكلية ${assignAdminCollegeName}؟`)) return;
                          setLoading(true);
                          try {
                            await promoteToCollegeAdmin(t.uid, assignAdminCollegeId, assignAdminCollegeName);
                            alert(`تم تعيين ${t.displayName} أدمن لكلية ${assignAdminCollegeName}`);
                            setShowAssignAdminModal(false);
                            await loadTeachers();
                          } catch (e: any) {
                            alert(e.message);
                          } finally {
                            setLoading(false);
                          }
                        }}
                        disabled={loading}
                        className="w-full text-right p-4 border-2 border-white/10 rounded-xl hover:border-amber-400 hover:bg-amber-500/10 transition-all duration-200 flex items-center gap-3 group"
                      >
                        <div className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center overflow-hidden shrink-0">
                          {t.photoURL ? (
                            <img src={t.photoURL} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-slate-400 font-bold">{t.displayName.charAt(0)}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-white">{t.displayName}</p>
                          <p className="text-xs text-slate-400 truncate">{t.email}</p>
                        </div>
                        <ArrowLeft className="w-6 h-6 text-amber-400 opacity-0 group-hover:opacity-100 transition-all duration-200" />
                      </button>
                    ))}
                  </div>
                );
              })()}

              <div className="mt-6 pt-4 border-t border-white/10 flex justify-end">
                <button
                  onClick={() => setShowAssignAdminModal(false)}
                  className="bg-white/10 hover:bg-white/20 text-white font-medium py-2 px-6 rounded-lg transition"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 🆕 تأكيد إلغاء أدمن كلية */}
        {showRemoveAdminConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 animate-fadeIn">
            <div className="bg-slate-900 border border-white/10 text-white rounded-2xl max-w-sm w-full p-6 shadow-2xl">
              <div className="text-center mb-6">
                <div className="mx-auto w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4"><TriangleAlert className="w-7 h-7 text-red-400" /></div>
                <h3 className="text-xl font-bold text-white">إلغاء أدمن الكلية</h3>
                <p className="text-sm text-slate-400 mt-2">
                  هل أنت متأكد من إلغاء تعيين <strong className="text-slate-300">{collegeAdminMap[showRemoveAdminConfirm]?.displayName}</strong> كأدمن لكلية {colleges.find(c => c.id === showRemoveAdminConfirm)?.name}؟
                </p>
                <p className="text-xs text-slate-500 mt-2">سيتم تحويله إلى تدريسي عادي مع احتفاظه بنفس الصلاحيات</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowRemoveAdminConfirm(null)}
                  className="flex-1 bg-white/10 hover:bg-white/20 text-slate-300 font-medium py-2.5 rounded-lg transition"
                >
                  تراجع
                </button>
                <button
                  onClick={async () => {
                    const admin = collegeAdminMap[showRemoveAdminConfirm];
                    if (!admin) return;
                    setLoading(true);
                    try {
                      await demoteFromCollegeAdmin(admin.uid);
                      alert(`تم إلغاء أدمن الكلية عن ${admin.displayName}`);
                      setShowRemoveAdminConfirm(null);
                      await loadTeachers();
                    } catch (e: any) {
                      alert(e.message);
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={loading}
                  className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-medium py-2.5 rounded-lg transition flex items-center justify-center gap-2"
                >
                  {loading ? 'جاري...' : <><CircleCheck className="w-4 h-4" /> تأكيد الإلغاء</>}
                </button>
              </div>
            </div>
          </div>
        )}

        {showMigrationModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-900 border border-white/10 text-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
              <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><Truck className="w-5 h-5" /> ترحيل التدريسيين القدامى — تعيين كلية</h3>
              <p className="text-sm text-slate-400 mb-4">اختر الكلية المناسبة لكل تدريسي:</p>
              <div className="space-y-3">
                {allTeachersFull.filter(t => !t.collegeId).map(t => (
                  <div key={t.uid} className="flex items-center gap-3 p-3 border border-white/10 rounded-lg">
                    <div className="flex-1 font-medium text-white">{t.displayName}</div>
                    <select
                      value={migrationMap[t.uid] || ''}
                      onChange={e => setMigrationMap(prev => ({...prev, [t.uid]: e.target.value}))}
                      className="border border-slate-600 bg-slate-800 text-white rounded px-3 py-2 text-sm"
                    >
                      <option value="">-- اختر كلية --</option>
                      {colleges.map(c => (
                        <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 justify-end mt-6">
                <button
                  onClick={() => { setShowMigrationModal(false); setMigrationMap({}); }}
                  disabled={loading}
                  className="bg-white/10 hover:bg-white/20 text-white font-medium py-2 px-4 rounded"
                >
                  إلغاء
                </button>
                <button
                  onClick={handleMigrateCollege}
                  disabled={loading}
                  className="bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-medium py-2 px-4 rounded"
                >
                  {loading ? 'جارٍ الحفظ...' : '💾 حفظ'}
                </button>
              </div>
            </div>
          </div>
        )}


      </div>
    );
  }

  // --- شاشة عرض تدريسيين كلية محددة للأدمن الرئيسي أو شاشة أدمن الكلية ---
  const displayTeachers = selectedCollegeId === '__all__'
    ? teachers
    : teachers;
  const collegeName = isCollegeAdmin
    ? (colleges.find(c => c.id === currentUser.collegeId)?.name || '')
    : selectedCollegeId
    ? (colleges.find(c => c.id === selectedCollegeId)?.name || '')
    : '';

  return (
    <div className="glass-card rounded-xl p-6 animate-cardEnter">
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {isMainAdmin && (
            <button
              onClick={() => { setSelectedCollegeId(null); setTeachers([]); }}
              className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm font-medium hover:underline transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
              العودة للكليات
            </button>
          )}
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            {isMainAdmin ? <><GraduationCap className="w-6 h-6" /> تدريسيون كلية {collegeName}</> : <><Landmark className="w-6 h-6" /> صلاحيات التدريسيين</>}
          </h2>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isMainAdmin && (
            <button 
              onClick={() => setShowAddForm(!showAddForm)} 
              className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white font-medium py-2 px-4 rounded-md flex items-center gap-2 shadow-md"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              إضافة تدريسي
            </button>
          )}
        </div>
      </div>

      {displayTeachers.length > 0 && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-center">
            <div className="text-2xl font-bold text-blue-300">{displayTeachers.length}</div>
            <div className="text-xs text-blue-400">إجمالي التدريسيين</div>
          </div>
          <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-center">
            <div className="text-2xl font-bold text-green-300">{activeTeachers}</div>
            <div className="text-xs text-green-400 flex items-center justify-center gap-1"><CircleCheck className="w-3.5 h-3.5" /> مفعّل</div>
          </div>
          {deactivatedTeachers > 0 && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-center">
              <div className="text-2xl font-bold text-red-300">{deactivatedTeachers}</div>
              <div className="text-xs text-red-400 flex items-center justify-center gap-1"><Lock className="w-3.5 h-3.5" /> معطّل (بعد التصفير)</div>
            </div>
          )}
        </div>
      )}

      {deactivatedTeachers > 0 && (
        <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-center gap-3">
          <TriangleAlert className="w-7 h-7 text-yellow-600" />
          <div className="flex-1">
            <p className="text-sm font-bold text-yellow-300">
              يوجد {deactivatedTeachers} تدريسي معطّل بعد التصفير السنوي
            </p>
            <p className="text-xs text-yellow-400">
              اضغط زر "إعادة تفعيل" بجانب اسم التدريسي لإعادة تفعيله، ثم حدد له المراحل من "الصلاحيات".
            </p>
          </div>
        </div>
      )}

      {success && (
        <div className="p-3 bg-green-500/10 border border-green-500/40 text-green-300 rounded mb-4 whitespace-pre-line">{success}</div>
      )}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/40 text-red-300 rounded mb-4">{error}</div>
      )}

      {showAddForm && (
        <form onSubmit={handleSubmit} className="mb-6 p-5 bg-gradient-to-br from-blue-500/10 to-indigo-500/10 border-2 border-blue-500/30 rounded-lg">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Plus className="w-5 h-5" /> إضافة تدريسي جديد</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">الاسم الكامل</label>
              <input type="text" value={formData.displayName} onChange={e => setFormData({...formData, displayName: e.target.value})} className="w-full p-2 border border-slate-600 bg-slate-800 text-white rounded-md focus:ring-2 focus:ring-blue-500" placeholder="د. أحمد محمد" disabled={loading} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">البريد الإلكتروني</label>
              <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full p-2 border border-slate-600 bg-slate-800 text-white rounded-md focus:ring-2 focus:ring-blue-500" placeholder="teacher@example.com" dir="ltr" disabled={loading} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">كلمة المرور</label>
              <input type="text" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} className="w-full p-2 border border-slate-600 bg-slate-800 text-white rounded-md focus:ring-2 focus:ring-blue-500" placeholder="6 أحرف على الأقل" dir="ltr" disabled={loading} />
            </div>
          </div>
          {(isMainAdmin && !selectedCollegeId) && colleges.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-300 mb-2">الكلية</label>
              <select value={formData.collegeId} onChange={e => setFormData({...formData, collegeId: e.target.value})} className="w-full p-2 border border-slate-600 bg-slate-800 text-white rounded-md focus:ring-2 focus:ring-blue-500">
                <option value="">-- اختر الكلية --</option>
                {colleges.map(c => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-6 rounded-md flex items-center justify-center gap-2">
              {loading ? <><LoaderCircle className="w-4 h-4 animate-spin" /> جارٍ الإنشاء...</> : <><CircleCheck className="w-4 h-4" /> إنشاء الحساب</>}
            </button>
            <button type="button" onClick={() => { setShowAddForm(false); setFormData({ email: '', password: '', displayName: '', collegeId: '' }); setError(''); }} className="bg-white/10 hover:bg-white/20 text-white font-medium py-2 px-4 rounded-md">
              إلغاء
            </button>
          </div>
          <div className="mt-3 p-3 bg-green-500/10 border border-green-500/30 rounded text-sm text-green-300 flex items-start gap-1">
            <CircleCheck className="w-4 h-4 shrink-0 mt-0.5" /> <strong>جلسة الأدمن محفوظة:</strong> النظام يستخدم تطبيق Firebase ثانوي لإنشاء حساب التدريسي بدون التأثير على جلستك الحالية.
          </div>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-white/10">
          <thead className="bg-white/5">
            <tr>
              <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase">التدريسي</th>
              <th className="hidden sm:table-cell px-3 sm:px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase">البريد</th>
              <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase">الحالة</th>
              <th className="hidden sm:table-cell px-3 sm:px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase">الصلاحيات</th>
              <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase">إجراءات</th>
            </tr>
          </thead>
          <tbody className="bg-white/5 divide-y divide-white/10">
            {displayTeachers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-slate-400">
                  لا توجد حسابات تدريسيين في هذه الكلية
                </td>
              </tr>
            ) : (
              displayTeachers.map(t => {
                const allowedCount = countAllowedStages(t);
                const isOldTeacher = !t.adminId || !t.permissions;
                const isDeactivated = t.active === false;
                return (
                  <tr key={t.uid} className={`hover:bg-white/5 ${isDeactivated ? 'bg-red-500/10' : isOldTeacher ? 'bg-yellow-500/10' : ''}`}>
                    <td className="px-3 sm:px-6 py-4">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 bg-blue-500/15 rounded-full flex items-center justify-center overflow-hidden shrink-0">
                          {t.photoURL ? (
                            <img src={t.photoURL} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-blue-300 font-bold">{t.displayName.charAt(0)}</span>
                          )}
                        </div>
                        <div>
                          <div className="font-bold text-white">
                            {t.displayName}
                            {isOldTeacher && (
                              <span className="mr-2 text-xs bg-orange-500/15 text-orange-300 px-2 py-0.5 rounded-full">يحتاج إصلاح</span>
                            )}
                          </div>
                          {t.bio && <div className="text-xs text-slate-400 truncate max-w-xs">{t.bio}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="hidden sm:table-cell px-3 sm:px-6 py-4 text-xs sm:text-sm text-slate-400" dir="ltr">{t.email}</td>
                    <td className="px-3 sm:px-6 py-4 text-xs sm:text-sm">
                      {isDeactivated ? (
                        <span className="inline-flex items-center px-2 sm:px-3 py-1 rounded-full bg-red-500/15 text-red-300 font-medium text-[10px] sm:text-xs gap-1"><Lock className="w-3 h-3" /> معطّل</span>
                      ) : (
                        <span className="inline-flex items-center px-2 sm:px-3 py-1 rounded-full bg-green-500/15 text-green-300 font-medium text-[10px] sm:text-xs gap-1"><CircleCheck className="w-3 h-3" /> مفعّل</span>
                      )}
                    </td>
                    <td className="hidden sm:table-cell px-3 sm:px-6 py-4 text-xs sm:text-sm">
                      {allowedCount === 0 ? (
                        <span className="inline-flex items-center px-2 sm:px-3 py-1 rounded-full bg-red-500/15 text-red-300 font-medium text-[10px] sm:text-xs gap-1"><Lock className="w-3 h-3" /> لا توجد صلاحيات</span>
                      ) : (
                        <span className="inline-flex items-center px-2 sm:px-3 py-1 rounded-full bg-green-500/15 text-green-300 font-medium text-[10px] sm:text-xs gap-1"><CircleCheck className="w-3 h-3" /> {allowedCount} مرحلة</span>
                      )}
                    </td>
                    <td className="px-3 sm:px-6 py-4 text-xs sm:text-sm">
                      <div className="flex flex-wrap gap-1 sm:gap-2">
                        {isDeactivated && (
                          <button onClick={() => handleReactivateTeacher(t)} disabled={loading} className="bg-green-500/15 hover:bg-green-500/25 text-green-300 px-2 sm:px-3 py-1 rounded font-medium text-[10px] sm:text-xs inline-flex items-center gap-1"><UserCheck className="w-3 h-3" /> إعادة تفعيل</button>
                        )}
                        <button onClick={() => { setSelectedTeacher(t); setShowPermissionModal(true); }} className="bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 px-2 sm:px-3 py-1 rounded font-medium text-[10px] sm:text-xs inline-flex items-center gap-1"><Settings className="w-3 h-3" /> الصلاحيات</button>
                        <button onClick={() => { setSelectedTeacher(t); setEditProfileName(t.displayName); setEditProfileBio(t.bio || ''); setShowProfileModal(true); }} className="bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 px-2 sm:px-3 py-1 rounded font-medium text-[10px] sm:text-xs inline-flex items-center gap-1"><SquarePen className="w-3 h-3" /> الملف</button>
                        {isMainAdmin && (
                          <button onClick={() => handleOpenPasswordModal(t)} className="bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 px-2 sm:px-3 py-1 rounded font-medium text-[10px] sm:text-xs inline-flex items-center gap-1"><KeyRound className="w-3 h-3" /> الرمز</button>
                        )}
                          {isMainAdmin && t.role === 'college_admin' && (
                            <button onClick={async () => { if (window.confirm(`إلغاء أدمن كلية عن ${t.displayName}؟`)) { await demoteFromCollegeAdmin(t.uid); await loadTeachers(); } }} disabled={loading} className="bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 px-2 sm:px-3 py-1 rounded font-medium text-[10px] sm:text-xs inline-flex items-center gap-1"><UserIcon className="w-3 h-3" /> إلغاء أدمن</button>
                          )}
                          {isMainAdmin && t.role !== 'college_admin' && (() => {
                            const cId = selectedCollegeId === '__all__' ? (t.collegeId || '') : (selectedCollegeId || '');
                            const cName = colleges.find(c => c.id === cId)?.name || '';
                            if (!cId) return null;
                            return (
                              <button onClick={async () => { if (window.confirm(`تعيين ${t.displayName} أدمن لكلية ${cName}؟`)) { await promoteToCollegeAdmin(t.uid, cId, cName); await loadTeachers(); } }} disabled={loading} className="bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 px-2 sm:px-3 py-1 rounded font-medium text-[10px] sm:text-xs inline-flex items-center gap-1"><Landmark className="w-3 h-3" /> تعيين أدمن</button>
                            );
                          })()}
                          {isMainAdmin && (
                          <button onClick={() => handleDeleteTeacher(t)} disabled={loading} className="bg-red-500/10 hover:bg-red-500/25 text-red-300 px-2 sm:px-3 py-1 rounded font-medium text-[10px] sm:text-xs inline-flex items-center gap-1"><Trash2 className="w-3 h-3" /> حذف</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showPermissionModal && selectedTeacher && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-white/10 text-white rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b flex justify-between items-center sticky top-0 bg-slate-900 z-10">
              <div>
                <h3 className="text-xl font-bold flex items-center gap-2"><Settings className="w-5 h-5" /> صلاحيات: {selectedTeacher.displayName}</h3>
                <p className="text-sm text-slate-400 mt-1">حدد المراحل المسموح للتدريسي بالوصول إليها</p>
              </div>
              <button onClick={() => setShowPermissionModal(false)} className="text-3xl text-slate-500 hover:text-slate-400">×</button>
            </div>
            <div className="p-6 space-y-4">
              {colleges.length === 0 ? (
                <div className="text-center py-8 text-slate-400">لا توجد كليات. أضف كلية أولاً من تبويب "إدارة الكليات"</div>
              ) : (
                colleges.map(college => {
                  const collegeStages = stages.filter(s => s.collegeId === college.id);
                  const allowedInCollege = selectedTeacher.permissions?.allowedStages?.[college.id] || [];
                  const allSelected = collegeStages.length > 0 && allowedInCollege.length === collegeStages.length;
                  return (
                    <div key={college.id} className="border-2 border-white/10 rounded-lg overflow-hidden">
                      <div className="bg-white/5 p-3 flex justify-between items-center">
                        <div className="font-bold text-lg">
                          {college.icon} {college.name}
                          <span className="text-sm font-normal text-slate-400 mr-2">({allowedInCollege.length}/{collegeStages.length})</span>
                        </div>
                        {collegeStages.length > 0 && (
                          <div className="flex gap-2">
                            <button onClick={() => handleSelectAllStagesInCollege(selectedTeacher, college.id)} disabled={allSelected} className="text-xs bg-green-600 hover:bg-green-700 disabled:bg-white/10 text-white px-2 py-1 rounded">تحديد الكل</button>
                            <button onClick={() => handleDeselectAllStagesInCollege(selectedTeacher, college.id)} disabled={allowedInCollege.length === 0} className="text-xs bg-red-600 hover:bg-red-700 disabled:bg-white/10 text-white px-2 py-1 rounded">إلغاء الكل</button>
                          </div>
                        )}
                      </div>
                      <div className="p-3">
                        {collegeStages.length === 0 ? (
                          <p className="text-sm text-slate-400 text-center py-3">لا توجد مراحل في هذه الكلية</p>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {collegeStages.sort((a, b) => (a.order || 0) - (b.order || 0)).map(stage => {
                              const isAllowed = allowedInCollege.includes(stage.id);
                              return (
                                <button key={stage.id} onClick={() => handleToggleStage(selectedTeacher, college.id, stage.id)} className={`p-3 rounded-md text-right flex justify-between items-center border-2 transition ${isAllowed ? 'bg-green-500/10 text-green-300 border-green-500/50' : 'bg-white/5 text-slate-400 border-white/10 hover:border-white/30'}`}>
                                  <span className="font-medium flex items-center gap-2"><BookOpen className="w-4 h-4" /> {stage.name}</span>
                                  {isAllowed ? <CircleCheck className="w-5 h-5 text-green-400" /> : <span className="w-5 h-5 border-2 border-slate-500 rounded" />}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="p-6 border-t bg-white/5 sticky bottom-0">
              <div className="flex justify-between items-center">
                <p className="text-sm text-slate-400">الإجمالي: <strong>{countAllowedStages(selectedTeacher)}</strong> مرحلة مسموحة</p>
                <button onClick={() => setShowPermissionModal(false)} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium flex items-center gap-2"><CircleCheck className="w-4 h-4" /> تم</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showProfileModal && selectedTeacher && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-white/10 text-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><SquarePen className="w-5 h-5" /> تعديل ملف التدريسي</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-300 mb-2">الاسم الكامل</label>
              <input type="text" value={editProfileName} onChange={e => setEditProfileName(e.target.value)} className="w-full px-4 py-2 border border-slate-600 bg-slate-800 text-white rounded-md focus:ring-2 focus:ring-blue-500" dir="rtl" />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-300 mb-2">الوصف / البايو</label>
              <textarea value={editProfileBio} onChange={e => setEditProfileBio(e.target.value)} rows={3} maxLength={500} className="w-full px-4 py-2 border border-slate-600 bg-slate-800 text-white rounded-md focus:ring-2 focus:ring-blue-500" dir="rtl" />
            </div>
            {error && <div className="mb-4 p-3 bg-red-500/10 border border-red-500/40 text-red-300 rounded text-sm">{error}</div>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowProfileModal(false); setError(''); }} disabled={loading} className="bg-white/10 hover:bg-white/20 text-white font-medium py-2 px-4 rounded">إلغاء</button>
              <button onClick={handleEditProfile} disabled={loading} className="bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-medium py-2 px-4 rounded flex items-center gap-2">{loading ? <><LoaderCircle className="w-4 h-4 animate-spin" /> جارٍ الحفظ...</> : <><Save className="w-4 h-4" /> حفظ</>}</button>
            </div>
          </div>
        </div>
      )}

      {showPasswordModal && selectedTeacher && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-white/10 text-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><KeyRound className="w-5 h-5" /> تغيير كلمة المرور - {selectedTeacher.displayName}</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-300 mb-2">كلمة المرور الجديدة</label>
              <input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full px-4 py-2 border border-slate-600 bg-slate-800 text-white rounded-md focus:ring-2 focus:ring-blue-500" placeholder="6 أحرف على الأقل" dir="ltr" autoFocus />
            </div>
            {error && <div className="mb-4 p-3 bg-red-500/10 border border-red-500/40 text-red-300 rounded text-sm">{error}</div>}
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-3 mb-4 text-sm text-yellow-300 flex items-start gap-2"><TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" /> تأكد من حفظ كلمة المرور وإبلاغها للتدريسي</div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowPasswordModal(false); setNewPassword(''); setError(''); }} disabled={loading} className="bg-white/10 hover:bg-white/20 text-white font-medium py-2 px-4 rounded">إلغاء</button>
              <button onClick={handleChangePassword} disabled={loading} className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded">{loading ? 'جارٍ التغيير...' : 'تغيير'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg text-sm text-blue-300 space-y-2">
        <p className="flex items-start gap-2"><Lightbulb className="w-4 h-4 shrink-0 mt-0.5" /> <strong>كيف تعمل الصلاحيات:</strong> لما تحدد مراحل لتدريسي، راح يشوف فقط هذي المراحل وطلابها. ما يقدر يضيف أو يحذف الطلاب - فقط يسجل الحضور.</p>

        <p className="flex items-start gap-2"><UserCheck className="w-4 h-4 shrink-0 mt-0.5" /> إذا تدريسي ظهر بحالة "معطّل" بعد التصفير السنوي، اضغط <strong>"إعادة تفعيل"</strong> ثم حدد له المراحل الجديدة.</p>
      </div>
    </div>
  );
});
