import React, { useState, useEffect } from 'react';
import { ref, get } from 'firebase/database';
import { database } from '../firebase/config';
import { 
  createTeacherAccount, 
  updateTeacherPermissions,
  updateTeacherPassword,
  deleteTeacherAccount 
} from '../firebase/authService';
import { User, TeacherPermissions } from '../types/user';
import { College, Stage } from '../types/student';

interface TeacherManagementProps {
  currentUser: User;
  colleges: College[];
  stages: Stage[];
}

export const TeacherManagement: React.FC<TeacherManagementProps> = ({ 
  currentUser, 
  colleges, 
  stages 
}) => {
  const [teachers, setTeachers] = useState<User[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedTeacher, setSelectedTeacher] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    displayName: ''
  });

  useEffect(() => {
    loadTeachers();
  }, []);

  const loadTeachers = async () => {
    try {
      const snapshot = await get(ref(database, 'users'));
      if (snapshot.exists()) {
        const list = Object.values(snapshot.val()).filter(
          (u: any) => u.role === 'teacher'
        ) as User[];
        setTeachers(list);
      } else {
        setTeachers([]);
      }
    } catch (e) { 
      console.error('Error loading teachers:', e); 
    }
  };

  // ✅ زر إصلاح التدريسيين القدامى
  const handleFixOldTeachers = async () => {
    if (!window.confirm('هذه الأداة ستربط جميع التدريسيين القدامى بحسابك (كأدمن) وتجهزهم لاستقبال الصلاحيات. متابعة؟')) return;
    
    setLoading(true);
    try {
      const { ref: dbRef, update } = await import('firebase/database');
      
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
        
        if (needsFix) {
          await update(dbRef(database, `users/${t.uid}`), updates);
          fixed++;
        }
      }
      
      await loadTeachers();
      alert(`✅ تم إصلاح ${fixed} تدريسي.\nالآن تقدر تضغط "⚙️ الصلاحيات" لكل واحد منهم وتحدد له المراحل.`);
    } catch (e: any) {
      alert('❌ ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // ✅ تبديل صلاحية مرحلة معينة للتدريسي
  const handleToggleStage = async (
    teacher: User, 
    collegeId: string, 
    stageId: string
  ) => {
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
      const updatedTeacher = { ...teacher, permissions: newPermissions };
      setSelectedTeacher(updatedTeacher);
    } catch (e) { 
      alert('فشل تحديث الصلاحيات'); 
    }
  };

  // ✅ تحديد جميع مراحل كلية معينة دفعة واحدة
  const handleSelectAllStagesInCollege = async (
    teacher: User, 
    collegeId: string
  ) => {
    const collegeStages = stages.filter(s => s.collegeId === collegeId);
    const allStageIds = collegeStages.map(s => s.id);
    const currentAllowed = teacher.permissions?.allowedStages || {};
    
    const newAllowedStages = {
      ...currentAllowed,
      [collegeId]: allStageIds
    };

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

  // ✅ إلغاء جميع مراحل كلية معينة
  const handleDeselectAllStagesInCollege = async (
    teacher: User, 
    collegeId: string
  ) => {
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

  // ✅ إنشاء حساب تدريسي
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

    setLoading(true);
    try {
      await createTeacherAccount(
        formData.email, 
        formData.password, 
        formData.displayName, 
        currentUser.uid
      );
      
      setSuccess(`✅ تم إنشاء حساب ${formData.displayName} بنجاح!\n\nالآن اضغط على "⚙️ الصلاحيات" بجنب اسمه لتحديد المراحل المسموحة.`);
      setShowAddForm(false);
      setFormData({ email: '', password: '', displayName: '' });
      
      await loadTeachers();
      
      setTimeout(() => setSuccess(''), 8000);
    } catch (err: any) { 
      setError(err.message); 
    } finally {
      setLoading(false);
    }
  };

  // ✅ تغيير كلمة المرور
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
      setSuccess(`✅ تم تغيير كلمة مرور ${selectedTeacher.displayName}\n\nالكلمة الجديدة: ${newPassword}`);
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

  // ✅ حذف حساب تدريسي
  const handleDeleteTeacher = async (teacher: User) => {
    if (!window.confirm(`⚠️ هل أنت متأكد من حذف حساب ${teacher.displayName}؟\n\nسيتم حذف جميع بياناته نهائياً!`)) {
      return;
    }
    
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

  // ✅ عدّ المراحل المسموحة لتدريسي
  const countAllowedStages = (teacher: User): number => {
    if (!teacher.permissions?.allowedStages) return 0;
    return Object.values(teacher.permissions.allowedStages).flat().length;
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      {/* ✅ رأس الصفحة مع الأزرار */}
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-gray-800">👨‍🏫 إدارة التدريسيين وصلاحياتهم</h2>
        <div className="flex gap-2 flex-wrap">
          {/* ✅ زر إصلاح التدريسيين القدامى */}
          <button
            onClick={handleFixOldTeachers}
            disabled={loading}
            className="bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-medium py-2 px-4 rounded-md flex items-center gap-2 shadow-md"
          >
            🔧 إصلاح التدريسيين القدامى
          </button>
          
          <button 
            onClick={() => setShowAddForm(!showAddForm)} 
            className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white font-medium py-2 px-4 rounded-md flex items-center gap-2 shadow-md"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            إضافة تدريسي جديد
          </button>
        </div>
      </div>

      {success && (
        <div className="p-3 bg-green-100 border border-green-400 text-green-700 rounded mb-4 whitespace-pre-line">
          {success}
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded mb-4">
          {error}
        </div>
      )}

      {/* نموذج الإضافة */}
      {showAddForm && (
        <form onSubmit={handleSubmit} className="mb-6 p-5 bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-lg">
          <h3 className="text-lg font-bold text-gray-800 mb-4">➕ إضافة تدريسي جديد</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">الاسم الكامل</label>
              <input 
                type="text" 
                value={formData.displayName} 
                onChange={e => setFormData({...formData, displayName: e.target.value})} 
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                placeholder="د. أحمد محمد"
                disabled={loading}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">البريد الإلكتروني</label>
              <input 
                type="email" 
                value={formData.email} 
                onChange={e => setFormData({...formData, email: e.target.value})} 
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                placeholder="teacher@example.com"
                dir="ltr"
                disabled={loading}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">كلمة المرور</label>
              <input 
                type="text" 
                value={formData.password} 
                onChange={e => setFormData({...formData, password: e.target.value})} 
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                placeholder="6 أحرف على الأقل"
                dir="ltr"
                disabled={loading}
              />
            </div>
          </div>
          
          <div className="flex gap-2">
            <button 
              type="submit" 
              disabled={loading} 
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-6 rounded-md"
            >
              {loading ? '⏳ جارٍ الإنشاء...' : '✅ إنشاء الحساب'}
            </button>
            <button 
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setFormData({ email: '', password: '', displayName: '' });
                setError('');
              }}
              className="bg-gray-400 hover:bg-gray-500 text-white font-medium py-2 px-4 rounded-md"
            >
              إلغاء
            </button>
          </div>

          <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-800">
            ✅ <strong>جلسة الأدمن محفوظة:</strong> النظام يستخدم تطبيق Firebase ثانوي لإنشاء حساب التدريسي بدون التأثير على جلستك الحالية.
          </div>
        </form>
      )}

      {/* قائمة التدريسيين */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">التدريسي</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">البريد</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">الصلاحيات</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">إجراءات</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {teachers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                  لا توجد حسابات تدريسيين بعد
                </td>
              </tr>
            ) : (
              teachers.map(t => {
                const allowedCount = countAllowedStages(t);
                const isOldTeacher = !t.adminId || !t.permissions;
                return (
                  <tr key={t.uid} className={`hover:bg-gray-50 ${isOldTeacher ? 'bg-yellow-50' : ''}`}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center overflow-hidden">
                          {t.photoURL ? (
                            <img src={t.photoURL} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-blue-600 font-bold">{t.displayName.charAt(0)}</span>
                          )}
                        </div>
                        <div>
                          <div className="font-bold text-gray-900">
                            {t.displayName}
                            {isOldTeacher && (
                              <span className="mr-2 text-xs bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full">
                                يحتاج إصلاح
                              </span>
                            )}
                          </div>
                          {t.bio && <div className="text-xs text-gray-500 truncate max-w-xs">{t.bio}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600" dir="ltr">{t.email}</td>
                    <td className="px-6 py-4 text-sm">
                      {allowedCount === 0 ? (
                        <span className="inline-flex items-center px-3 py-1 rounded-full bg-red-100 text-red-700 font-medium">
                          🔒 لا توجد صلاحيات
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-3 py-1 rounded-full bg-green-100 text-green-700 font-medium">
                          ✅ {allowedCount} مرحلة
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex flex-wrap gap-2">
                        <button 
                          onClick={() => { 
                            setSelectedTeacher(t); 
                            setShowPermissionModal(true); 
                          }}
                          className="bg-purple-100 hover:bg-purple-200 text-purple-700 px-3 py-1 rounded font-medium"
                        >
                          ⚙️ الصلاحيات
                        </button>
                        <button 
                          onClick={() => handleOpenPasswordModal(t)}
                          className="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1 rounded font-medium"
                        >
                          🔑 الرمز
                        </button>
                        <button 
                          onClick={() => handleDeleteTeacher(t)}
                          disabled={loading}
                          className="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1 rounded font-medium"
                        >
                          🗑️ حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ✅ مودال الصلاحيات */}
      {showPermissionModal && selectedTeacher && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b flex justify-between items-center sticky top-0 bg-white z-10">
              <div>
                <h3 className="text-xl font-bold">⚙️ صلاحيات: {selectedTeacher.displayName}</h3>
                <p className="text-sm text-gray-500 mt-1">حدد المراحل المسموح للتدريسي بالوصول إليها</p>
              </div>
              <button 
                onClick={() => setShowPermissionModal(false)} 
                className="text-3xl text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              {colleges.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  لا توجد كليات. أضف كلية أولاً من تبويب "إدارة الكليات"
                </div>
              ) : (
                colleges.map(college => {
                  const collegeStages = stages.filter(s => s.collegeId === college.id);
                  const allowedInCollege = selectedTeacher.permissions?.allowedStages?.[college.id] || [];
                  const allSelected = collegeStages.length > 0 && allowedInCollege.length === collegeStages.length;
                  
                  return (
                    <div key={college.id} className="border-2 border-gray-200 rounded-lg overflow-hidden">
                      <div className="bg-gray-100 p-3 flex justify-between items-center">
                        <div className="font-bold text-lg">
                          {college.icon} {college.name}
                          <span className="text-sm font-normal text-gray-500 mr-2">
                            ({allowedInCollege.length}/{collegeStages.length})
                          </span>
                        </div>
                        {collegeStages.length > 0 && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSelectAllStagesInCollege(selectedTeacher, college.id)}
                              disabled={allSelected}
                              className="text-xs bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white px-2 py-1 rounded"
                            >
                              تحديد الكل
                            </button>
                            <button
                              onClick={() => handleDeselectAllStagesInCollege(selectedTeacher, college.id)}
                              disabled={allowedInCollege.length === 0}
                              className="text-xs bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white px-2 py-1 rounded"
                            >
                              إلغاء الكل
                            </button>
                          </div>
                        )}
                      </div>
                      
                      <div className="p-3">
                        {collegeStages.length === 0 ? (
                          <p className="text-sm text-gray-500 text-center py-3">لا توجد مراحل في هذه الكلية</p>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {collegeStages
                              .sort((a, b) => (a.order || 0) - (b.order || 0))
                              .map(stage => {
                                const isAllowed = allowedInCollege.includes(stage.id);
                                return (
                                  <button
                                    key={stage.id}
                                    onClick={() => handleToggleStage(selectedTeacher, college.id, stage.id)}
                                    className={`p-3 rounded-md text-right flex justify-between items-center border-2 transition ${
                                      isAllowed 
                                        ? 'bg-green-50 text-green-800 border-green-500' 
                                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-400'
                                    }`}
                                  >
                                    <span className="font-medium">📖 {stage.name}</span>
                                    <span className="text-xl">{isAllowed ? '✅' : '⬜'}</span>
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
            
            <div className="p-6 border-t bg-gray-50 sticky bottom-0">
              <div className="flex justify-between items-center">
                <p className="text-sm text-gray-600">
                  الإجمالي: <strong>{countAllowedStages(selectedTeacher)}</strong> مرحلة مسموحة
                </p>
                <button 
                  onClick={() => setShowPermissionModal(false)} 
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium"
                >
                  ✅ تم
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ✅ مودال تغيير كلمة المرور */}
      {showPasswordModal && selectedTeacher && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-gray-800 mb-4">
              🔑 تغيير كلمة المرور - {selectedTeacher.displayName}
            </h3>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                كلمة المرور الجديدة
              </label>
              <input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                placeholder="6 أحرف على الأقل"
                dir="ltr"
                autoFocus
              />
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded text-sm">
                {error}
              </div>
            )}

            <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4 text-sm text-yellow-800">
              ⚠️ تأكد من حفظ كلمة المرور وإبلاغها للتدريسي
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowPasswordModal(false);
                  setNewPassword('');
                  setError('');
                }}
                disabled={loading}
                className="bg-gray-400 hover:bg-gray-500 text-white font-medium py-2 px-4 rounded"
              >
                إلغاء
              </button>
              <button
                onClick={handleChangePassword}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded"
              >
                {loading ? 'جارٍ التغيير...' : 'تغيير'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        💡 <strong>كيف تعمل الصلاحيات:</strong> لما تحدد مراحل لتدريسي، راح يشوف فقط هذي المراحل وطلابها. ما يقدر يضيف أو يحذف الطلاب - فقط يسجل الحضور.
        <br />
        🔧 إذا عندك تدريسيين قدامى ما يطلعلهم زر "الصلاحيات" يشتغل، اضغط على زر <strong>"إصلاح التدريسيين القدامى"</strong> أولاً.
      </div>
    </div>
  );
};