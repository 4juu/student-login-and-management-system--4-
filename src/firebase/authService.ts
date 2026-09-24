import { 
  signInWithEmailAndPassword, 
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  updateProfile,
  updatePassword,
  User as FirebaseUser
} from "firebase/auth";
import { ref, set, get, update, remove } from "firebase/database";
import { auth, database, secondaryAuth } from "./config";
import { User, TeacherPermissions } from "../types/user";

// ⚠️ غيّر هذا الايميل لايميل الأدمن الجديد
const ADMIN_EMAIL = "mujtabahaitham@gmail.com";

// ============================================================
// 🔐 تسجيل الدخول
// ============================================================
export const signIn = async (email: string, password: string): Promise<User> => {
  try {
    // ✅ تسجيل الدخول عبر Firebase Auth مباشرة — لا تُخزَّن كلمات المرور نصّاً في قاعدة البيانات
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const firebaseUser = userCredential.user;

    // 📥 جلب أو إنشاء بروفايل المستخدم
    const userRef = ref(database, `users/${firebaseUser.uid}`);
    const snapshot = await get(userRef);
    
    let user: User;
    
    if (snapshot.exists()) {
      user = snapshot.val();
      
      if (user.role === 'teacher' && user.active === false) {
        console.warn('⚠️ حساب التدريسي معطّل');
      }
    } else {
      // 🆕 المستخدم موجود بـ Auth بس مو بـ DB → ننشئه
      
      const role: 'admin' | 'teacher' = 
        email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? 'admin' : 'teacher';
      
      user = {
        uid: firebaseUser.uid,
        email: firebaseUser.email || email,
        displayName: firebaseUser.displayName || email.split('@')[0] || '',
        role,
        active: true,
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
      };
      
    }
    
    user.lastLogin = new Date().toISOString();
    await set(userRef, user);
    
    return user;
    
  } catch (error: any) {
    console.error("❌ خطأ تسجيل الدخول:", error.code, error.message);
    throw new Error(getErrorMessage(error.code) || error.message || 'حدث خطأ');
  }
};

// ============================================================
// 👋 تسجيل الخروج
// ============================================================
export const signOut = async (): Promise<void> => {
  try {
    await firebaseSignOut(auth);
  } catch (error) {
    console.error("❌ خطأ تسجيل الخروج:", error);
    throw error;
  }
};

// ============================================================
// 👨‍🏫 إنشاء حساب تدريسي
// ============================================================
export const createTeacherAccount = async (
  email: string,
  password: string,
  displayName: string,
  adminUid: string,
  collegeId?: string
): Promise<void> => {
  try {
    const { secondaryAuth } = await import('./config');
    const { signOut: secondarySignOut } = await import('firebase/auth');
    
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const user = userCredential.user;
    
    await updateProfile(user, { displayName });
    
    const teacherData: User = {
      uid: user.uid,
      email,
      displayName,
      role: 'teacher',
      adminId: adminUid,
      ...(collegeId !== undefined ? { collegeId } : {}),
      active: true,
      lastActivatedAt: new Date().toISOString(),
      permissions: {
        allowedStages: {},
        canViewRecords: true,
        canTakeAttendance: true,
      },
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };
    
    await set(ref(database, `users/${user.uid}`), teacherData);
    
    await set(ref(database, `teacherAccounts/${user.uid}`), {
      email,
      displayName,
      createdBy: adminUid,
      createdAt: new Date().toISOString(),
      passwordLastReset: new Date().toISOString()
    });
    
    await secondarySignOut(secondaryAuth);
    
  } catch (error: any) {
    console.error("❌ خطأ إنشاء التدريسي:", error);
    throw new Error(getErrorMessage(error.code) || error.message);
  }
};

// ============================================================
// 🏛️ تعيين تدريسي كأدمن كلية / إلغاء التعيين
// ============================================================
export const promoteToCollegeAdmin = async (
  teacherUid: string,
  collegeId: string,
  collegeName: string
): Promise<void> => {
  try {
    await update(ref(database, `users/${teacherUid}`), {
      role: 'college_admin',
      collegeId,
      collegeName,
      lastUpdated: new Date().toISOString()
    });
  } catch (error: any) {
    console.error("❌ خطأ تعيين أدمن كلية:", error);
    throw new Error('حدث خطأ أثناء تعيين أدمن الكلية');
  }
};

export const demoteFromCollegeAdmin = async (
  teacherUid: string
): Promise<void> => {
  try {
    const snap = await get(ref(database, `users/${teacherUid}`));
    const existing = snap.exists() ? snap.val() : {};
    await update(ref(database, `users/${teacherUid}`), {
      role: 'teacher',
      collegeId: existing.collegeId || null,
      collegeName: existing.collegeName || null,
      lastUpdated: new Date().toISOString()
    });
  } catch (error: any) {
    console.error("❌ خطأ إلغاء تعيين أدمن كلية:", error);
    throw new Error('حدث خطأ أثناء إلغاء تعيين أدمن الكلية');
  }
};

// ============================================================
// 🔐 تحديث صلاحيات التدريسي
// ============================================================
export const updateTeacherPermissions = async (
  teacherUid: string,
  permissions: TeacherPermissions
): Promise<void> => {
  try {
    await update(ref(database, `users/${teacherUid}`), {
      permissions,
      lastUpdated: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('❌ خطأ تحديث الصلاحيات:', error);
    throw new Error('فشل تحديث الصلاحيات');
  }
};

// ============================================================
// 🔓 إعادة تفعيل تدريسي
// ============================================================
export const reactivateTeacher = async (
  teacherUid: string,
  permissions: TeacherPermissions
): Promise<void> => {
  try {
    await update(ref(database, `users/${teacherUid}`), {
      active: true,
      lastActivatedAt: new Date().toISOString(),
      deactivatedAt: null,
      permissions,
      lastUpdated: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('❌ خطأ إعادة التفعيل:', error);
    throw new Error('فشل إعادة تفعيل التدريسي');
  }
};

// ============================================================
// 📋 جلب كل التدريسيين
// ============================================================
export const getAllTeachers = async (adminUid: string): Promise<User[]> => {
  try {
    const snap = await get(ref(database, 'users'));
    if (!snap.exists()) return [];
    
    const allUsers = snap.val();
    const teachers: User[] = [];
    
    Object.values(allUsers).forEach((user: any) => {
      if ((user.role === 'teacher' || user.role === 'college_admin') && user.adminId === adminUid) {
        teachers.push(user);
      }
    });
    
    return teachers;
  } catch (error) {
    console.error('❌ خطأ جلب التدريسيين:', error);
    return [];
  }
};

// ============================================================
// 📋 جلب كل التدريسيين (لأدمن الكلية)
// ============================================================
export const getAllTeachersForCollege = async (collegeId: string): Promise<User[]> => {
  try {
    const snap = await get(ref(database, 'users'));
    if (!snap.exists()) return [];
    
    return Object.values(snap.val() as Record<string, any>).filter(
      (user: any) => (user.role === 'teacher' || user.role === 'college_admin') && user.collegeId === collegeId
    ) as User[];
  } catch (error) {
    console.error('❌ خطأ جلب التدريسيين:', error);
    return [];
  }
};

// ============================================================
// 🔑 تحديث كلمة مرور تدريسي
// ============================================================
export const updateTeacherPassword = async (
  uid: string,
  newPassword: string,
  currentPassword?: string
): Promise<void> => {
  try {
    // نجلب البريد وكلمة السر الحالية المحفوظة (الأدمن يملك صلاحية القراءة)
    const accountSnap = await get(ref(database, `teacherAccounts/${uid}`));
    const accountData = accountSnap.exists() ? accountSnap.val() : {};
    const userSnap = await get(ref(database, `users/${uid}`));
    const userData = userSnap.exists() ? userSnap.val() : {};

    const email: string | undefined = accountData.email || userData.email;
    if (!email) {
      throw new Error('تعذّر إيجاد بريد التدريسي');
    }

    const oldPassword: string | undefined =
      (currentPassword && currentPassword.trim()) || accountData.storedPassword;
    if (!oldPassword) {
      throw new Error('لا توجد كلمة مرور حالية محفوظة — اكتب كلمة السر الحالية للتدريسي ثم أعد المحاولة');
    }

    // تنظيف أي جلسة سابقة على التطبيق الثانوي قبل الدخول بحساب التدريسي
    try { await firebaseSignOut(secondaryAuth); } catch { /* تجاهل */ }

    // ندخل بحساب التدريسي على التطبيق الثانوي (منفصل عن جلسة الأدمن) لتغيير كلمة السر فعلياً
    const cred = await signInWithEmailAndPassword(secondaryAuth, email, oldPassword).catch(() => {
      throw new Error('كلمة السر الحالية للتدريسي غير صحيحة — اكتبها يدوياً ثم أعد المحاولة');
    });

    try {
      await updatePassword(cred.user, newPassword);
    } finally {
      try { await firebaseSignOut(secondaryAuth); } catch { /* تجاهل */ }
    }

    // 🔒 مزامنة النسخة المحلية: مسح أي كلمة مرور محفوظة نصّاً (لم نعد نخزّنها)
    await update(ref(database, `teacherAccounts/${uid}`), {
      newPassword: null,
      storedPassword: null,
      passwordLastReset: new Date().toISOString(),
      passwordResetBy: 'admin'
    });

    await update(ref(database, `users/${uid}`), {
      passwordLastReset: new Date().toISOString()
    });

  } catch (error: any) {
    console.error("❌ خطأ تحديث كلمة المرور:", error);
    throw new Error(error?.message || 'حدث خطأ أثناء تحديث كلمة المرور');
  }
};

// ============================================================
// 🗑️ حذف حساب تدريسي
// ============================================================
export const deleteTeacherAccount = async (uid: string): Promise<void> => {
  try {
    await remove(ref(database, `users/${uid}`));
    await remove(ref(database, `teacherAccounts/${uid}`));
    await remove(ref(database, `userData/${uid}`));
    
    await set(ref(database, `deletedAccounts/${uid}`), {
      deletedAt: new Date().toISOString()
    });
    
  } catch (error: any) {
    console.error("❌ خطأ حذف الحساب:", error);
    throw new Error('حدث خطأ أثناء حذف الحساب');
  }
};

// ============================================================
// 📝 تحديث البروفايل
// ============================================================
export const updateUserProfile = async (
  uid: string,
  updates: { displayName?: string; photoURL?: string; bio?: string; }
): Promise<void> => {
  try {
    await update(ref(database, `users/${uid}`), {
      ...updates,
      lastUpdated: new Date().toISOString()
    });
  } catch (error: any) {
    console.error("❌ خطأ تحديث البروفايل:", error);
    throw new Error('حدث خطأ أثناء تحديث الملف الشخصي');
  }
};

// ============================================================
// 📥 جلب البروفايل
// ============================================================
export const getUserProfile = async (uid: string): Promise<User | null> => {
  try {
    const snap = await get(ref(database, `users/${uid}`));
    return snap.exists() ? snap.val() : null;
  } catch (error: any) {
    console.error("❌ خطأ جلب البروفايل:", error);
    return null;
  }
};

// ============================================================
// 👤 المستخدم الحالي
// ============================================================
export const getCurrentUser = (): FirebaseUser | null => {
  return auth.currentUser;
};

export const isAdmin = (email: string): boolean => {
  return email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
};

// ============================================================
// ⚠️ رسائل الأخطاء
// ============================================================
const getErrorMessage = (code: string): string => {
  const errorMessages: { [key: string]: string } = {
    'auth/invalid-email': 'البريد الإلكتروني غير صحيح',
    'auth/user-disabled': 'هذا الحساب معطل',
    'auth/user-not-found': 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    'auth/wrong-password': 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    'auth/email-already-in-use': 'هذا البريد الإلكتروني مستخدم بالفعل',
    'auth/weak-password': 'كلمة المرور ضعيفة (6 أحرف على الأقل)',
    'auth/too-many-requests': 'محاولات كثيرة. حاول لاحقاً',
    'auth/network-request-failed': 'خطأ في الاتصال بالإنترنت',
    'auth/invalid-credential': 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    'auth/requires-recent-login': 'يجب تسجيل الدخول مرة أخرى',
    'auth/operation-not-allowed': 'هذه العملية غير مسموح بها. فعّل Email/Password من Firebase Console',
    'auth/configuration-not-found': 'إعدادات Firebase خاطئة. تحقق من config.ts',
    'PERMISSION_DENIED': 'صلاحيات Firebase خاطئة. تحقق من Rules',
  };
  
  return errorMessages[code] || `حدث خطأ: ${code}`;
};

// ============================================================
// ✅ التحقق من الجلسة
// ============================================================
export const verifyUserSession = async (): Promise<User | null> => {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) return null;
    
    const userProfile = await getUserProfile(currentUser.uid);
    return userProfile;
  } catch (error: any) {
    console.error("❌ خطأ التحقق من الجلسة:", error);
    return null;
  }
};