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
    console.log('🔐 Attempting to sign in...');
    
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
              console.log('🔑 Using admin-set temporary password');
            }
          }
        }
      }
    }
    
    // Sign in with Firebase
    const userCredential = await signInWithEmailAndPassword(auth, email, actualPassword);
    const firebaseUser = userCredential.user;
    
    console.log('✅ Firebase authentication successful');
    
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
        
        console.log('🔄 Password updated to new admin-set password');
      } catch (error) {
        console.error("⚠️ Error updating password:", error);
      }
    }
    
    // Get user data from database (including profile settings)
    const userRef = ref(database, `users/${firebaseUser.uid}`);
    const snapshot = await get(userRef);
    
    let user: User;
    
    if (snapshot.exists()) {
      // Load existing user data (with profile settings)
      user = snapshot.val();
      console.log('✅ Loaded user profile from Firebase:', {
        displayName: user.displayName,
        email: user.email,
        role: user.role,
        hasPhoto: !!user.photoURL,
        hasBio: !!user.bio
      });
    } else {
      // Create new user data
      let role: 'admin' | 'teacher' = 'teacher';
      
      if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
        role = 'admin';
      }
      
      user = {
        uid: firebaseUser.uid,
        email: firebaseUser.email || email,
        displayName: firebaseUser.displayName || email.split('@')[0],
        role,
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
      };
      
      console.log('✅ Created new user profile');
    }
    
    // Update last login
    user.lastLogin = new Date().toISOString();
    
    // Save/update user data to Firebase
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

// Create teacher account (admin only)
export const createTeacherAccount = async (
  email: string,
  password: string,
  displayName: string,
  adminUid: string
): Promise<void> => {
  try {
    console.log('👨‍🏫 Creating teacher account...');
    
    // Create user account
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    console.log('✅ Firebase Auth account created');
    
    // Update profile
    await updateProfile(user, { displayName });
    
    // Save teacher data
    const teacherData: User = {
      uid: user.uid,
      email,
      displayName,
      role: 'teacher',
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };
    
    await set(ref(database, `users/${user.uid}`), teacherData);
    
    console.log('✅ Teacher user data saved to Firebase');
    
    // Save password info for admin reset feature
    await set(ref(database, `teacherAccounts/${user.uid}`), {
      email,
      displayName,
      createdBy: adminUid,
      createdAt: new Date().toISOString(),
      storedPassword: password, // Store initial password
      passwordLastReset: new Date().toISOString()
    });
    
    console.log('✅ Teacher account info saved');
    
    // Sign out the newly created user and sign back in as admin
    await firebaseSignOut(auth);
    
    console.log('✅ Teacher account created successfully');
    
  } catch (error: any) {
    console.error("❌ Create teacher error:", error);
    throw new Error(getErrorMessage(error.code));
  }
};

// Update teacher password directly (admin only)
export const updateTeacherPassword = async (
  uid: string,
  newPassword: string
): Promise<void> => {
  try {
    console.log('🔑 Updating teacher password...');
    
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
    
    // Delete user data
    await remove(ref(database, `users/${uid}`));
    console.log('✅ User data deleted');
    
    await remove(ref(database, `teacherAccounts/${uid}`));
    console.log('✅ Teacher account data deleted');
    
    await remove(ref(database, `userData/${uid}`));
    console.log('✅ User data (students, records) deleted');
    
    // Note: Deleting the Firebase Auth user requires Admin SDK
    // For now, we just mark it in database
    await set(ref(database, `deletedAccounts/${uid}`), {
      deletedAt: new Date().toISOString()
    });
    
    console.log('✅ Teacher account deleted successfully');
  } catch (error: any) {
    console.error("❌ Delete teacher error:", error);
    throw new Error('حدث خطأ أثناء حذف الحساب');
  }
};

// Update user profile (photo, displayName, bio)
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
    
    // Load user data from database
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