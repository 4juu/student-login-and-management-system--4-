import React, { useState, useRef } from 'react';
import { ref as dbRef, update } from 'firebase/database';
import { database } from '../firebase/config';
import { User } from '../types/user';
import { Crown, GraduationCap, Landmark, TriangleAlert } from 'lucide-react';
import { MorphingSquare } from './MorphingSquare';
import { useConfirm } from '../hooks/useConfirm';

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
  const { confirm: confirmAction, ConfirmDialog: ConfirmDialogEl } = useConfirm();

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
      setSuccess('تم تحميل الصورة! اضغط "حفظ التغييرات" للتطبيق');
    } catch (err: any) {
      setError(`حدث خطأ أثناء تحميل الصورة: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!photoURL) return;
    const ok = await confirmAction({
      title: 'حذف الصورة',
      message: 'هل أنت متأكد من حذف الصورة الشخصية؟',
      confirmLabel: 'حذف',
    });
    if (ok) {
      setPhotoURL('');
      setSuccess('سيتم حذف الصورة عند حفظ التغييرات');
    }
  };

  const canEditNameAndBio = currentUser.role === 'admin' || currentUser.role === 'college_admin';

  const handleSave = async () => {
    setError('');
    setSuccess('');

    if (!displayName.trim()) {
      setError('الرجاء إدخال الاسم');
      return;
    }

    setSaving(true);

    try {
      const updates: Record<string, any> & { lastUpdated: string } = {
        lastUpdated: new Date().toISOString(),
        photoURL: photoURL || undefined,
      };
      // فقط الأدمن يقدر يعدل الاسم والبايو
      if (canEditNameAndBio) {
        updates.displayName = displayName.trim();
        updates.bio = bio.trim();
      }

      const userRef = dbRef(database, `users/${currentUser.uid}`);
      await update(userRef, updates);

      const updatedUser: User = {
        ...currentUser,
        displayName: canEditNameAndBio ? (updates.displayName as string) : currentUser.displayName,
        bio: canEditNameAndBio ? updates.bio : currentUser.bio,
        photoURL: updates.photoURL,
        lastUpdated: updates.lastUpdated,
      };

      onUpdateProfile(updatedUser);

      setSuccess(
        'تم حفظ التغييرات بنجاح!\n\nالصورة الشخصية محفوظة'
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

  const handleReset = async () => {
    const ok = await confirmAction({
      title: 'إلغاء التغييرات',
      message: 'هل أنت متأكد من إلغاء جميع التغييرات؟',
      confirmLabel: 'إلغاء التغييرات',
    });
    if (ok) {
      setDisplayName(currentUser.displayName);
      setBio(currentUser.bio || '');
      setPhotoURL(currentUser.photoURL || '');
      setError('');
      setSuccess('');
    }
  };

  return (
    <div className="glass-card p-4 sm:p-6 space-y-4 sm:space-y-6">
      {ConfirmDialogEl}
      <h2 className="text-xl sm:text-2xl font-semibold text-white">
        إعدادات الملف الشخصي
      </h2>

      {success && (
        <div role="status" className="p-4 bg-green-500/10 border-2 border-green-500/40 text-green-300 rounded-md whitespace-pre-line font-medium">
          {success}
        </div>
      )}

      {error && (
        <div role="alert" className="p-3 bg-red-500/10 border border-red-500/40 text-red-300 rounded-md">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {/* Profile Photo Section */}
        <div className="space-y-4">
          <h3 className="text-base sm:text-lg font-semibold text-white">
            الصورة الشخصية
          </h3>

          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div className="w-40 h-40 rounded-full overflow-hidden bg-slate-800 border-4 border-blue-500 shadow-lg">
                {photoURL ? (
                  <img
                    src={photoURL}
                    alt={displayName}
                    className="w-full h-full object-cover"
                    loading="lazy"
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
                  className="absolute top-0 start-0 bg-red-500 hover:bg-red-600 text-white rounded-full p-2 shadow-lg transition duration-200"
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
              className="btn-base btn-primary"
            >
              {uploading ? (
                <>
                  <MorphingSquare size="sm" />
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

            <p className="text-xs text-slate-400 text-center">
              JPG, PNG أو GIF (حد أقصى 1MB)
            </p>
          </div>
        </div>

        {/* Profile Info Section */}
        <div className="space-y-4">
          <h3 className="text-base sm:text-lg font-semibold text-white">
            المعلومات الشخصية
          </h3>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">
                الاسم الكامل
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={!canEditNameAndBio}
                className="glass-input disabled:opacity-50"
                placeholder="أحمد محمد"
                dir="rtl"
              />
              {!canEditNameAndBio && (
                <p className="text-xs text-orange-400">
                  فقط الأدمن يمكنه تعديل الاسم
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">
                البريد الإلكتروني
              </label>
              <input
                type="email"
                value={currentUser.email}
                disabled
                className="glass-input text-slate-400"
                dir="ltr"
              />
              <p className="text-xs text-slate-400">
                لا يمكن تغيير البريد الإلكتروني
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">
                الصلاحية
              </label>
              <div>
                {currentUser.role === 'admin' ? (
                  <span className="glass-badge badge-purple">
                    <Crown className="w-4 h-4" /> أدمن رئيسي
                  </span>
                ) : currentUser.role === 'college_admin' ? (
                  <span className="glass-badge badge-amber">
                    <Landmark className="w-4 h-4" /> أدمن كلية
                  </span>
                ) : (
                  <span className="glass-badge badge-blue">
                    <GraduationCap className="w-4 h-4" /> تدريسي
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bio Section */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-300">
          البايو / وصف المادة
          {currentUser.role === 'teacher' && (
            <span className="text-slate-400 text-xs ms-2">
              (اكتب وصفاً مختصراً عن المادة التي تدرسها)
            </span>
          )}
        </label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          disabled={!canEditNameAndBio}
          rows={4}
          maxLength={500}
          className="glass-input disabled:opacity-50"
          placeholder={
            currentUser.role === 'admin'
              ? 'مدير النظام - مسؤول عن إدارة جميع حسابات التدريسيين'
              : 'مثال: أستاذ لمادة الكيمياء العضوية للمرحلة الثانية'
          }
          dir="rtl"
        />
        <div className="flex justify-between gap-2">
          <p className="text-xs text-slate-400">{bio.length}/500 حرف</p>
          {bio.length >= 450 && (
            <p className="text-xs text-orange-400 flex items-center gap-1"><TriangleAlert className="w-3.5 h-3.5" /> اقتربت من الحد الأقصى</p>
          )}
        </div>
        {!canEditNameAndBio && (
          <p className="text-xs text-orange-400">
            فقط الأدمن يمكنه تعديل البايو والاسم
          </p>
        )}
      </div>

      {/* Save Buttons */}
      <div className="flex flex-wrap justify-end gap-3">
        <button
          onClick={handleReset}
          disabled={saving}
          className="btn-base btn-secondary"
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
          className="btn-base btn-primary"
        >
          {saving ? (
            <>
              <MorphingSquare size="sm" />
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
        <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
          <p className="text-sm text-green-300 flex items-center gap-2">
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
      <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
        <div className="flex items-start gap-2">
          <svg
            className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5"
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
          <div className="text-sm text-blue-300">
            <p className="font-medium mb-1">   معلومات </p>
            <ul className="list-disc list-inside space-y-1">
              <li>الحد الأقصى للصورة 1MB لأفضل أداء</li>

            </ul>
          </div>
        </div>
      </div>


    </div>
  );
};