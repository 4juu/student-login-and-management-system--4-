import React, { useState, useEffect } from 'react';
import { ref, get } from 'firebase/database';
import { database } from '../firebase/config';
import { createTeacherAccount, updateTeacherPassword, deleteTeacherAccount } from '../firebase/authService';
import { User } from '../types/user';

interface TeacherManagementProps {
  currentUser: User;
}

export const TeacherManagement: React.FC<TeacherManagementProps> = ({ currentUser }) => {
  const [teachers, setTeachers] = useState<User[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
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
      const usersRef = ref(database, 'users');
      const snapshot = await get(usersRef);
      
      if (snapshot.exists()) {
        const allUsers = snapshot.val();
        const teachersList = Object.values(allUsers).filter(
          (user: any) => user.role === 'teacher'
        ) as User[];
        setTeachers(teachersList);
      }
    } catch (error) {
      console.error('Error loading teachers:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    
    if (!formData.email || !formData.password || !formData.displayName) {
      setError('الرجاء ملء جميع الحقول');
      return;
    }

    if (formData.password.length < 6) {
      setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }

    setLoading(true);
    try {
      await createTeacherAccount(
        formData.email,
        formData.password,
        formData.displayName,
        currentUser.uid
      );
      
      setSuccess('تم إنشاء حساب التدريسي بنجاح!');
      setFormData({ email: '', password: '', displayName: '' });
      setShowAddForm(false);
      
      setTimeout(async () => {
        await loadTeachers();
        setSuccess('');
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء إنشاء الحساب');
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
    
    if (!newPassword.trim()) {
      setError('الرجاء إدخال كلمة المرور الجديدة');
      return;
    }

    if (newPassword.length < 6) {
      setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }

    setLoading(true);
    try {
      await updateTeacherPassword(selectedTeacher.uid, newPassword);
      setSuccess(`✅ تم تغيير كلمة مرور ${selectedTeacher.displayName} بنجاح!\n\nكلمة المرور الجديدة: ${newPassword}\n\nيُرجى إبلاغ التدريسي بكلمة المرور الجديدة`);
      setShowPasswordModal(false);
      setNewPassword('');
      setSelectedTeacher(null);
      setTimeout(() => setSuccess(''), 8000);
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء تغيير كلمة المرور');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTeacher = async (teacher: User) => {
    if (window.confirm(`⚠️ تحذير!\n\nهل أنت متأكد من حذف حساب ${teacher.displayName}؟\n\nسيتم حذف:\n• الحساب\n• جميع الطلاب\n• جميع السجلات\n• جميع البيانات\n\nهذا الإجراء لا يمكن التراجع عنه!`)) {
      try {
        setLoading(true);
        await deleteTeacherAccount(teacher.uid);
        setSuccess(`تم حذف حساب ${teacher.displayName} بنجاح`);
        await loadTeachers();
        setTimeout(() => setSuccess(''), 3000);
      } catch (err: any) {
        setError(err.message || 'حدث خطأ أثناء حذف الحساب');
        setTimeout(() => setError(''), 5000);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">إدارة حسابات التدريسيين</h2>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-md transition duration-200 flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          إضافة تدريسي جديد
        </button>
      </div>

      {/* Success Message */}
      {success && (
        <div className="mb-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded-md whitespace-pre-line">
          {success}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-md">
          {error}
        </div>
      )}

      {/* Add Teacher Form */}
      {showAddForm && (
        <form onSubmit={handleSubmit} className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                الاسم الكامل
              </label>
              <input
                type="text"
                value={formData.displayName}
                onChange={(e) => setFormData({...formData, displayName: e.target.value})}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="أحمد محمد"
                dir="rtl"
                disabled={loading}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                البريد الإلكتروني
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="teacher@example.com"
                dir="ltr"
                disabled={loading}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                كلمة المرور الأولية
              </label>
              <input
                type="text"
                value={formData.password}
                onChange={(e) => setFormData({...formData, password: e.target.value})}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="6 أحرف على الأقل"
                dir="ltr"
                disabled={loading}
              />
            </div>
          </div>
          
          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-6 rounded-md transition duration-200"
            >
              {loading ? 'جارٍ الإنشاء...' : 'إنشاء الحساب'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setFormData({ email: '', password: '', displayName: '' });
                setError('');
              }}
              className="bg-gray-400 hover:bg-gray-500 text-white font-medium py-2 px-4 rounded-md transition duration-200"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {/* Password Change Modal */}
      {showPasswordModal && selectedTeacher && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" dir="rtl">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-800 mb-4">
              تغيير كلمة المرور - {selectedTeacher.displayName}
            </h3>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                كلمة المرور الجديدة
              </label>
              <input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="أدخل كلمة المرور الجديدة (6 أحرف على الأقل)"
                dir="ltr"
                autoFocus
              />
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-md text-sm">
                {error}
              </div>
            )}

            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mb-4">
              <p className="text-sm text-yellow-800">
                ⚠️ تأكد من حفظ كلمة المرور الجديدة وإبلاغها للتدريسي
              </p>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowPasswordModal(false);
                  setNewPassword('');
                  setSelectedTeacher(null);
                  setError('');
                }}
                className="bg-gray-400 hover:bg-gray-500 text-white font-medium py-2 px-4 rounded-md transition duration-200"
                disabled={loading}
              >
                إلغاء
              </button>
              <button
                onClick={handleChangePassword}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-md transition duration-200"
              >
                {loading ? 'جارٍ التغيير...' : 'تغيير كلمة المرور'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Teachers List */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الاسم
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                البريد الإلكتروني
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                تاريخ الإنشاء
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                آخر دخول
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                إجراءات
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {teachers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                  لا توجد حسابات تدريسيين
                </td>
              </tr>
            ) : (
              teachers.map((teacher) => (
                <tr key={teacher.uid} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center overflow-hidden">
                        {teacher.photoURL ? (
                          <img
                            src={teacher.photoURL}
                            alt={teacher.displayName}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-blue-600 font-medium">
                            {teacher.displayName.charAt(0)}
                          </span>
                        )}
                      </div>
                      <div className="mr-4">
                        <div className="text-sm font-medium text-gray-900">
                          {teacher.displayName}
                        </div>
                        {teacher.bio && (
                          <div className="text-xs text-gray-500 max-w-xs truncate">
                            {teacher.bio}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600" dir="ltr">
                    {teacher.email}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {new Date(teacher.createdAt).toLocaleDateString('ar-EG')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {teacher.lastLogin 
                      ? new Date(teacher.lastLogin).toLocaleDateString('ar-EG')
                      : 'لم يسجل دخول بعد'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleOpenPasswordModal(teacher)}
                        className="text-blue-600 hover:text-blue-900 font-medium flex items-center gap-1"
                        title="تغيير كلمة المرور"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                        </svg>
                        تغيير الرمز
                      </button>
                      <span className="text-gray-300">|</span>
                      <button
                        onClick={() => handleDeleteTeacher(teacher)}
                        className="text-red-600 hover:text-red-900 font-medium flex items-center gap-1"
                        title="حذف الحساب"
                        disabled={loading}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        حذف
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <div className="flex items-start gap-2">
          <svg className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm text-yellow-800">
            <p className="font-medium mb-2">💡 ملاحظات مهمة:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>كل تدريسي سيكون له بياناته الخاصة (طلاب، سجلات، حضور) منفصلة تماماً</li>
              <li>يمكنك تغيير كلمة مرور التدريسي مباشرة عند النسيان</li>
              <li>تأكد من إبلاغ التدريسي بكلمة المرور الجديدة بعد تغييرها</li>
              <li>حذف الحساب سيحذف جميع بيانات التدريسي نهائياً</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
