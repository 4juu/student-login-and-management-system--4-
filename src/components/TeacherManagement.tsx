import React, { useState, useEffect } from 'react';
import {
  createTeacherAccount,
  updateTeacherPermissions,
  updateTeacherPassword,
  deleteTeacherAccount,
  reactivateTeacher,
  getAllTeachersForCollege,
  promoteToCollegeAdmin,
  demoteFromCollegeAdmin
} from '../firebase/authService';
import { User, TeacherPermissions } from '../types/user';
import { College, Stage } from '../types/student';
import { ArrowLeft, BookOpen, CircleCheck, Crown, GraduationCap, KeyRound, Landmark, Lightbulb, Lock, Plus, RefreshCw, Save, Settings, SquarePen, Trash2, TriangleAlert, Truck, User as UserIcon, UserCheck, Users, Wrench } from 'lucide-react';
import { useConfirm } from '../hooks/useConfirm';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { LoadingState } from './loading/LoadingState';
import { PageTransition } from './PageTransition';
import { MorphingSquare } from './MorphingSquare';
import { toast } from '@/hooks/use-toast';

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
  const { confirm: confirmAction, ConfirmDialog: ConfirmDialogEl } = useConfirm();
  const [showAddForm, setShowAddForm] = useState(false);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showMigrationModal, setShowMigrationModal] = useState(false);
  const [selectedTeacher, setSelectedTeacher] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [currentTeacherPassword, setCurrentTeacherPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [teachersLoading, setTeachersLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editProfileName, setEditProfileName] = useState('');
  const [editProfileBio, setEditProfileBio] = useState('');
  // Ã™â€žÃ™â€žÃ˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã˜Â§Ã™â€žÃ˜Â±Ã˜Â¦Ã™Å Ã˜Â³Ã™Å : Ã˜Â§Ã˜Â®Ã˜ÂªÃ™Å Ã˜Â§Ã˜Â± Ã™Æ’Ã™â€žÃ™Å Ã˜Â© Ã™â€žÃ˜Â¹Ã˜Â±Ã˜Â¶ Ã˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å Ã™Å Ã™â€¡Ã˜Â§
  const [selectedCollegeId, setSelectedCollegeId] = useState<string | null>(null);
  // migratoryja: Ã˜ÂªÃ˜Â¹Ã™Å Ã™Å Ã™â€  Ã™Æ’Ã™â€žÃ™Å Ã˜Â© Ã™â€žÃ™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å Ã™Å Ã™â€  Ã˜Â§Ã™â€žÃ™â€šÃ˜Â¯Ã˜Â§Ã™â€¦Ã™â€°
  const [migrationMap, setMigrationMap] = useState<{[uid: string]: string}>({});

  // Ã°Å¸â€ â€¢ Ã˜Â¥Ã˜Â¯Ã˜Â§Ã˜Â±Ã˜Â© Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã˜Â§Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â© Ã™â€¦Ã™â€  Ã˜Â¨Ã˜Â·Ã˜Â§Ã™â€šÃ˜Â© Ã˜Â§Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â©
  const [showAssignAdminModal, setShowAssignAdminModal] = useState(false);
  const [assignAdminCollegeId, setAssignAdminCollegeId] = useState<string | null>(null);
  const [assignAdminCollegeName, setAssignAdminCollegeName] = useState('');
  const [showRemoveAdminConfirm, setShowRemoveAdminConfirm] = useState<string | null>(null);

  useBodyScrollLock(
    (showAssignAdminModal && !!assignAdminCollegeId) || !!showRemoveAdminConfirm || showMigrationModal ||
    (showPermissionModal && !!selectedTeacher) || (showProfileModal && !!selectedTeacher) || (showPasswordModal && !!selectedTeacher)
  );

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
    setTeachersLoading(true);
    try {
      if (isCollegeAdmin && currentUser.collegeId) {
        const list = await getAllTeachersForCollege(currentUser.collegeId);
        setTeachers(list);
        return;
      }

      if (isMainAdmin) {
        // Ã™Æ’Ã™â€žÃ™Å Ã˜Â© Ã™â€¦Ã˜Â­Ã˜Â¯Ã˜Â¯Ã˜Â© Ã¢â€ â€™ Ã˜Â§Ã˜Â³Ã˜ÂªÃ˜Â¹Ã™â€žÃ˜Â§Ã™â€¦ Ã™â€¦Ã™ÂÃ™â€¡Ã˜Â±Ã˜Â³ Ã˜Â¨Ã˜Â§Ã™â€žÃ™â‚¬collegeId
        if (selectedCollegeId && selectedCollegeId !== '__all__') {
          const list = await getAllTeachersForCollege(selectedCollegeId);
          setTeachers(list);
          return;
        }

        // Ã˜Â§Ã™â€žÃ™Æ’Ã™â€ž (Ã˜Â¨Ã™â€žÃ˜Â§ Ã˜Â§Ã˜Â®Ã˜ÂªÃ™Å Ã˜Â§Ã˜Â± Ã˜Â£Ã™Ë† "__all__") Ã¢â€ â€™ Ã˜Â§Ã˜Â³Ã˜ÂªÃ˜Â¹Ã™â€žÃ˜Â§Ã™â€¦Ã˜Â§Ã™â€  Ã™â€¦Ã˜Â­Ã˜Â¯Ã™Ë†Ã˜Â¯Ã˜Â§Ã™â€  Ã˜Â¨Ã˜Â§Ã™â€žÃ˜Â¯Ã™Ë†Ã˜Â± Ã˜Â¨Ã˜Â¯Ã™â€ž users Ã™Æ’Ã˜Â§Ã™â€¦Ã™â€žÃ˜Â©
        const { ref, get, query, orderByChild, equalTo } = await import('firebase/database');
        const { database } = await import('../firebase/config');
        const fetchByRole = async (role: string): Promise<User[]> => {
          const snap = await get(query(ref(database, 'users'), orderByChild('role'), equalTo(role)));
          return snap.exists() ? (Object.values(snap.val()) as User[]) : [];
        };
        const [teachersList, collegeAdminsList] = await Promise.all([
          fetchByRole('teacher'),
          fetchByRole('college_admin'),
        ]);
        setTeachers([...teachersList, ...collegeAdminsList]);
        return;
      }

      setTeachers([]);
    } catch (e) {
      console.error('Error loading teachers:', e);
    } finally {
      setTeachersLoading(false);
    }
  };

  const handleFixOldTeachers = async () => {
    const ok = await confirmAction({
      title: 'Ã˜Â¥Ã˜ÂµÃ™â€žÃ˜Â§Ã˜Â­ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å Ã™Å Ã™â€  Ã˜Â§Ã™â€žÃ™â€šÃ˜Â¯Ã˜Â§Ã™â€¦Ã™â€°',
      message: 'Ã™â€¡Ã˜Â°Ã™â€¡ Ã˜Â§Ã™â€žÃ˜Â£Ã˜Â¯Ã˜Â§Ã˜Â© Ã˜Â³Ã˜ÂªÃ˜Â±Ã˜Â¨Ã˜Â· Ã˜Â¬Ã™â€¦Ã™Å Ã˜Â¹ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å Ã™Å Ã™â€  Ã˜Â§Ã™â€žÃ™â€šÃ˜Â¯Ã˜Â§Ã™â€¦Ã™â€° Ã˜Â¨Ã˜Â­Ã˜Â³Ã˜Â§Ã˜Â¨Ã™Æ’ (Ã™Æ’Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€ ) Ã™Ë†Ã˜ÂªÃ˜Â¬Ã™â€¡Ã˜Â²Ã™â€¡Ã™â€¦ Ã™â€žÃ˜Â§Ã˜Â³Ã˜ÂªÃ™â€šÃ˜Â¨Ã˜Â§Ã™â€ž Ã˜Â§Ã™â€žÃ˜ÂµÃ™â€žÃ˜Â§Ã˜Â­Ã™Å Ã˜Â§Ã˜Âª. Ã™â€¦Ã˜ÂªÃ˜Â§Ã˜Â¨Ã˜Â¹Ã˜Â©Ã˜Å¸',
      confirmLabel: 'Ã™â€¦Ã˜ÂªÃ˜Â§Ã˜Â¨Ã˜Â¹Ã˜Â©',
    });
    if (!ok) return;
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
      toast({ title: `Ã˜ÂªÃ™â€¦ Ã˜Â¥Ã˜ÂµÃ™â€žÃ˜Â§Ã˜Â­ ${fixed} Ã˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å .\nÃ˜Â§Ã™â€žÃ˜Â¢Ã™â€  Ã˜ÂªÃ™â€šÃ˜Â¯Ã˜Â± Ã˜ÂªÃ˜Â¶Ã˜ÂºÃ˜Â· "Ã˜Â§Ã™â€žÃ˜ÂµÃ™â€žÃ˜Â§Ã˜Â­Ã™Å Ã˜Â§Ã˜Âª" Ã™â€žÃ™Æ’Ã™â€ž Ã™Ë†Ã˜Â§Ã˜Â­Ã˜Â¯ Ã™â€¦Ã™â€ Ã™â€¡Ã™â€¦ Ã™Ë†Ã˜ÂªÃ˜Â­Ã˜Â¯Ã˜Â¯ Ã™â€žÃ™â€¡ Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã˜Â§Ã˜Â­Ã™â€ž.` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleReactivateTeacher = async (teacher: User) => {
    const ok = await confirmAction({
      title: 'Ã˜Â¥Ã˜Â¹Ã˜Â§Ã˜Â¯Ã˜Â© Ã˜ÂªÃ™ÂÃ˜Â¹Ã™Å Ã™â€ž Ã˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å ',
      message: `Ã˜Â¥Ã˜Â¹Ã˜Â§Ã˜Â¯Ã˜Â© Ã˜ÂªÃ™ÂÃ˜Â¹Ã™Å Ã™â€ž ${teacher.displayName}Ã˜Å¸ Ã˜Â³Ã™Å Ã˜ÂªÃ™â€¦ Ã˜ÂªÃ™ÂÃ˜Â¹Ã™Å Ã™â€ž Ã˜Â­Ã˜Â³Ã˜Â§Ã˜Â¨Ã™â€¡ Ã˜Â¨Ã˜Â¯Ã™Ë†Ã™â€  Ã˜ÂµÃ™â€žÃ˜Â§Ã˜Â­Ã™Å Ã˜Â§Ã˜Âª. Ã˜Â¨Ã˜Â¹Ã˜Â¯ Ã˜Â°Ã™â€žÃ™Æ’ Ã™Å Ã˜Â¬Ã˜Â¨ Ã˜ÂªÃ˜Â­Ã˜Â¯Ã™Å Ã˜Â¯ Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã˜Â§Ã˜Â­Ã™â€ž Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â³Ã™â€¦Ã™Ë†Ã˜Â­Ã˜Â© Ã™â€žÃ™â€¡ Ã™â€¦Ã™â€  Ã˜Â²Ã˜Â± "Ã˜Â§Ã™â€žÃ˜ÂµÃ™â€žÃ˜Â§Ã˜Â­Ã™Å Ã˜Â§Ã˜Âª".`,
      confirmLabel: 'Ã˜Â¥Ã˜Â¹Ã˜Â§Ã˜Â¯Ã˜Â© Ã˜ÂªÃ™ÂÃ˜Â¹Ã™Å Ã™â€ž',
    });
    if (!ok) return;
    setLoading(true);
    try {
      await reactivateTeacher(teacher.uid, {
        allowedStages: {},
        canViewRecords: true,
        canTakeAttendance: true,
      });
      setSuccess(`Ã˜ÂªÃ™â€¦ Ã˜ÂªÃ™ÂÃ˜Â¹Ã™Å Ã™â€ž ${teacher.displayName}. Ã˜Â§Ã™â€žÃ˜Â¢Ã™â€  Ã˜Â­Ã˜Â¯Ã˜Â¯ Ã™â€žÃ™â€¡ Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã˜Â§Ã˜Â­Ã™â€ž Ã™â€¦Ã™â€  Ã˜Â²Ã˜Â± "Ã˜Â§Ã™â€žÃ˜ÂµÃ™â€žÃ˜Â§Ã˜Â­Ã™Å Ã˜Â§Ã˜Âª".`);
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
    } catch {
      toast({ variant: 'destructive', title: 'Ã™ÂÃ˜Â´Ã™â€ž Ã˜ÂªÃ˜Â­Ã˜Â¯Ã™Å Ã˜Â« Ã˜Â§Ã™â€žÃ˜ÂµÃ™â€žÃ˜Â§Ã˜Â­Ã™Å Ã˜Â§Ã˜Âª' });
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
    } catch {
      toast({ variant: 'destructive', title: 'Ã™ÂÃ˜Â´Ã™â€ž Ã˜ÂªÃ˜Â­Ã˜Â¯Ã™Å Ã˜Â« Ã˜Â§Ã™â€žÃ˜ÂµÃ™â€žÃ˜Â§Ã˜Â­Ã™Å Ã˜Â§Ã˜Âª' });
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
    } catch {
      toast({ variant: 'destructive', title: 'Ã™ÂÃ˜Â´Ã™â€ž Ã˜ÂªÃ˜Â­Ã˜Â¯Ã™Å Ã˜Â« Ã˜Â§Ã™â€žÃ˜ÂµÃ™â€žÃ˜Â§Ã˜Â­Ã™Å Ã˜Â§Ã˜Âª' });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!formData.email || !formData.password || !formData.displayName) {
      return setError('Ã˜Â§Ã™â€¦Ã™â€žÃ˜Â£ Ã˜Â¬Ã™â€¦Ã™Å Ã˜Â¹ Ã˜Â§Ã™â€žÃ˜Â­Ã™â€šÃ™Ë†Ã™â€ž');
    }
    if (formData.password.length < 6) {
      return setError('Ã™Æ’Ã™â€žÃ™â€¦Ã˜Â© Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã™Ë†Ã˜Â± Ã™Å Ã˜Â¬Ã˜Â¨ Ã˜Â£Ã™â€  Ã˜ÂªÃ™Æ’Ã™Ë†Ã™â€  6 Ã˜Â£Ã˜Â­Ã˜Â±Ã™Â Ã˜Â¹Ã™â€žÃ™â€° Ã˜Â§Ã™â€žÃ˜Â£Ã™â€šÃ™â€ž');
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
      setSuccess(`Ã˜ÂªÃ™â€¦ Ã˜Â¥Ã™â€ Ã˜Â´Ã˜Â§Ã˜Â¡ Ã˜Â­Ã˜Â³Ã˜Â§Ã˜Â¨ ${formData.displayName} Ã˜Â¨Ã™â€ Ã˜Â¬Ã˜Â§Ã˜Â­!\n\nÃ˜Â§Ã™â€žÃ˜Â¢Ã™â€  Ã˜Â§Ã˜Â¶Ã˜ÂºÃ˜Â· Ã˜Â¹Ã™â€žÃ™â€° "Ã˜Â§Ã™â€žÃ˜ÂµÃ™â€žÃ˜Â§Ã˜Â­Ã™Å Ã˜Â§Ã˜Âª" Ã˜Â¨Ã˜Â¬Ã™â€ Ã˜Â¨ Ã˜Â§Ã˜Â³Ã™â€¦Ã™â€¡ Ã™â€žÃ˜ÂªÃ˜Â­Ã˜Â¯Ã™Å Ã˜Â¯ Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã˜Â§Ã˜Â­Ã™â€ž Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â³Ã™â€¦Ã™Ë†Ã˜Â­Ã˜Â©.`);
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
    setCurrentTeacherPassword('');
    setShowPasswordModal(true);
    setError('');
  };

  const handleChangePassword = async () => {
    if (!selectedTeacher) return;
    setError('');
    if (!newPassword.trim() || newPassword.length < 6) {
      return setError('Ã™Æ’Ã™â€žÃ™â€¦Ã˜Â© Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã™Ë†Ã˜Â± Ã™Å Ã˜Â¬Ã˜Â¨ Ã˜Â£Ã™â€  Ã˜ÂªÃ™Æ’Ã™Ë†Ã™â€  6 Ã˜Â£Ã˜Â­Ã˜Â±Ã™Â Ã˜Â¹Ã™â€žÃ™â€° Ã˜Â§Ã™â€žÃ˜Â£Ã™â€šÃ™â€ž');
    }
    setLoading(true);
    try {
      await updateTeacherPassword(selectedTeacher.uid, newPassword, currentTeacherPassword || undefined);
      setSuccess(`Ã˜ÂªÃ™â€¦ Ã˜ÂªÃ˜ÂºÃ™Å Ã™Å Ã˜Â± Ã™Æ’Ã™â€žÃ™â€¦Ã˜Â© Ã™â€¦Ã˜Â±Ã™Ë†Ã˜Â± ${selectedTeacher.displayName} Ã˜Â¨Ã™â€ Ã˜Â¬Ã˜Â§Ã˜Â­`);
      setShowPasswordModal(false);
      setNewPassword('');
      setCurrentTeacherPassword('');
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
      setSuccess(`Ã˜ÂªÃ™â€¦ Ã˜ÂªÃ˜Â­Ã˜Â¯Ã™Å Ã˜Â« Ã™â€¦Ã™â€žÃ™Â ${editProfileName.trim()}`);
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
    const ok = await confirmAction({
      title: 'Ã˜Â­Ã˜Â°Ã™Â Ã˜Â­Ã˜Â³Ã˜Â§Ã˜Â¨ Ã˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å ',
      message: `Ã™â€¡Ã™â€ž Ã˜Â£Ã™â€ Ã˜Âª Ã™â€¦Ã˜ÂªÃ˜Â£Ã™Æ’Ã˜Â¯ Ã™â€¦Ã™â€  Ã˜Â­Ã˜Â°Ã™Â Ã˜Â­Ã˜Â³Ã˜Â§Ã˜Â¨ ${teacher.displayName}Ã˜Å¸ Ã˜Â³Ã™Å Ã˜ÂªÃ™â€¦ Ã˜Â­Ã˜Â°Ã™Â Ã˜Â¬Ã™â€¦Ã™Å Ã˜Â¹ Ã˜Â¨Ã™Å Ã˜Â§Ã™â€ Ã˜Â§Ã˜ÂªÃ™â€¡ Ã™â€ Ã™â€¡Ã˜Â§Ã˜Â¦Ã™Å Ã˜Â§Ã™â€¹!`,
      confirmLabel: 'Ã˜Â­Ã˜Â°Ã™Â Ã™â€ Ã™â€¡Ã˜Â§Ã˜Â¦Ã™Å ',
    });
    if (!ok) return;
    setLoading(true);
    try {
      await deleteTeacherAccount(teacher.uid);
      setSuccess(`Ã˜ÂªÃ™â€¦ Ã˜Â­Ã˜Â°Ã™Â Ã˜Â­Ã˜Â³Ã˜Â§Ã˜Â¨ ${teacher.displayName}`);
      await loadTeachers();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Ã˜ÂªÃ˜Â±Ã˜Â­Ã™Å Ã™â€ž Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å Ã™Å Ã™â€  Ã˜Â§Ã™â€žÃ™â€šÃ˜Â¯Ã˜Â§Ã™â€¦Ã™â€° Ã™â€žÃ˜ÂªÃ˜Â¹Ã™Å Ã™Å Ã™â€  Ã™Æ’Ã™â€žÃ™Å Ã˜Â©
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
      setSuccess(`Ã˜ÂªÃ™â€¦ Ã˜ÂªÃ˜Â¹Ã™Å Ã™Å Ã™â€  Ã™Æ’Ã™â€žÃ™Å Ã˜Â© Ã™â€žÃ™â‚¬ ${count} Ã˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å `);
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

  // Ã˜Â®Ã˜Â±Ã™Å Ã˜Â·Ã˜Â© Ã™Æ’Ã™â€ž Ã™Æ’Ã™â€žÃ™Å Ã˜Â© Ã¢â€ â€™ Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€ Ã™â€¡Ã˜Â§ Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â§Ã™â€žÃ™Å 
  const collegeAdminMap: {[collegeId: string]: User} = {};
  teachers.forEach(t => {
    if (t.role === 'college_admin' && t.collegeId) {
      collegeAdminMap[t.collegeId] = t;
    }
  });

  // --- Ã˜Â´Ã˜Â§Ã˜Â´Ã˜Â© Ã™Æ’Ã˜Â±Ã™Ë†Ã˜Âª Ã˜Â§Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â§Ã˜Âª Ã™â€žÃ™â€žÃ˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã˜Â§Ã™â€žÃ˜Â±Ã˜Â¦Ã™Å Ã˜Â³Ã™Å  ---
  if (isMainAdmin && !selectedCollegeId) {
    const allTeachersFull = teachers;
    const collegeTeacherCount: {[collegeId: string]: number} = {};
    for (const c of colleges) {
      collegeTeacherCount[c.id] = allTeachersFull.filter(t => t.collegeId === c.id).length;
    }
    const unassignedCount = allTeachersFull.filter(t => !t.collegeId).length;

    return (
      <div className="glass-card rounded-xl p-4 sm:p-6">
        <div className="flex justify-between items-center mb-4 sm:mb-6 flex-wrap gap-3">
          <h2 className="text-xl sm:text-2xl font-semibold text-white flex items-center gap-2"><GraduationCap className="w-6 h-6" /> Ã˜Â§Ã˜Â®Ã˜ÂªÃ™Å Ã˜Â§Ã˜Â± Ã˜Â§Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â© Ã™â€žÃ˜Â¹Ã˜Â±Ã˜Â¶ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å Ã™Å Ã™â€ </h2>
          <div className="flex gap-2 flex-wrap">
            {!selectedCollegeId && allTeachersFull.some(t => !t.collegeId) && (
              <button
                onClick={() => setShowMigrationModal(true)}
                disabled={loading}
                className="btn-base btn-secondary"
              >
                <Truck className="w-4 h-4" /> Ã˜ÂªÃ˜Â±Ã˜Â­Ã™Å Ã™â€ž Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å Ã™Å Ã™â€  Ã˜Â§Ã™â€žÃ™â€šÃ˜Â¯Ã˜Â§Ã™â€¦Ã™â€°
              </button>
            )}
            <button
              onClick={handleFixOldTeachers}
              disabled={loading}
              className="btn-base btn-secondary disabled:opacity-50"
            >
              <Wrench className="w-4 h-4" /> Ã˜Â¥Ã˜ÂµÃ™â€žÃ˜Â§Ã˜Â­ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å Ã™Å Ã™â€  Ã˜Â§Ã™â€žÃ™â€šÃ˜Â¯Ã˜Â§Ã™â€¦Ã™â€°
            </button>
          </div>
        </div>

        {success && (
          <div role="status" className="mb-4 p-4 bg-green-500/10 border-2 border-green-500/40 text-green-300 rounded-md font-medium">{success}</div>
        )}
        {error && (
          <div role="alert" className="mb-4 p-3 bg-red-500/10 border border-red-500/40 text-red-300 rounded-md">{error}</div>
        )}

        {unassignedCount > 0 && (
          <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-center gap-3">
            <TriangleAlert className="w-7 h-7 text-yellow-600" />
            <div className="flex-1">
              <p className="text-sm font-bold text-yellow-300">
                Ã™Å Ã™Ë†Ã˜Â¬Ã˜Â¯ {unassignedCount} Ã˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å  Ã˜Â¨Ã˜Â¯Ã™Ë†Ã™â€  Ã™Æ’Ã™â€žÃ™Å Ã˜Â© Ã™â€¦Ã˜Â­Ã˜Â¯Ã˜Â¯Ã˜Â© Ã¢â‚¬â€ Ã˜Â§Ã˜Â¶Ã˜ÂºÃ˜Â· "Ã˜ÂªÃ˜Â±Ã˜Â­Ã™Å Ã™â€ž Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å Ã™Å Ã™â€  Ã˜Â§Ã™â€žÃ™â€šÃ˜Â¯Ã˜Â§Ã™â€¦Ã™â€°" Ã™â€žÃ˜ÂªÃ˜Â¹Ã™Å Ã™Å Ã™â€  Ã™Æ’Ã™â€žÃ™Å Ã˜Â© Ã™â€žÃ™â€¡Ã™â€¦
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {colleges.map((college, idx) => {
            const count = collegeTeacherCount[college.id] || 0;
            const admin = collegeAdminMap[college.id];
            return (
              <div
                key={college.id}
                className="animate-cardEnter border-2 border-white/10 rounded-xl hover:border-blue-400 hover:shadow-lg transition-colors duration-300 overflow-hidden bg-white/5"
                style={{ animationDelay: `${idx * 60}ms` }}
              >
                {/* Ã˜Â±Ã˜Â£Ã˜Â³ Ã˜Â§Ã™â€žÃ˜Â¨Ã˜Â·Ã˜Â§Ã™â€šÃ˜Â© - Ã™â€šÃ˜Â§Ã˜Â¨Ã™â€žÃ˜Â© Ã™â€žÃ™â€žÃ˜Â¶Ã˜ÂºÃ˜Â· Ã™â€žÃ™â€žÃ˜Â¯Ã˜Â®Ã™Ë†Ã™â€ž Ã™â€žÃ™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â© */}
                <button
                  onClick={() => setSelectedCollegeId(college.id)}
                  className="w-full p-5 text-start hover:bg-blue-500/10 transition-colors duration-200"
                >
                  <div className="text-4xl mb-3">{college.icon || 'Ã°Å¸Ââ€ºÃ¯Â¸Â'}</div>
                  <h3 className="text-base sm:text-lg font-semibold text-white">{college.name}</h3>
                  <p className="text-sm text-slate-400 mt-1">
                    {count} Ã˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å {count !== 1 ? 'Ã™Å Ã™â€ ' : ''}
                    {count === 0 && ' Ã¢â‚¬â€ Ã™â€žÃ˜Â§ Ã™Å Ã™Ë†Ã˜Â¬Ã˜Â¯ Ã˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å Ã™Å Ã™â€  Ã˜Â¨Ã˜Â¹Ã˜Â¯'}
                  </p>
                </button>

                {/* Ã˜Â´Ã˜Â±Ã™Å Ã˜Â· Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã˜Â§Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â© */}
                <div className={`px-5 py-3 border-t ${admin ? 'bg-amber-500/10 border-amber-500/30' : 'bg-white/5 border-white/10'}`}>
                  {admin ? (
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Landmark className="w-5 h-5 text-amber-300" />
                        <div className="min-w-0">
                          <p className="text-xs text-amber-300 font-medium">Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã˜Â§Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â©</p>
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
                          className="text-xs bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 px-2.5 py-1.5 rounded-md font-medium transition duration-200"
                        >
                          <RefreshCw className="w-3.5 h-3.5" /> Ã˜ÂªÃ˜ÂºÃ™Å Ã™Å Ã˜Â±
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowRemoveAdminConfirm(college.id);
                          }}
                          className="text-xs bg-red-500/10 hover:bg-red-500/25 text-red-300 px-2.5 py-1.5 rounded-md font-medium transition duration-200"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Ã˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¡
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-slate-400">Ã™â€žÃ˜Â§ Ã™Å Ã™Ë†Ã˜Â¬Ã˜Â¯ Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã™â€žÃ™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â©</p>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setAssignAdminCollegeId(college.id);
                          setAssignAdminCollegeName(college.name);
                          setShowAssignAdminModal(true);
                        }}
                        disabled={count === 0}
                        className={`text-xs font-medium px-3 py-1.5 rounded-md transition duration-200 ${
                          count === 0
                            ? 'bg-white/10 text-slate-500 cursor-not-allowed'
                            : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300'
                        }`}
                      >
                        Ã˜ÂªÃ˜Â¹Ã™Å Ã™Å Ã™â€  Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€ 
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {/* Ã˜Â¨Ã˜Â·Ã˜Â§Ã™â€šÃ˜Â© Ã˜Â¹Ã˜Â±Ã˜Â¶ Ã˜Â§Ã™â€žÃ™Æ’Ã™â€ž */}
          <button
            onClick={() => setSelectedCollegeId('__all__')}
            className="p-6 border-2 border-dashed border-slate-600 rounded-xl hover:border-slate-400 hover:shadow-lg transition-colors duration-200 text-center bg-white/5"
          >
            <Users className="w-12 h-12 text-slate-500 mx-auto mb-3" />
            <h3 className="text-base sm:text-lg font-semibold text-white">Ã˜Â¹Ã˜Â±Ã˜Â¶ Ã˜Â§Ã™â€žÃ™Æ’Ã™â€ž</h3>
            <p className="text-sm text-slate-400 mt-2">{allTeachersFull.length} Ã˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å </p>
          </button>
        </div>

        {/* Ã°Å¸â€ â€¢ Ã™â€¦Ã™Ë†Ã˜Â¯Ã˜Â§Ã™â€ž Ã˜ÂªÃ˜Â¹Ã™Å Ã™Å Ã™â€  Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â© */}
        {showAssignAdminModal && assignAdminCollegeId && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fadeIn">
            <div className="glass-modal w-[calc(100vw-2rem)] max-w-lg text-white space-y-4 animate-modalUp focus:outline-none">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-semibold text-white flex items-center gap-2"><Landmark className="w-5 h-5 text-amber-300 shrink-0" /> Ã˜ÂªÃ˜Â¹Ã™Å Ã™Å Ã™â€  Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â© {assignAdminCollegeName}</h3>
                  <p className="text-sm text-slate-400 mt-1">Ã˜Â§Ã˜Â®Ã˜ÂªÃ˜Â± Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å  Ã™â€¦Ã™â€  Ã˜Â§Ã™â€žÃ™â€šÃ˜Â§Ã˜Â¦Ã™â€¦Ã˜Â© Ã™â€žÃ˜ÂªÃ˜Â¹Ã™Å Ã™Å Ã™â€ Ã™â€¡ Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã™â€žÃ™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â©</p>
                </div>
                <button onClick={() => setShowAssignAdminModal(false)} className="shrink-0 flex items-center justify-center w-10 h-10 text-3xl text-slate-500 hover:text-slate-400 leading-none transition-colors duration-200">&times;</button>
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
                      <p className="font-medium">Ã™â€žÃ˜Â§ Ã™Å Ã™Ë†Ã˜Â¬Ã˜Â¯ Ã˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å Ã™Å Ã™â€  Ã™ÂÃ™Å  Ã™â€¡Ã˜Â°Ã™â€¡ Ã˜Â§Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â©</p>
                      <p className="text-sm mt-1">Ã˜Â£Ã˜Â¶Ã™Â Ã˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å Ã™Å Ã™â€  Ã˜Â£Ã™Ë†Ã™â€žÃ˜Â§Ã™â€¹ Ã™â€¦Ã™â€  Ã˜Â¯Ã˜Â§Ã˜Â®Ã™â€ž Ã˜Â§Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â©</p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-2">
                    {currentAdmin && (
                      <div className="p-3 bg-amber-500/10 border-2 border-amber-500/30 rounded-xl flex items-center gap-3">
                        <Crown className="w-8 h-8 text-amber-400" />
                        <div>
                          <p className="text-xs text-amber-300 font-medium">Ã˜Â§Ã™â€žÃ˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â§Ã™â€žÃ™Å </p>
                          <p className="font-bold text-amber-200">{currentAdmin.displayName}</p>
                        </div>
                      </div>
                    )}
                    {collegeTeachers.map(t => (
                      <button
                        key={t.uid}
                        onClick={async () => {
                          const ok = await confirmAction({
                            title: 'Ã˜ÂªÃ˜Â¹Ã™Å Ã™Å Ã™â€  Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã™Æ’Ã™â€žÃ™Å Ã˜Â©',
                            message: `Ã˜ÂªÃ˜Â¹Ã™Å Ã™Å Ã™â€  ${t.displayName} Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â© ${assignAdminCollegeName}Ã˜Å¸`,
                            confirmLabel: 'Ã˜ÂªÃ˜Â¹Ã™Å Ã™Å Ã™â€ ',
                          });
                          if (!ok) return;
                          setLoading(true);
                          try {
                            await promoteToCollegeAdmin(t.uid, assignAdminCollegeId, assignAdminCollegeName);
                            toast({ title: `Ã˜ÂªÃ™â€¦ Ã˜ÂªÃ˜Â¹Ã™Å Ã™Å Ã™â€  ${t.displayName} Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â© ${assignAdminCollegeName}` });
                            setShowAssignAdminModal(false);
                            await loadTeachers();
                          } catch (e: any) {
                            toast({ variant: 'destructive', title: e.message });
                          } finally {
                            setLoading(false);
                          }
                        }}
                        disabled={loading}
                        className="w-full text-start p-4 border-2 border-white/10 rounded-xl hover:border-amber-400 hover:bg-amber-500/10 transition-colors duration-200 flex items-center gap-3 group"
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
                        <ArrowLeft className="w-6 h-6 text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                      </button>
                    ))}
                  </div>
                );
              })()}

              <div className="pt-4 border-t border-white/10 flex justify-end">
                <button
                  onClick={() => setShowAssignAdminModal(false)}
                  className="btn-base btn-secondary"
                >
                  Ã˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¡
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Ã°Å¸â€ â€¢ Ã˜ÂªÃ˜Â£Ã™Æ’Ã™Å Ã˜Â¯ Ã˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¡ Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã™Æ’Ã™â€žÃ™Å Ã˜Â© */}
        {showRemoveAdminConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fadeIn">
            <div className="glass-modal w-[calc(100vw-2rem)] max-w-sm text-white space-y-4 animate-modalUp focus:outline-none">
              <div className="text-center">
                <div className="mx-auto w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4"><TriangleAlert className="w-7 h-7 text-red-400" /></div>
                <h3 className="text-base sm:text-lg font-semibold text-white">Ã˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¡ Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã˜Â§Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â©</h3>
                <p className="text-sm text-slate-400 mt-2">
                  Ã™â€¡Ã™â€ž Ã˜Â£Ã™â€ Ã˜Âª Ã™â€¦Ã˜ÂªÃ˜Â£Ã™Æ’Ã˜Â¯ Ã™â€¦Ã™â€  Ã˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¡ Ã˜ÂªÃ˜Â¹Ã™Å Ã™Å Ã™â€  <strong className="text-slate-300">{collegeAdminMap[showRemoveAdminConfirm]?.displayName}</strong> Ã™Æ’Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â© {colleges.find(c => c.id === showRemoveAdminConfirm)?.name}Ã˜Å¸
                </p>
                <p className="text-xs text-slate-500 mt-2">Ã˜Â³Ã™Å Ã˜ÂªÃ™â€¦ Ã˜ÂªÃ˜Â­Ã™Ë†Ã™Å Ã™â€žÃ™â€¡ Ã˜Â¥Ã™â€žÃ™â€° Ã˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å  Ã˜Â¹Ã˜Â§Ã˜Â¯Ã™Å  Ã™â€¦Ã˜Â¹ Ã˜Â§Ã˜Â­Ã˜ÂªÃ™ÂÃ˜Â§Ã˜Â¸Ã™â€¡ Ã˜Â¨Ã™â€ Ã™ÂÃ˜Â³ Ã˜Â§Ã™â€žÃ˜ÂµÃ™â€žÃ˜Â§Ã˜Â­Ã™Å Ã˜Â§Ã˜Âª</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setShowRemoveAdminConfirm(null)}
                  className="flex-1 btn-base btn-secondary"
                >
                  Ã˜ÂªÃ˜Â±Ã˜Â§Ã˜Â¬Ã˜Â¹
                </button>
                <button
                  onClick={async () => {
                    const admin = collegeAdminMap[showRemoveAdminConfirm];
                    if (!admin) return;
                    setLoading(true);
                    try {
                      await demoteFromCollegeAdmin(admin.uid);
                      toast({ title: `Ã˜ÂªÃ™â€¦ Ã˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¡ Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã˜Â§Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â© Ã˜Â¹Ã™â€  ${admin.displayName}` });
                      setShowRemoveAdminConfirm(null);
                      await loadTeachers();
                    } catch (e: any) {
                      toast({ variant: 'destructive', title: e.message });
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={loading}
                  className="flex-1 btn-base btn-danger"
                >
                  {loading ? 'Ã˜Â¬Ã˜Â§Ã˜Â±Ã™Å ...' : <><CircleCheck className="w-4 h-4" /> Ã˜ÂªÃ˜Â£Ã™Æ’Ã™Å Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¡</>}
                </button>
              </div>
            </div>
          </div>
        )}

        {showMigrationModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fadeIn">
            <div className="glass-modal w-[calc(100vw-2rem)] max-w-2xl text-white space-y-4 animate-modalUp focus:outline-none">
              <h3 className="text-base sm:text-lg font-semibold text-white flex items-center gap-2"><Truck className="w-5 h-5 shrink-0" /> Ã˜ÂªÃ˜Â±Ã˜Â­Ã™Å Ã™â€ž Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å Ã™Å Ã™â€  Ã˜Â§Ã™â€žÃ™â€šÃ˜Â¯Ã˜Â§Ã™â€¦Ã™â€° Ã¢â‚¬â€ Ã˜ÂªÃ˜Â¹Ã™Å Ã™Å Ã™â€  Ã™Æ’Ã™â€žÃ™Å Ã˜Â©</h3>
              <p className="text-sm text-slate-400">Ã˜Â§Ã˜Â®Ã˜ÂªÃ˜Â± Ã˜Â§Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â© Ã˜Â§Ã™â€žÃ™â€¦Ã™â€ Ã˜Â§Ã˜Â³Ã˜Â¨Ã˜Â© Ã™â€žÃ™Æ’Ã™â€ž Ã˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å :</p>
              <div className="space-y-3">
                {allTeachersFull.filter(t => !t.collegeId).map(t => (
                  <div key={t.uid} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 border border-white/10 rounded-lg">
                    <div className="flex-1 font-medium text-white">{t.displayName}</div>
                    <select
                      value={migrationMap[t.uid] || ''}
                      onChange={e => setMigrationMap(prev => ({...prev, [t.uid]: e.target.value}))}
                      className="glass-input text-sm"
                    >
                      <option value="">-- Ã˜Â§Ã˜Â®Ã˜ÂªÃ˜Â± Ã™Æ’Ã™â€žÃ™Å Ã˜Â© --</option>
                      {colleges.map(c => (
                        <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 justify-end pt-4 border-t border-white/10">
                <button
                  onClick={() => { setShowMigrationModal(false); setMigrationMap({}); }}
                  disabled={loading}
                  className="btn-base btn-secondary"
                >
                  Ã˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¡
                </button>
                <button
                  onClick={handleMigrateCollege}
                  disabled={loading}
                  className="btn-base btn-primary"
                >
                  {loading ? 'Ã˜Â¬Ã˜Â§Ã˜Â±Ã™Â Ã˜Â§Ã™â€žÃ˜Â­Ã™ÂÃ˜Â¸...' : 'Ã°Å¸â€™Â¾ Ã˜Â­Ã™ÂÃ˜Â¸'}
                </button>
              </div>
            </div>
          </div>
        )}


      </div>
    );
  }

  // --- Ã˜Â´Ã˜Â§Ã˜Â´Ã˜Â© Ã˜Â¹Ã˜Â±Ã˜Â¶ Ã˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å Ã™Å Ã™â€  Ã™Æ’Ã™â€žÃ™Å Ã˜Â© Ã™â€¦Ã˜Â­Ã˜Â¯Ã˜Â¯Ã˜Â© Ã™â€žÃ™â€žÃ˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã˜Â§Ã™â€žÃ˜Â±Ã˜Â¦Ã™Å Ã˜Â³Ã™Å  Ã˜Â£Ã™Ë† Ã˜Â´Ã˜Â§Ã˜Â´Ã˜Â© Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã˜Â§Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â© ---
  const displayTeachers = selectedCollegeId === '__all__'
    ? teachers
    : teachers;
  const collegeName = isCollegeAdmin
    ? (colleges.find(c => c.id === currentUser.collegeId)?.name || '')
    : selectedCollegeId
    ? (colleges.find(c => c.id === selectedCollegeId)?.name || '')
    : '';

  return (
    <div className="glass-card rounded-xl p-4 sm:p-6">
      <PageTransition dep={`college-${selectedCollegeId}`}>
      <div className="flex justify-between items-center mb-4 sm:mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {isMainAdmin && (
            <button
              onClick={() => { setSelectedCollegeId(null); setTeachers([]); }}
              className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm font-medium hover:underline transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
              Ã˜Â§Ã™â€žÃ˜Â¹Ã™Ë†Ã˜Â¯Ã˜Â© Ã™â€žÃ™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â§Ã˜Âª
            </button>
          )}
          <h2 className="text-xl sm:text-2xl font-semibold text-white flex items-center gap-2">
            {isMainAdmin ? <><GraduationCap className="w-6 h-6" /> Ã˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å Ã™Ë†Ã™â€  Ã™Æ’Ã™â€žÃ™Å Ã˜Â© {collegeName}</> : <><Landmark className="w-6 h-6" /> Ã˜ÂµÃ™â€žÃ˜Â§Ã˜Â­Ã™Å Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å Ã™Å Ã™â€ </>}
          </h2>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isMainAdmin && (
            <button 
              onClick={() => setShowAddForm(!showAddForm)} 
              className="btn-base btn-primary"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Ã˜Â¥Ã˜Â¶Ã˜Â§Ã™ÂÃ˜Â© Ã˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å 
            </button>
          )}
        </div>
      </div>

      {displayTeachers.length > 0 && (
        <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
          <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-center">
            <div className="text-2xl font-bold text-blue-300">{displayTeachers.length}</div>
            <div className="text-xs text-blue-400">Ã˜Â¥Ã˜Â¬Ã™â€¦Ã˜Â§Ã™â€žÃ™Å  Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å Ã™Å Ã™â€ </div>
          </div>
          <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-center">
            <div className="text-2xl font-bold text-green-300">{activeTeachers}</div>
            <div className="text-xs text-green-400 flex items-center justify-center gap-1"><CircleCheck className="w-3.5 h-3.5" /> Ã™â€¦Ã™ÂÃ˜Â¹Ã™â€˜Ã™â€ž</div>
          </div>
          {deactivatedTeachers > 0 && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-center">
              <div className="text-2xl font-bold text-red-300">{deactivatedTeachers}</div>
              <div className="text-xs text-red-400 flex items-center justify-center gap-1"><Lock className="w-3.5 h-3.5" /> Ã™â€¦Ã˜Â¹Ã˜Â·Ã™â€˜Ã™â€ž (Ã˜Â¨Ã˜Â¹Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜ÂµÃ™ÂÃ™Å Ã˜Â±)</div>
            </div>
          )}
        </div>
      )}

      {deactivatedTeachers > 0 && (
        <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-center gap-3">
          <TriangleAlert className="w-7 h-7 text-yellow-600" />
          <div className="flex-1">
            <p className="text-sm font-bold text-yellow-300">
              Ã™Å Ã™Ë†Ã˜Â¬Ã˜Â¯ {deactivatedTeachers} Ã˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å  Ã™â€¦Ã˜Â¹Ã˜Â·Ã™â€˜Ã™â€ž Ã˜Â¨Ã˜Â¹Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜ÂµÃ™ÂÃ™Å Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â³Ã™â€ Ã™Ë†Ã™Å 
            </p>
            <p className="text-xs text-yellow-400">
              Ã˜Â§Ã˜Â¶Ã˜ÂºÃ˜Â· Ã˜Â²Ã˜Â± "Ã˜Â¥Ã˜Â¹Ã˜Â§Ã˜Â¯Ã˜Â© Ã˜ÂªÃ™ÂÃ˜Â¹Ã™Å Ã™â€ž" Ã˜Â¨Ã˜Â¬Ã˜Â§Ã™â€ Ã˜Â¨ Ã˜Â§Ã˜Â³Ã™â€¦ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å  Ã™â€žÃ˜Â¥Ã˜Â¹Ã˜Â§Ã˜Â¯Ã˜Â© Ã˜ÂªÃ™ÂÃ˜Â¹Ã™Å Ã™â€žÃ™â€¡Ã˜Å’ Ã˜Â«Ã™â€¦ Ã˜Â­Ã˜Â¯Ã˜Â¯ Ã™â€žÃ™â€¡ Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã˜Â§Ã˜Â­Ã™â€ž Ã™â€¦Ã™â€  "Ã˜Â§Ã™â€žÃ˜ÂµÃ™â€žÃ˜Â§Ã˜Â­Ã™Å Ã˜Â§Ã˜Âª".
            </p>
          </div>
        </div>
      )}

      {success && (
        <div role="status" className="p-3 bg-green-500/10 border border-green-500/40 text-green-300 rounded mb-4 whitespace-pre-line">{success}</div>
      )}
      {error && (
        <div role="alert" className="p-3 bg-red-500/10 border border-red-500/40 text-red-300 rounded mb-4">{error}</div>
      )}

      {showAddForm && (
        <form onSubmit={handleSubmit} className="mb-4 sm:mb-6 p-4 sm:p-5 space-y-4 bg-gradient-to-br from-blue-500/10 to-indigo-500/10 border-2 border-blue-500/30 rounded-lg">
          <h3 className="text-base sm:text-lg font-semibold text-white flex items-center gap-2"><Plus className="w-5 h-5 shrink-0" /> Ã˜Â¥Ã˜Â¶Ã˜Â§Ã™ÂÃ˜Â© Ã˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å  Ã˜Â¬Ã˜Â¯Ã™Å Ã˜Â¯</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">Ã˜Â§Ã™â€žÃ˜Â§Ã˜Â³Ã™â€¦ Ã˜Â§Ã™â€žÃ™Æ’Ã˜Â§Ã™â€¦Ã™â€ž</label>
              <input type="text" value={formData.displayName} onChange={e => setFormData({...formData, displayName: e.target.value})} className="glass-input text-sm" placeholder="Ã˜Â¯. Ã˜Â£Ã˜Â­Ã™â€¦Ã˜Â¯ Ã™â€¦Ã˜Â­Ã™â€¦Ã˜Â¯" disabled={loading} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">Ã˜Â§Ã™â€žÃ˜Â¨Ã˜Â±Ã™Å Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜Â¥Ã™â€žÃ™Æ’Ã˜ÂªÃ˜Â±Ã™Ë†Ã™â€ Ã™Å </label>
              <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="glass-input text-sm" placeholder="teacher@example.com" dir="ltr" disabled={loading} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">Ã™Æ’Ã™â€žÃ™â€¦Ã˜Â© Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã™Ë†Ã˜Â±</label>
              <input type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} className="glass-input text-sm" placeholder="6 Ã˜Â£Ã˜Â­Ã˜Â±Ã™Â Ã˜Â¹Ã™â€žÃ™â€° Ã˜Â§Ã™â€žÃ˜Â£Ã™â€šÃ™â€ž" dir="ltr" disabled={loading} />
            </div>
          </div>
          {(isMainAdmin && !selectedCollegeId) && colleges.length > 0 && (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">Ã˜Â§Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â©</label>
              <select value={formData.collegeId} onChange={e => setFormData({...formData, collegeId: e.target.value})} className="glass-input text-sm">
                <option value="">-- Ã˜Â§Ã˜Â®Ã˜ÂªÃ˜Â± Ã˜Â§Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â© --</option>
                {colleges.map(c => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={loading} className="flex-1 btn-base btn-primary">
              {loading ? <><MorphingSquare size="sm" /> Ã˜Â¬Ã˜Â§Ã˜Â±Ã™Â Ã˜Â§Ã™â€žÃ˜Â¥Ã™â€ Ã˜Â´Ã˜Â§Ã˜Â¡...</> : <><CircleCheck className="w-4 h-4" /> Ã˜Â¥Ã™â€ Ã˜Â´Ã˜Â§Ã˜Â¡ Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â³Ã˜Â§Ã˜Â¨</>}
            </button>
            <button type="button" onClick={() => { setShowAddForm(false); setFormData({ email: '', password: '', displayName: '', collegeId: '' }); setError(''); }} className="btn-base btn-secondary">
              Ã˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¡
            </button>
          </div>
          <div className="mt-3 p-3 bg-green-500/10 border border-green-500/30 rounded text-sm text-green-300 flex items-start gap-1">
            <CircleCheck className="w-4 h-4 shrink-0 mt-0.5" /> <strong>Ã˜Â¬Ã™â€žÃ˜Â³Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã™â€¦Ã˜Â­Ã™ÂÃ™Ë†Ã˜Â¸Ã˜Â©:</strong> Ã˜Â§Ã™â€žÃ™â€ Ã˜Â¸Ã˜Â§Ã™â€¦ Ã™Å Ã˜Â³Ã˜ÂªÃ˜Â®Ã˜Â¯Ã™â€¦ Ã˜ÂªÃ˜Â·Ã˜Â¨Ã™Å Ã™â€š Firebase Ã˜Â«Ã˜Â§Ã™â€ Ã™Ë†Ã™Å  Ã™â€žÃ˜Â¥Ã™â€ Ã˜Â´Ã˜Â§Ã˜Â¡ Ã˜Â­Ã˜Â³Ã˜Â§Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å  Ã˜Â¨Ã˜Â¯Ã™Ë†Ã™â€  Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â£Ã˜Â«Ã™Å Ã˜Â± Ã˜Â¹Ã™â€žÃ™â€° Ã˜Â¬Ã™â€žÃ˜Â³Ã˜ÂªÃ™Æ’ Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â§Ã™â€žÃ™Å Ã˜Â©.
          </div>
        </form>
      )}

      <div className="table-container">
        <table className="glass-table min-w-full divide-y divide-white/10">
          <thead className="bg-white/5">
            <tr>
              <th scope="col" className="px-3 sm:px-6 py-3 text-start text-xs font-medium text-slate-400 uppercase">Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å </th>
              <th scope="col" className="hidden sm:table-cell px-3 sm:px-6 py-3 text-start text-xs font-medium text-slate-400 uppercase">Ã˜Â§Ã™â€žÃ˜Â¨Ã˜Â±Ã™Å Ã˜Â¯</th>
              <th scope="col" className="px-3 sm:px-6 py-3 text-start text-xs font-medium text-slate-400 uppercase">Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â§Ã™â€žÃ˜Â©</th>
              <th scope="col" className="hidden sm:table-cell px-3 sm:px-6 py-3 text-start text-xs font-medium text-slate-400 uppercase">Ã˜Â§Ã™â€žÃ˜ÂµÃ™â€žÃ˜Â§Ã˜Â­Ã™Å Ã˜Â§Ã˜Âª</th>
              <th scope="col" className="px-3 sm:px-6 py-3 text-start text-xs font-medium text-slate-400 uppercase">Ã˜Â¥Ã˜Â¬Ã˜Â±Ã˜Â§Ã˜Â¡Ã˜Â§Ã˜Âª</th>
            </tr>
          </thead>
          <tbody className="bg-white/5 divide-y divide-white/10">
            {teachersLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-4">
                  <LoadingState size="sm" className="py-6" />
                </td>
              </tr>
            ) : displayTeachers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-slate-400">
                  Ã™â€žÃ˜Â§ Ã˜ÂªÃ™Ë†Ã˜Â¬Ã˜Â¯ Ã˜Â­Ã˜Â³Ã˜Â§Ã˜Â¨Ã˜Â§Ã˜Âª Ã˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å Ã™Å Ã™â€  Ã™ÂÃ™Å  Ã™â€¡Ã˜Â°Ã™â€¡ Ã˜Â§Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â©
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
                              <span className="ms-2 text-xs bg-orange-500/15 text-orange-300 px-2 py-0.5 rounded-full">Ã™Å Ã˜Â­Ã˜ÂªÃ˜Â§Ã˜Â¬ Ã˜Â¥Ã˜ÂµÃ™â€žÃ˜Â§Ã˜Â­</span>
                            )}
                          </div>
                          {t.bio && <div className="text-xs text-slate-400 truncate max-w-xs">{t.bio}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="hidden sm:table-cell px-3 sm:px-6 py-4 text-xs sm:text-sm text-slate-400" dir="ltr">{t.email}</td>
                    <td className="px-3 sm:px-6 py-4 text-xs sm:text-sm">
                      {isDeactivated ? (
                        <span className="inline-flex items-center px-2 sm:px-3 py-1 rounded-full bg-red-500/15 text-red-300 font-medium text-xs sm:text-xs gap-1"><Lock className="w-3 h-3" /> Ã™â€¦Ã˜Â¹Ã˜Â·Ã™â€˜Ã™â€ž</span>
                      ) : (
                        <span className="inline-flex items-center px-2 sm:px-3 py-1 rounded-full bg-green-500/15 text-green-300 font-medium text-xs sm:text-xs gap-1"><CircleCheck className="w-3 h-3" /> Ã™â€¦Ã™ÂÃ˜Â¹Ã™â€˜Ã™â€ž</span>
                      )}
                    </td>
                    <td className="hidden sm:table-cell px-3 sm:px-6 py-4 text-xs sm:text-sm">
                      {allowedCount === 0 ? (
                        <span className="inline-flex items-center px-2 sm:px-3 py-1 rounded-full bg-red-500/15 text-red-300 font-medium text-xs sm:text-xs gap-1"><Lock className="w-3 h-3" /> Ã™â€žÃ˜Â§ Ã˜ÂªÃ™Ë†Ã˜Â¬Ã˜Â¯ Ã˜ÂµÃ™â€žÃ˜Â§Ã˜Â­Ã™Å Ã˜Â§Ã˜Âª</span>
                      ) : (
                        <span className="inline-flex items-center px-2 sm:px-3 py-1 rounded-full bg-green-500/15 text-green-300 font-medium text-xs sm:text-xs gap-1"><CircleCheck className="w-3 h-3" /> {allowedCount} Ã™â€¦Ã˜Â±Ã˜Â­Ã™â€žÃ˜Â©</span>
                      )}
                    </td>
                    <td className="px-3 sm:px-6 py-4 text-xs sm:text-sm">
                      <div className="flex flex-wrap gap-1 sm:gap-2">
                        {isDeactivated && (
                          <button onClick={() => handleReactivateTeacher(t)} disabled={loading} className="bg-green-500/15 hover:bg-green-500/25 text-green-300 px-2 sm:px-3 py-1 rounded font-medium text-xs sm:text-xs inline-flex items-center gap-1"><UserCheck className="w-3 h-3" /> Ã˜Â¥Ã˜Â¹Ã˜Â§Ã˜Â¯Ã˜Â© Ã˜ÂªÃ™ÂÃ˜Â¹Ã™Å Ã™â€ž</button>
                        )}
                        <button onClick={() => { setSelectedTeacher(t); setShowPermissionModal(true); }} className="bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 px-2 sm:px-3 py-1 rounded font-medium text-xs sm:text-xs inline-flex items-center gap-1"><Settings className="w-3 h-3" /> Ã˜Â§Ã™â€žÃ˜ÂµÃ™â€žÃ˜Â§Ã˜Â­Ã™Å Ã˜Â§Ã˜Âª</button>
                        <button onClick={() => { setSelectedTeacher(t); setEditProfileName(t.displayName); setEditProfileBio(t.bio || ''); setShowProfileModal(true); }} className="bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 px-2 sm:px-3 py-1 rounded font-medium text-xs sm:text-xs inline-flex items-center gap-1"><SquarePen className="w-3 h-3" /> Ã˜Â§Ã™â€žÃ™â€¦Ã™â€žÃ™Â</button>
                        {isMainAdmin && (
                          <button onClick={() => handleOpenPasswordModal(t)} className="bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 px-2 sm:px-3 py-1 rounded font-medium text-xs sm:text-xs inline-flex items-center gap-1"><KeyRound className="w-3 h-3" /> Ã˜Â§Ã™â€žÃ˜Â±Ã™â€¦Ã˜Â²</button>
                        )}
                          {isMainAdmin && t.role === 'college_admin' && (
                            <button onClick={async () => { const ok = await confirmAction({ title: 'Ã˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¡ Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€ ', message: `Ã˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¡ Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã™Æ’Ã™â€žÃ™Å Ã˜Â© Ã˜Â¹Ã™â€  ${t.displayName}Ã˜Å¸`, confirmLabel: 'Ã˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¡ Ã˜Â§Ã™â€žÃ˜Â£Ã˜Â¯Ã™â€¦Ã™â€ ' }); if (ok) { await demoteFromCollegeAdmin(t.uid); await loadTeachers(); } }} disabled={loading} className="bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 px-2 sm:px-3 py-1 rounded font-medium text-xs sm:text-xs inline-flex items-center gap-1"><UserIcon className="w-3 h-3" /> Ã˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¡ Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€ </button>
                          )}
                          {isMainAdmin && t.role !== 'college_admin' && (() => {
                            const cId = selectedCollegeId === '__all__' ? (t.collegeId || '') : (selectedCollegeId || '');
                            const cName = colleges.find(c => c.id === cId)?.name || '';
                            if (!cId) return null;
                            return (
                              <button onClick={async () => { const ok = await confirmAction({ title: 'Ã˜ÂªÃ˜Â¹Ã™Å Ã™Å Ã™â€  Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã™Æ’Ã™â€žÃ™Å Ã˜Â©', message: `Ã˜ÂªÃ˜Â¹Ã™Å Ã™Å Ã™â€  ${t.displayName} Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€  Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â© ${cName}Ã˜Å¸`, confirmLabel: 'Ã˜ÂªÃ˜Â¹Ã™Å Ã™Å Ã™â€ ' }); if (ok) { await promoteToCollegeAdmin(t.uid, cId, cName); await loadTeachers(); } }} disabled={loading} className="bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 px-2 sm:px-3 py-1 rounded font-medium text-xs sm:text-xs inline-flex items-center gap-1"><Landmark className="w-3 h-3" /> Ã˜ÂªÃ˜Â¹Ã™Å Ã™Å Ã™â€  Ã˜Â£Ã˜Â¯Ã™â€¦Ã™â€ </button>
                            );
                          })()}
                          {isMainAdmin && (
                          <button onClick={() => handleDeleteTeacher(t)} disabled={loading} className="bg-red-500/10 hover:bg-red-500/25 text-red-300 px-2 sm:px-3 py-1 rounded font-medium text-xs sm:text-xs inline-flex items-center gap-1"><Trash2 className="w-3 h-3" /> Ã˜Â­Ã˜Â°Ã™Â</button>
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
      </PageTransition>

      {showPermissionModal && selectedTeacher && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="glass-modal text-white w-[calc(100vw-2rem)] max-w-3xl animate-modalUp focus:outline-none">
            <div className="px-4 sm:px-6 py-4 border-b flex flex-wrap justify-between items-center gap-3 sticky top-0 bg-slate-900/95 backdrop-blur-md z-10">
              <div className="min-w-0">
                <h3 className="text-base sm:text-lg font-semibold text-white flex items-center gap-2"><Settings className="w-5 h-5 shrink-0" /> Ã˜ÂµÃ™â€žÃ˜Â§Ã˜Â­Ã™Å Ã˜Â§Ã˜Âª: {selectedTeacher.displayName}</h3>
                <p className="text-sm text-slate-400 mt-1">Ã˜Â­Ã˜Â¯Ã˜Â¯ Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã˜Â§Ã˜Â­Ã™â€ž Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â³Ã™â€¦Ã™Ë†Ã˜Â­ Ã™â€žÃ™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å  Ã˜Â¨Ã˜Â§Ã™â€žÃ™Ë†Ã˜ÂµÃ™Ë†Ã™â€ž Ã˜Â¥Ã™â€žÃ™Å Ã™â€¡Ã˜Â§</p>
              </div>
              <button onClick={() => setShowPermissionModal(false)} className="flex items-center justify-center w-10 h-10 text-3xl text-slate-500 hover:text-slate-400 leading-none transition-colors duration-200">Ãƒâ€”</button>
            </div>
            <div className="px-4 sm:px-6 py-4 space-y-4">
              {colleges.length === 0 ? (
                <div className="text-center py-8 text-slate-400">Ã™â€žÃ˜Â§ Ã˜ÂªÃ™Ë†Ã˜Â¬Ã˜Â¯ Ã™Æ’Ã™â€žÃ™Å Ã˜Â§Ã˜Âª. Ã˜Â£Ã˜Â¶Ã™Â Ã™Æ’Ã™â€žÃ™Å Ã˜Â© Ã˜Â£Ã™Ë†Ã™â€žÃ˜Â§Ã™â€¹ Ã™â€¦Ã™â€  Ã˜ÂªÃ˜Â¨Ã™Ë†Ã™Å Ã˜Â¨ "Ã˜Â¥Ã˜Â¯Ã˜Â§Ã˜Â±Ã˜Â© Ã˜Â§Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â§Ã˜Âª"</div>
              ) : (
                colleges.map(college => {
                  const collegeStages = stages.filter(s => s.collegeId === college.id);
                  const allowedInCollege = selectedTeacher.permissions?.allowedStages?.[college.id] || [];
                  const allSelected = collegeStages.length > 0 && allowedInCollege.length === collegeStages.length;
                  return (
                    <div key={college.id} className="border-2 border-white/10 rounded-lg overflow-hidden">
                      <div className="bg-white/5 p-3 flex flex-wrap justify-between items-center gap-2">
                        <div className="font-semibold text-base sm:text-lg">
                          {college.icon} {college.name}
                          <span className="text-sm font-normal text-slate-400 ms-2">({allowedInCollege.length}/{collegeStages.length})</span>
                        </div>
                        {collegeStages.length > 0 && (
                          <div className="flex gap-2">
                            <button onClick={() => handleSelectAllStagesInCollege(selectedTeacher, college.id)} disabled={allSelected} className="btn-base btn-primary text-xs px-2">Ã˜ÂªÃ˜Â­Ã˜Â¯Ã™Å Ã˜Â¯ Ã˜Â§Ã™â€žÃ™Æ’Ã™â€ž</button>
                            <button onClick={() => handleDeselectAllStagesInCollege(selectedTeacher, college.id)} disabled={allowedInCollege.length === 0} className="btn-base btn-danger text-xs px-2">Ã˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¡ Ã˜Â§Ã™â€žÃ™Æ’Ã™â€ž</button>
                          </div>
                        )}
                      </div>
                      <div className="p-3">
                        {collegeStages.length === 0 ? (
                          <p className="text-sm text-slate-400 text-center py-3">Ã™â€žÃ˜Â§ Ã˜ÂªÃ™Ë†Ã˜Â¬Ã˜Â¯ Ã™â€¦Ã˜Â±Ã˜Â§Ã˜Â­Ã™â€ž Ã™ÂÃ™Å  Ã™â€¡Ã˜Â°Ã™â€¡ Ã˜Â§Ã™â€žÃ™Æ’Ã™â€žÃ™Å Ã˜Â©</p>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {collegeStages.sort((a, b) => (a.order || 0) - (b.order || 0)).map(stage => {
                              const isAllowed = allowedInCollege.includes(stage.id);
                              return (
                                <button key={stage.id} onClick={() => handleToggleStage(selectedTeacher, college.id, stage.id)} className={`p-3 rounded-md text-start flex justify-between items-center border-2 transition duration-200 ${isAllowed ? 'bg-green-500/10 text-green-300 border-green-500/50' : 'bg-white/5 text-slate-400 border-white/10 hover:border-white/30'}`}>
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
            <div className="px-4 sm:px-6 py-4 border-t bg-white/5 sticky bottom-0">
              <div className="flex flex-wrap justify-between items-center gap-3">
                <p className="text-sm text-slate-400">Ã˜Â§Ã™â€žÃ˜Â¥Ã˜Â¬Ã™â€¦Ã˜Â§Ã™â€žÃ™Å : <strong>{countAllowedStages(selectedTeacher)}</strong> Ã™â€¦Ã˜Â±Ã˜Â­Ã™â€žÃ˜Â© Ã™â€¦Ã˜Â³Ã™â€¦Ã™Ë†Ã˜Â­Ã˜Â©</p>
                <button onClick={() => setShowPermissionModal(false)} className="btn-base btn-primary"><CircleCheck className="w-4 h-4" /> Ã˜ÂªÃ™â€¦</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showProfileModal && selectedTeacher && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="glass-modal w-[calc(100vw-2rem)] max-w-md text-white space-y-4 animate-modalUp focus:outline-none">
            <h3 className="text-base sm:text-lg font-semibold text-white flex items-center gap-2"><SquarePen className="w-5 h-5 shrink-0" /> Ã˜ÂªÃ˜Â¹Ã˜Â¯Ã™Å Ã™â€ž Ã™â€¦Ã™â€žÃ™Â Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å </h3>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">Ã˜Â§Ã™â€žÃ˜Â§Ã˜Â³Ã™â€¦ Ã˜Â§Ã™â€žÃ™Æ’Ã˜Â§Ã™â€¦Ã™â€ž</label>
              <input type="text" value={editProfileName} onChange={e => setEditProfileName(e.target.value)} className="glass-input text-sm" dir="rtl" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">Ã˜Â§Ã™â€žÃ™Ë†Ã˜ÂµÃ™Â / Ã˜Â§Ã™â€žÃ˜Â¨Ã˜Â§Ã™Å Ã™Ë†</label>
              <textarea value={editProfileBio} onChange={e => setEditProfileBio(e.target.value)} rows={3} maxLength={500} className="glass-input text-sm" dir="rtl" />
            </div>
            {error && <div className="p-3 bg-red-500/10 border border-red-500/40 text-red-300 rounded text-sm">{error}</div>}
            <div className="flex flex-wrap gap-2 justify-end">
              <button onClick={() => { setShowProfileModal(false); setError(''); }} disabled={loading} className="btn-base btn-secondary">Ã˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¡</button>
              <button onClick={handleEditProfile} disabled={loading} className="btn-base btn-primary">{loading ? <><MorphingSquare size="sm" /> Ã˜Â¬Ã˜Â§Ã˜Â±Ã™Â Ã˜Â§Ã™â€žÃ˜Â­Ã™ÂÃ˜Â¸...</> : <><Save className="w-4 h-4" /> Ã˜Â­Ã™ÂÃ˜Â¸</>}</button>
            </div>
          </div>
        </div>
      )}

      {showPasswordModal && selectedTeacher && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="glass-modal w-[calc(100vw-2rem)] max-w-md text-white space-y-4 animate-modalUp focus:outline-none">
            <h3 className="text-base sm:text-lg font-semibold text-white flex items-center gap-2"><KeyRound className="w-5 h-5 shrink-0" /> Ã˜ÂªÃ˜ÂºÃ™Å Ã™Å Ã˜Â± Ã™Æ’Ã™â€žÃ™â€¦Ã˜Â© Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã™Ë†Ã˜Â± - {selectedTeacher.displayName}</h3>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">Ã™Æ’Ã™â€žÃ™â€¦Ã˜Â© Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã™Ë†Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â¬Ã˜Â¯Ã™Å Ã˜Â¯Ã˜Â©</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="glass-input text-sm" placeholder="6 Ã˜Â£Ã˜Â­Ã˜Â±Ã™Â Ã˜Â¹Ã™â€žÃ™â€° Ã˜Â§Ã™â€žÃ˜Â£Ã™â€šÃ™â€ž" dir="ltr" autoFocus />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">Ã™Æ’Ã™â€žÃ™â€¦Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â³Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â§Ã™â€žÃ™Å Ã˜Â© Ã™â€žÃ™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å  (Ã˜Â§Ã˜Â®Ã˜ÂªÃ™Å Ã˜Â§Ã˜Â±Ã™Å )</label>
              <input type="password" value={currentTeacherPassword} onChange={(e) => setCurrentTeacherPassword(e.target.value)} className="glass-input text-sm" placeholder="Ã˜Â§Ã˜ÂªÃ˜Â±Ã™Æ’Ã™â€¡Ã˜Â§ Ã™ÂÃ˜Â§Ã˜Â±Ã˜ÂºÃ˜Â© Ã˜Â¥Ã™â€  Ã™â€žÃ™â€¦ Ã˜ÂªÃ™Æ’Ã™â€  Ã™â€¦Ã˜Â¹Ã˜Â±Ã™Ë†Ã™ÂÃ˜Â©" dir="ltr" />
              <p className="text-xs text-slate-400">Ã˜ÂªÃ™ÂÃ˜Â·Ã™â€žÃ˜Â¨ Ã™ÂÃ™â€šÃ˜Â· Ã˜Â¥Ã˜Â°Ã˜Â§ Ã˜ÂªÃ˜ÂºÃ™Å Ã™â€˜Ã˜Â±Ã˜Âª Ã™Æ’Ã™â€žÃ™â€¦Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â³Ã˜Â± Ã™â€¦Ã™â€  Firebase Ã™Ë†Ã™â€žÃ™â€¦ Ã™Å Ã˜Â¯Ã˜Â®Ã™â€ž Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å  Ã˜Â¨Ã˜Â¹Ã˜Â¯.</p>
            </div>
            {error && <div className="p-3 bg-red-500/10 border border-red-500/40 text-red-300 rounded text-sm">{error}</div>}
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-3 text-sm text-yellow-300 flex items-start gap-2"><TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" /> Ã˜ÂªÃ˜Â£Ã™Æ’Ã˜Â¯ Ã™â€¦Ã™â€  Ã˜Â­Ã™ÂÃ˜Â¸ Ã™Æ’Ã™â€žÃ™â€¦Ã˜Â© Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã™Ë†Ã˜Â± Ã™Ë†Ã˜Â¥Ã˜Â¨Ã™â€žÃ˜Â§Ã˜ÂºÃ™â€¡Ã˜Â§ Ã™â€žÃ™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <button onClick={() => { setShowPasswordModal(false); setNewPassword(''); setCurrentTeacherPassword(''); setError(''); }} disabled={loading} className="btn-base btn-secondary">Ã˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¡</button>
              <button onClick={handleChangePassword} disabled={loading} className="btn-base btn-primary">{loading ? 'Ã˜Â¬Ã˜Â§Ã˜Â±Ã™Â Ã˜Â§Ã™â€žÃ˜ÂªÃ˜ÂºÃ™Å Ã™Å Ã˜Â±...' : 'Ã˜ÂªÃ˜ÂºÃ™Å Ã™Å Ã˜Â±'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg text-sm text-blue-300 space-y-2">
        <p className="flex items-start gap-2"><Lightbulb className="w-4 h-4 shrink-0 mt-0.5" /> <strong>Ã™Æ’Ã™Å Ã™Â Ã˜ÂªÃ˜Â¹Ã™â€¦Ã™â€ž Ã˜Â§Ã™â€žÃ˜ÂµÃ™â€žÃ˜Â§Ã˜Â­Ã™Å Ã˜Â§Ã˜Âª:</strong> Ã™â€žÃ™â€¦Ã˜Â§ Ã˜ÂªÃ˜Â­Ã˜Â¯Ã˜Â¯ Ã™â€¦Ã˜Â±Ã˜Â§Ã˜Â­Ã™â€ž Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å Ã˜Å’ Ã˜Â±Ã˜Â§Ã˜Â­ Ã™Å Ã˜Â´Ã™Ë†Ã™Â Ã™ÂÃ™â€šÃ˜Â· Ã™â€¡Ã˜Â°Ã™Å  Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã˜Â§Ã˜Â­Ã™â€ž Ã™Ë†Ã˜Â·Ã™â€žÃ˜Â§Ã˜Â¨Ã™â€¡Ã˜Â§. Ã™â€¦Ã˜Â§ Ã™Å Ã™â€šÃ˜Â¯Ã˜Â± Ã™Å Ã˜Â¶Ã™Å Ã™Â Ã˜Â£Ã™Ë† Ã™Å Ã˜Â­Ã˜Â°Ã™Â Ã˜Â§Ã™â€žÃ˜Â·Ã™â€žÃ˜Â§Ã˜Â¨ - Ã™ÂÃ™â€šÃ˜Â· Ã™Å Ã˜Â³Ã˜Â¬Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±.</p>

        <p className="flex items-start gap-2"><UserCheck className="w-4 h-4 shrink-0 mt-0.5" /> Ã˜Â¥Ã˜Â°Ã˜Â§ Ã˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â³Ã™Å  Ã˜Â¸Ã™â€¡Ã˜Â± Ã˜Â¨Ã˜Â­Ã˜Â§Ã™â€žÃ˜Â© "Ã™â€¦Ã˜Â¹Ã˜Â·Ã™â€˜Ã™â€ž" Ã˜Â¨Ã˜Â¹Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜ÂµÃ™ÂÃ™Å Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â³Ã™â€ Ã™Ë†Ã™Å Ã˜Å’ Ã˜Â§Ã˜Â¶Ã˜ÂºÃ˜Â· <strong>"Ã˜Â¥Ã˜Â¹Ã˜Â§Ã˜Â¯Ã˜Â© Ã˜ÂªÃ™ÂÃ˜Â¹Ã™Å Ã™â€ž"</strong> Ã˜Â«Ã™â€¦ Ã˜Â­Ã˜Â¯Ã˜Â¯ Ã™â€žÃ™â€¡ Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã˜Â§Ã˜Â­Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â¬Ã˜Â¯Ã™Å Ã˜Â¯Ã˜Â©.</p>
      </div>

      {ConfirmDialogEl}
    </div>
  );
});
