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
import { User } from "../types/user";

// Admin email
const ADMIN_EMAIL = "mujtabahaitham@gmail.com";

// Sign in with support for admin-changed passwords
export const signIn = async (email: string, password: string): Promise<User> => {
  try {
    // First check if there's a temporary password set by admin
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
        
        // Check for admin-set new password
        const teacherAccountRef = ref(database, `teacherAccounts/${uid}`);
        const teacherSnapshot = await get(teacherAccountRef);
        
        if (teacherSnapshot.exists()) {
          const teacherData = teacherSnapshot.val();
          
          // If admin set a new password and user is trying to use it
          if (teacherData.newPassword && password === teacherData.newPassword) {
            // Use the stored original password to sign in
            if (teacherData.storedPassword) {
              actualPassword = teacherData.storedPassword;
              needsPasswordUpdate = true;
            }
          }
        }
      }
    }
    
    // Sign in with Firebase
    const userCredential = await signInWithEmailAndPassword(auth, email, actualPassword);
    const firebaseUser = userCredential.user;
    
    // If user logged in with admin-set password, update Firebase password
    if (needsPasswordUpdate && userId) {
      try {
        await updatePassword(firebaseUser, password);
        
        // Clear the temporary password flags
        await update(ref(database, `teacherAccounts/${userId}`), {
          newPassword: null,
          storedPassword: password,
          passwordLastUpdated: new Date().toISOString()
        });
      } catch (error) {
        console.error("Error updating password:", error);
      }
    }
    
    // Get user role from database
    const userRef = ref(database, `users/${firebaseUser.uid}`);
    const snapshot = await get(userRef);
    
    let role: 'admin' | 'teacher' = 'teacher';
    
    if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      role = 'admin';
    } else if (snapshot.exists()) {
      role = snapshot.val().role || 'teacher';
    }
    
    // Update last login
    await update(userRef, {
      lastLogin: new Date().toISOString()
    });
    
    const user: User = {
      uid: firebaseUser.uid,
      email: firebaseUser.email || email,
      displayName: firebaseUser.displayName || email.split('@')[0],
      role,
      createdAt: snapshot.exists() ? snapshot.val().createdAt : new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };
    
    // Save/update user data
    await set(userRef, user);
    
    return user;
  } catch (error: any) {
    console.error("Sign in error:", error);
    throw new Error(getErrorMessage(error.code));
  }
};

// Sign out
export const signOut = async (): Promise<void> => {
  try {
    await firebaseSignOut(auth);
  } catch (error) {
    console.error("Sign out error:", error);
    throw error;
  }
};

// Create teacher account (admin only)
export const createTeacherAccount = async (
  email: string,
  password: string,
  displayName: string,
  adminUid: string
): Promise<void> => {
  try {
    // Create user account
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    // Update profile
    await updateProfile(user, { displayName });
    
    // Save teacher data
    const teacherData: User = {
      uid: user.uid,
      email,
      displayName,
      role: 'teacher',
      createdAt: new Date().toISOString()
    };
    
    await set(ref(database, `users/${user.uid}`), teacherData);
    
    // Save password info for admin reset feature
    await set(ref(database, `teacherAccounts/${user.uid}`), {
      email,
      displayName,
      createdBy: adminUid,
      createdAt: new Date().toISOString(),
      storedPassword: password, // Store initial password
      passwordLastReset: new Date().toISOString()
    });
    
    // Sign out the newly created user and sign back in as admin
    await firebaseSignOut(auth);
    
  } catch (error: any) {
    console.error("Create teacher error:", error);
    throw new Error(getErrorMessage(error.code));
  }
};

// Update teacher password directly (admin only)
export const updateTeacherPassword = async (
  uid: string,
  newPassword: string
): Promise<void> => {
  try {
    // Save the new password that teacher will use
    await update(ref(database, `teacherAccounts/${uid}`), {
      newPassword: newPassword,
      passwordLastReset: new Date().toISOString(),
      passwordResetBy: 'admin'
    });
    
    // Also update in users node
    await update(ref(database, `users/${uid}`), {
      passwordLastReset: new Date().toISOString()
    });
  } catch (error: any) {
    console.error("Update password error:", error);
    throw new Error('حدث خطأ أثناء تحديث كلمة المرور');
  }
};

// Delete teacher account (admin only)
export const deleteTeacherAccount = async (uid: string): Promise<void> => {
  try {
    // Delete user data
    await remove(ref(database, `users/${uid}`));
    await remove(ref(database, `teacherAccounts/${uid}`));
    await remove(ref(database, `userData/${uid}`));
    
    // Note: Deleting the Firebase Auth user requires Admin SDK
    // For now, we just mark it in database
    await set(ref(database, `deletedAccounts/${uid}`), {
      deletedAt: new Date().toISOString()
    });
  } catch (error: any) {
    console.error("Delete teacher error:", error);
    throw new Error('حدث خطأ أثناء حذف الحساب');
  }
};

// Get current user
export const getCurrentUser = (): FirebaseUser | null => {
  return auth.currentUser;
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
  };
  
  return errorMessages[code] || 'حدث خطأ. حاول مرة أخرى';
};
