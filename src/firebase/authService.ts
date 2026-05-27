import { 
  signInWithEmailAndPassword, 
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  updateProfile,
  updatePassword,
  User as FirebaseUser
} from "firebase/auth";
import { ref, set, get, update, remove } from "firebase/database";
import { auth, database } from "./config";
import { User, TeacherPermissions } from "../types/user";

// ⚠️ غيّر هذا الايميل لايميل الأدمن الجديد
const ADMIN_EMAIL = "mujtabahaitham@gmail.com";

// ============================================================
// 🔐 تسجيل الدخول
// ============================================================
export const signIn = async (email: string, password: string): Promise<User> => {
  try {
    console.log('🔐 محاولة تسجيل الدخول...', email);
    
    // 🆕 سجّل دخول مباشرة أولاً (قبل أي قراءة من DB)
    let userCredential;
    let actualPassword = password;
    let needsPasswordUpdate = false;
    let storedPasswordForUpdate = '';
    
    try {
      userCredential = await signInWithEmailAndPassword(auth, email, password);
      console.log('✅ تسجيل دخول مباشر نجح');
    } catch (firstError: any) {
      // إذا فشل، شوف هل الأدمن غيّر كلمة المرور
      console.log('⚠️ فشل تسجيل دخول مباشر، جاري التحقق من كلمة مرور بديلة...');
      
      try {
        const usersRef = ref(database, 'users');
        const usersSnapshot = await get(usersRef);
        
        if (usersSnapshot.exists()) {
          const allUsers = usersSnapshot.val();
          const userEntry = Object.entries(allUsers).find(([_, user]: [string, any]) => 
            user.email?.toLowerCase() === email.toLowerCase()
          );
          
          if (userEntry) {
            const [uid] = userEntry as [string, any];
            const teacherAccountRef = ref(database, `teacherAccounts/${uid}`);
            const teacherSnapshot = await get(teacherAccountRef);
            
            if (teacherSnapshot.exists()) {
              const teacherData = teacherSnapshot.val();
              
              if (teacherData.newPassword && password === teacherData.newPassword && teacherData.storedPassword) {
                actualPassword = teacherData.storedPassword;
                storedPasswordForUpdate = password;
                needsPasswordUpdate = true;
                console.log('🔑 استخدام كلمة المرور القديمة لتحديثها');
                
                userCredential = await signInWithEmailAndPassword(auth, email, actualPassword);
                console.log('✅ تسجيل الدخول نجح بكلمة المرور القديمة');
              } else {
                throw firstError;
              }
            } else {
              throw firstError;
            }
          } else {
            throw firstError;
          }
        } else {
          throw firstError;
        }
      } catch {
        throw firstError;
      }
    }
    
    if (!userCredential) {
      throw new Error('فشل تسجيل الدخول');
    }
    
    const firebaseUser = userCredential.user;
    
    // 🔄 تحديث كلمة المرور إذا لزم الأمر
    if (needsPasswordUpdate && firebaseUser) {
      try {
        await updatePassword(firebaseUser, storedPasswordForUpdate);
        await update(ref(database, `teacherAccounts/${firebaseUser.uid}`), {
          newPassword: null,
          storedPassword: storedPasswordForUpdate,
          passwordLastUpdated: new Date().toISOString()
        });
        console.log('🔄 تم تحديث كلمة المرور');
      } catch (error) {
        console.error("⚠️ خطأ في تحديث كلمة المرور:", error);
      }
    }
    
    // 📥 جلب أو إنشاء بروفايل المستخدم
    const userRef = ref(database, `users/${firebaseUser.uid}`);
    const snapshot = await get(userRef);
    
    let user: User;
    
    if (snapshot.exists()) {
      user = snapshot.val();
      console.log('✅ تم تحميل بروفايل المستخدم');
      
      if (user.role === 'teacher' && user.active === false) {
        console.warn('⚠️ حساب التدريسي معطّل');
      }
    } else {
      // 🆕 المستخدم موجود بـ Auth بس مو بـ DB → ننشئه
      console.log('🆕 إنشاء بروفايل جديد للمستخدم');
      
      const role: 'admin' | 'teacher' = 
        email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? 'admin' : 'teacher';
      
      user = {
        uid: firebaseUser.uid,
        email: firebaseUser.email || email,
        displayName: firebaseUser.displayName || email.split('@')[0],
        role,
        active: true,
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
      };
      
      console.log(`✅ إنشاء حساب ${role === 'admin' ? 'أدمن' : 'تدريسي'}`);
    }
    
    user.lastLogin = new Date().toISOString();
    await set(userRef, user);
    
    console.log('✅ تسجيل الدخول مكتمل!');
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
    console.log('✅ تم تسجيل الخروج');
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
      collegeId,
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
      storedPassword: password,
      passwordLastReset: new Date().toISOString()
    });
    
    await secondarySignOut(secondaryAuth);
    console.log('✅ تم إنشاء حساب التدريسي');
    
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
    console.log('✅ تم تعيين التدريسي كأدمن كلية');
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
    console.log('✅ تم إلغاء تعيين أدمن الكلية');
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
    console.log('✅ تم تحديث الصلاحيات');
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
    console.log('✅ تم إعادة تفعيل التدريسي');
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
    
    return Object.values(snap.val()).filter(
      (user: any) => (user.role === 'teacher' || user.role === 'college_admin') && user.collegeId === collegeId
    );
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
  newPassword: string
): Promise<void> => {
  try {
    await update(ref(database, `teacherAccounts/${uid}`), {
      newPassword: newPassword,
      passwordLastReset: new Date().toISOString(),
      passwordResetBy: 'admin'
    });
    
    await update(ref(database, `users/${uid}`), {
      passwordLastReset: new Date().toISOString()
    });
    
    console.log('✅ تم تحديث كلمة المرور');
  } catch (error: any) {
    console.error("❌ خطأ تحديث كلمة المرور:", error);
    throw new Error('حدث خطأ أثناء تحديث كلمة المرور');
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
    
    console.log('✅ تم حذف الحساب');
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
    console.log('✅ تم تحديث البروفايل');
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