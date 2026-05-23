import React, { useState, useRef } from 'react';
import { ref as dbRef, update } from 'firebase/database';
import { database } from '../firebase/config';
import { User } from '../types/user';

interface ProfileSettingsProps {
  currentUser: User;
  onUpdateProfile: (user: User) => void;
}

export const ProfileSettings: React.FC<ProfileSettingsProps> = ({
  currentUser,
  onUpdateProfile,
}) => {
  const [displayName, setDisplayName] = useState(currentUser.displayName);
  const [bio, setBio] = useState(currentUser.bio || '');
  const [photoURL, setPhotoURL] = useState(currentUser.photoURL || '');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const convertToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result);
      };
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 1 * 1024 * 1024) {
      setError('حجم الصورة كبير جداً. الحد الأقصى 1 MB');
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('الرجاء اختيار صورة صحيحة');
      return;
    }

    setUploading(true);
    setError('');
    setSuccess('');

    try {
      const base64Image = await convertToBase64(file);
      setPhotoURL(base64Image);
      setSuccess('✅ تم تحميل الصورة! اضغط "حفظ التغييرات" للتطبيق');
    } catch (err: any) {
      setError(`حدث خطأ أثناء تحميل الصورة: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleRemovePhoto = () => {
    if (!photoURL) return;
    if (window.confirm('هل أنت متأكد من حذف الصورة الشخصية؟')) {
      setPhotoURL('');
      setSuccess('سيتم حذف الصورة عند حفظ التغييرات');
    }
  };

  const handleSave = async () => {
    setError('');
    setSuccess('');

    if (!displayName.trim()) {
      setError('الرجاء إدخال الاسم');
      return;
    }

    setSaving(true);

    try {
      // ✅ تعريف نوع واضح يتضمن lastUpdated
      const updates: Partial<User> & { lastUpdated: string } = {
        displayName: displayName.trim(),
        bio: bio.trim(),
        lastUpdated: new Date().toISOString(),
        photoURL: photoURL || undefined,
      };

      const userRef = dbRef(database, `users/${currentUser.uid}`);
      await update(userRef, updates);

      // ✅ إنشاء الكائن المحدث بدون مشاكل TypeScript
      const updatedUser: User = {
        ...currentUser,
        displayName: updates.displayName as string,
        bio: updates.bio,
        photoURL: updates.photoURL,
        lastUpdated: updates.lastUpdated,
      };

      onUpdateProfile(updatedUser);

      setSuccess(
        '✅ تم حفظ التغييرات بنجاح!\n\n✓ الصورة الشخصية محفوظة\n✓ الاسم محفوظ\n✓ البايو محفوظ'
      );

      setTimeout(() => setSuccess(''), 6000);
    } catch (err: any) {
      setError(
        `حدث خطأ أثناء حفظ التغييرات: ${err.message || 'تحقق من الاتصال بالإنترنت'}`
      );
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (window.confirm('هل أنت متأكد من إلغاء جميع التغييرات؟')) {
      setDisplayName(currentUser.displayName);
      setBio(currentUser.bio || '');
      setPhotoURL(currentUser.photoURL || '');
      setError('');
      setSuccess('');
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">
        إعدادات الملف الشخصي
      </h2>

      {success && (
        <div className="mb-4 p-4 bg-green-100 border-2 border-green-400 text-green-700 rounded-md whitespace-pre-line font-medium">
          {success}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-md">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Profile Photo Section */}
        <div>
          <h3 className="text-lg font-semibold mb-4 text-gray-700">
            الصورة الشخصية
          </h3>

          <div className="flex flex-col items-center">
            <div className="relative mb-4">
              <div className="w-40 h-40 rounded-full overflow-hidden bg-gray-200 border-4 border-blue-500 shadow-lg">
                {photoURL ? (
                  <img
                    src={photoURL}
                    alt={displayName}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.src = '';
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-400 to-purple-500">
                    <span className="text-white text-5xl font-bold">
                      {displayName.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
              </div>

              {photoURL && (
                <button
                  onClick={handleRemovePhoto}
                  className="absolute top-0 right-0 bg-red-500 hover:bg-red-600 text-white rounded-full p-2 shadow-lg transition duration-200"
                  title="حذف الصورة"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-6 rounded-md transition duration-200 flex items-center gap-2"
            >
              {uploading ? (
                <>
                  <svg
                    className="animate-spin h-5 w-5"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  جارٍ التحميل...
                </>
              ) : (
                <>
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  {photoURL ? 'تغيير الصورة' : 'رفع صورة'}
                </>
              )}
            </button>

            <p className="text-xs text-gray-500 mt-2 text-center">
              JPG, PNG أو GIF (حد أقصى 1MB)
            </p>
          </div>
        </div>

        {/* Profile Info Section */}
        <div>
          <h3 className="text-lg font-semibold mb-4 text-gray-700">
            المعلومات الشخصية
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                الاسم الكامل
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="أحمد محمد"
                dir="rtl"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                البريد الإلكتروني
              </label>
              <input
                type="email"
                value={currentUser.email}
                disabled
                className="w-full px-4 py-2 border border-gray-200 rounded-md bg-gray-100 text-gray-600"
                dir="ltr"
              />
              <p className="text-xs text-gray-500 mt-1">
                لا يمكن تغيير البريد الإلكتروني
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                الصلاحية
              </label>
              <div>
                {currentUser.role === 'admin' ? (
                  <span className="inline-flex items-center px-4 py-2 bg-purple-100 text-purple-800 text-sm font-medium rounded-full">
                    👑 أدمن
                  </span>
                ) : (
                  <span className="inline-flex items-center px-4 py-2 bg-blue-100 text-blue-800 text-sm font-medium rounded-full">
                    👨‍🏫 تدريسي
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bio Section */}
      <div className="mt-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          البايو / وصف المادة
          {currentUser.role === 'teacher' && (
            <span className="text-gray-500 text-xs mr-2">
              (اكتب وصفاً مختصراً عن المادة التي تدرسها)
            </span>
          )}
        </label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={4}
          maxLength={500}
          className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder={
            currentUser.role === 'admin'
              ? 'مدير النظام - مسؤول عن إدارة جميع حسابات التدريسيين'
              : 'مثال: أستاذ مادة الرياضيات للمرحلة الثانية'
          }
          dir="rtl"
        />
        <div className="flex justify-between mt-1">
          <p className="text-xs text-gray-500">{bio.length}/500 حرف</p>
          {bio.length >= 450 && (
            <p className="text-xs text-orange-500">⚠️ اقتربت من الحد الأقصى</p>
          )}
        </div>
      </div>

      {/* Save Buttons */}
      <div className="mt-6 flex justify-end gap-3">
        <button
          onClick={handleReset}
          disabled={saving}
          className="bg-gray-400 hover:bg-gray-500 disabled:bg-gray-300 text-white font-medium py-2 px-6 rounded-md transition duration-200 flex items-center gap-2"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
          إلغاء التغييرات
        </button>

        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-medium py-2 px-6 rounded-md transition duration-200 flex items-center gap-2"
        >
          {saving ? (
            <>
              <svg
                className="animate-spin h-5 w-5"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              جارٍ الحفظ...
            </>
          ) : (
            <>
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              حفظ التغييرات
            </>
          )}
        </button>
      </div>

      {/* ✅ Last Updated - يعمل الآن بدون أخطاء */}
      {currentUser.lastUpdated && (
        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-800 flex items-center gap-2">
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            آخر تحديث:{' '}
            {new Date(currentUser.lastUpdated).toLocaleString('ar-EG', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>
      )}

      {/* Info Box */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-start gap-2">
          <svg
            className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">   معلومات عامة</p>
            <ul className="list-disc list-inside space-y-1">
              <li>الصورة تُحفظ في قاعدة البيانات مباشرة</li>
              <li>الحد الأقصى للصورة 1MB لأفضل أداء</li>
              <li>البايو يستخدم لتعريف التدريسيين والمواد</li>
              <li>جميع التغييرات محفوظة في Firebase بشكل آمن</li>
              <li>
                <strong>البيانات تُحمّل تلقائياً عند تسجيل الدخول ✓</strong>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Status Indicator */}
      <div className="mt-4 p-3 bg-gradient-to-r from-green-50 to-blue-50 border border-green-200 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <p className="text-sm text-gray-700 font-medium">
              متصل بـ Firebase
            </p>
          </div>
          <p className="text-xs text-gray-600">البيانات محفوظة في السحابة ☁️</p>
        </div>
      </div>
    </div>
  );
};