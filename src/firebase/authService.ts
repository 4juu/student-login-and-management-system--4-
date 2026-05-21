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

// Admin email
const ADMIN_EMAIL = "mujtabahaitham@gmail.com";

// Sign in with support for admin-changed passwords
export const signIn = async (email: string, password: string): Promise<User> => {
  try {
    console.log('🔐 Attempting to sign in...');
    
    const usersRef = ref(database, 'users');
    const usersSnapshot = await get(usersRef);
    
    let actualPassword = password;
    let needsPasswordUpdate = false;
    let userId = '';
    
    if (usersSnapshot.exists()) {
      const allUsers = usersSnapshot.val();
      const userEntry = Object.entries(allUsers).find(([_, user]: [string, any]) => 
        user.email.toLowerCase() === email.toLowerCase()
      );
      
      if (userEntry) {
        const [uid]: [string, any] = userEntry;
        userId = uid;
        
        const teacherAccountRef = ref(database, `teacherAccounts/${uid}`);
        const teacherSnapshot = await get(teacherAccountRef);
        
        if (teacherSnapshot.exists()) {
          const teacherData = teacherSnapshot.val();
          
          if (teacherData.newPassword && password === teacherData.newPassword) {
            if (teacherData.storedPassword) {
              actualPassword = teacherData.storedPassword;
              needsPasswordUpdate = true;
              console.log('🔑 Using admin-set temporary password');
            }
          }
        }
      }
    }
    
    const userCredential = await signInWithEmailAndPassword(auth, email, actualPassword);
    const firebaseUser = userCredential.user;
    
    console.log('✅ Firebase authentication successful');
    
    if (needsPasswordUpdate && userId) {
      try {
        await updatePassword(firebaseUser, password);
        
        await update(ref(database, `teacherAccounts/${userId}`), {
          newPassword: null,
          storedPassword: password,
          passwordLastUpdated: new Date().toISOString()
        });
        
        console.log('🔄 Password updated to new admin-set password');
      } catch (error) {
        console.error("⚠️ Error updating password:", error);
      }
    }
    
    const userRef = ref(database, `users/${firebaseUser.uid}`);
    const snapshot = await get(userRef);
    
    let user: User;
    
    if (snapshot.exists()) {
      user = snapshot.val();
      console.log('✅ Loaded user profile from Firebase:', {
        displayName: user.displayName,
        email: user.email,
        role: user.role,
        active: user.active,
        hasPhoto: !!user.photoURL,
        hasBio: !!user.bio,
        hasPermissions: !!user.permissions
      });
      
      // 🆕 تحقق من حالة التفعيل للتدريسيين
      if (user.role === 'teacher' && user.active === false) {
        console.warn('⚠️ Teacher account is deactivated (after academic year reset)');
        // ما نمنع الدخول، بس نبلغ المستخدم
        // الصلاحيات الفارغة راح تمنعه من رؤية أي شي
      }
    } else {
      let role: 'admin' | 'teacher' = 'teacher';
      
      if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
        role = 'admin';
      }
      
      user = {
        uid: firebaseUser.uid,
        email: firebaseUser.email || email,
        displayName: firebaseUser.displayName || email.split('@')[0],
        role,
        active: true, // 🆕 الأدمن دائماً مفعّل
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
      };
      
      console.log('✅ Created new user profile');
    }
    
    user.lastLogin = new Date().toISOString();
    
    await set(userRef, user);
    
    console.log('✅ Sign in successful! User data saved to Firebase');
    
    return user;
  } catch (error: any) {
    console.error("❌ Sign in error:", error);
    throw new Error(getErrorMessage(error.code));
  }
};

// Sign out
export const signOut = async (): Promise<void> => {
  try {
    console.log('👋 Signing out...');
    await firebaseSignOut(auth);
    console.log('✅ Sign out successful');
  } catch (error) {
    console.error("❌ Sign out error:", error);
    throw error;
  }
};

// Create teacher account using SECONDARY app
export const createTeacherAccount = async (
  email: string,
  password: string,
  displayName: string,
  adminUid: string
): Promise<void> => {
  try {
    console.log('👨‍🏫 Creating teacher account using secondary app...');
    
    const { secondaryAuth } = await import('./config');
    const { signOut: secondarySignOut } = await import('firebase/auth');
    
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const user = userCredential.user;
    
    console.log('✅ Firebase Auth account created (in secondary app)');
    
    await updateProfile(user, { displayName });
    
    const teacherData: User = {
      uid: user.uid,
      email,
      displayName,
      role: 'teacher',
      adminId: adminUid,
      active: true, // 🆕 مفعّل افتراضياً
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
    console.log('✅ Teacher user data saved');
    
    await set(ref(database, `teacherAccounts/${user.uid}`), {
      email,
      displayName,
      createdBy: adminUid,
      createdAt: new Date().toISOString(),
      storedPassword: password,
      passwordLastReset: new Date().toISOString()
    });
    
    console.log('✅ Teacher account info saved');
    
    await secondarySignOut(secondaryAuth);
    console.log('✅ Signed out from secondary app, admin session intact');
    
  } catch (error: any) {
    console.error("❌ Create teacher error:", error);
    throw new Error(getErrorMessage(error.code) || error.message);
  }
};

// Update teacher permissions (admin only)
export const updateTeacherPermissions = async (
  teacherUid: string,
  permissions: TeacherPermissions
): Promise<void> => {
  try {
    console.log('🔐 Updating teacher permissions for:', teacherUid);
    console.log('📋 New permissions:', permissions);
    
    await update(ref(database, `users/${teacherUid}`), {
      permissions,
      lastUpdated: new Date().toISOString()
    });
    
    console.log('✅ Teacher permissions updated successfully');
  } catch (error: any) {
    console.error('❌ Update permissions error:', error);
    throw new Error('فشل تحديث الصلاحيات');
  }
};

/**
 * 🆕 إعادة تفعيل تدريسي بعد التصفير السنوي
 * الأدمن يستخدمها لإعطاء التدريسي صلاحيات السنة الجديدة
 */
export const reactivateTeacher = async (
  teacherUid: string,
  permissions: TeacherPermissions
): Promise<void> => {
  try {
    console.log('🔓 Reactivating teacher:', teacherUid);
    
    await update(ref(database, `users/${teacherUid}`), {
      active: true,
      lastActivatedAt: new Date().toISOString(),
      deactivatedAt: null,
      permissions,
      lastUpdated: new Date().toISOString()
    });
    
    console.log('✅ Teacher reactivated successfully');
  } catch (error: any) {
    console.error('❌ Reactivate teacher error:', error);
    throw new Error('فشل إعادة تفعيل التدريسي');
  }
};

/**
 * 🆕 الحصول على كل التدريسيين التابعين للأدمن
 */
export const getAllTeachers = async (adminUid: string): Promise<User[]> => {
  try {
    const snap = await get(ref(database, 'users'));
    if (!snap.exists()) return [];
    
    const allUsers = snap.val();
    const teachers: User[] = [];
    
    Object.values(allUsers).forEach((user: any) => {
      if (user.role === 'teacher' && user.adminId === adminUid) {
        teachers.push(user);
      }
    });
    
    return teachers;
  } catch (error) {
    console.error('❌ Get teachers error:', error);
    return [];
  }
};

// Update teacher password directly (admin only)
export const updateTeacherPassword = async (
  uid: string,
  newPassword: string
): Promise<void> => {
  try {
    console.log('🔑 Updating teacher password...');
    
    await update(ref(database, `teacherAccounts/${uid}`), {
      newPassword: newPassword,
      passwordLastReset: new Date().toISOString(),
      passwordResetBy: 'admin'
    });
    
    await update(ref(database, `users/${uid}`), {
      passwordLastReset: new Date().toISOString()
    });
    
    console.log('✅ Teacher password updated successfully');
  } catch (error: any) {
    console.error("❌ Update password error:", error);
    throw new Error('حدث خطأ أثناء تحديث كلمة المرور');
  }
};

// Delete teacher account (admin only)
export const deleteTeacherAccount = async (uid: string): Promise<void> => {
  try {
    console.log('🗑️ Deleting teacher account...');
    
    await remove(ref(database, `users/${uid}`));
    console.log('✅ User data deleted');
    
    await remove(ref(database, `teacherAccounts/${uid}`));
    console.log('✅ Teacher account data deleted');
    
    await remove(ref(database, `userData/${uid}`));
    console.log('✅ User data (students, records) deleted');
    
    await set(ref(database, `deletedAccounts/${uid}`), {
      deletedAt: new Date().toISOString()
    });
    
    console.log('✅ Teacher account deleted successfully');
  } catch (error: any) {
    console.error("❌ Delete teacher error:", error);
    throw new Error('حدث خطأ أثناء حذف الحساب');
  }
};

// Update user profile
export const updateUserProfile = async (
  uid: string,
  updates: {
    displayName?: string;
    photoURL?: string;
    bio?: string;
  }
): Promise<void> => {
  try {
    console.log('📝 Updating user profile...', updates);
    
    const userRef = ref(database, `users/${uid}`);
    
    await update(userRef, {
      ...updates,
      lastUpdated: new Date().toISOString()
    });
    
    console.log('✅ User profile updated in Firebase');
  } catch (error: any) {
    console.error("❌ Update profile error:", error);
    throw new Error('حدث خطأ أثناء تحديث الملف الشخصي');
  }
};

// Get user profile from database
export const getUserProfile = async (uid: string): Promise<User | null> => {
  try {
    console.log('📥 Loading user profile...');
    
    const userRef = ref(database, `users/${uid}`);
    const snapshot = await get(userRef);
    
    if (snapshot.exists()) {
      const userData = snapshot.val();
      console.log('✅ User profile loaded:', {
        displayName: userData.displayName,
        hasPhoto: !!userData.photoURL,
        hasBio: !!userData.bio
      });
      return userData;
    }
    
    console.log('⚠️ No user profile found');
    return null;
  } catch (error: any) {
    console.error("❌ Get profile error:", error);
    return null;
  }
};

// Get current user
export const getCurrentUser = (): FirebaseUser | null => {
  return auth.currentUser;
};

// Check if user is admin
export const isAdmin = (email: string): boolean => {
  return email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
};

// Error messages in Arabic
const getErrorMessage = (code: string): string => {
  const errorMessages: { [key: string]: string } = {
    'auth/invalid-email': 'البريد الإلكتروني غير صحيح',
    'auth/user-disabled': 'هذا الحساب معطل',
    'auth/user-not-found': 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    'auth/wrong-password': 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    'auth/email-already-in-use': 'هذا البريد الإلكتروني مستخدم بالفعل',
    'auth/weak-password': 'كلمة المرور ضعيفة جداً (6 أحرف على الأقل)',
    'auth/too-many-requests': 'محاولات كثيرة. حاول مرة أخرى لاحقاً',
    'auth/network-request-failed': 'خطأ في الاتصال بالإنترنت',
    'auth/invalid-credential': 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    'auth/requires-recent-login': 'يجب تسجيل الدخول مرة أخرى لإجراء هذا التغيير',
    'auth/operation-not-allowed': 'هذه العملية غير مسموح بها',
  };
  
  return errorMessages[code] || 'حدث خطأ. حاول مرة أخرى';
};

// Verify user session
export const verifyUserSession = async (): Promise<User | null> => {
  try {
    const currentUser = auth.currentUser;
    
    if (!currentUser) {
      console.log('⚠️ No user session found');
      return null;
    }
    
    console.log('🔍 Verifying user session...');
    
    const userProfile = await getUserProfile(currentUser.uid);
    
    if (userProfile) {
      console.log('✅ User session verified');
      return userProfile;
    }
    
    console.log('⚠️ User profile not found in database');
    return null;
  } catch (error: any) {
    console.error("❌ Verify session error:", error);
    return null;
  }
};