import { useState, useCallback } from 'react';
import { ref as dbRef, get } from 'firebase/database';
import { database } from '../firebase/config';
import {
  loadColleges,
  loadStages,
  loadTelegramConfig,
  getCurrentAcademicYear,
} from '../firebase/dataService';
import { Student, AttendanceRecord, AttendanceSession, College, Stage } from '../types/student';
import { User } from '../types/user';
import { TelegramConfig } from '../types/telegram';
import { useStageStore } from '../store/useStageStore';

interface AllStagesData {
  [stageId: string]: {
    students: Student[];
    records: AttendanceRecord[];
    sessions: AttendanceSession[];
  };
}

interface UseInitialDataParams {
  currentUser: User | null;
}

interface UseInitialDataReturn {
  allTeachers: User[];
  allStagesData: AllStagesData;
  universityDataLoading: boolean;
  universityDataLoaded: boolean;
  telegramConfig: TelegramConfig | null;
  colleges: College[];
  stages: Stage[];
  loadInitialData: (user: User) => Promise<void>;
  loadAllAdminData: () => Promise<void>;
  setColleges: React.Dispatch<React.SetStateAction<College[]>>;
  setStages: React.Dispatch<React.SetStateAction<Stage[]>>;
  setTelegramConfig: React.Dispatch<React.SetStateAction<TelegramConfig | null>>;
  setAllStagesData: React.Dispatch<React.SetStateAction<AllStagesData>>;
}

const currentAcademicYear = getCurrentAcademicYear();

export default function useInitialData({ currentUser }: UseInitialDataParams): UseInitialDataReturn {
  const [allTeachers, setAllTeachers] = useState<User[]>([]);
  const [allStagesData, setAllStagesData] = useState<AllStagesData>({});
  const [universityDataLoading, setUniversityDataLoading] = useState(false);
  const [universityDataLoaded, setUniversityDataLoaded] = useState(false);

  const colleges = useStageStore((s) => s.colleges);
  const stages = useStageStore((s) => s.stages);
  const setColleges = useStageStore((s) => s.setColleges);
  const setStages = useStageStore((s) => s.setStages);
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig | null>(null);

  const loadInitialData = useCallback(async (user: User) => {
    try {
      const adminUid = user.role === 'admin' ? user.uid : (user.adminId || user.uid);
      const [collegesData, stagesData] = await Promise.all([
        loadColleges(adminUid),
        loadStages(adminUid),
      ]);

      setColleges(collegesData);
      setStages(stagesData);

      // ما بعد هذه النقطة لا يحكم ظهور الشاشة الرئيسية — يُحمَّل في الخلفية
      void loadTelegramConfig(adminUid)
        .then(config => setTelegramConfig(config))
        .catch(e => console.warn('فشل تحميل تهيئة التلغرام:', e));

      if (user.role === 'admin') {
        void get(dbRef(database, 'users'))
          .then(usersSnap => {
            if (usersSnap.exists()) {
              const teachersList = (Object.values(usersSnap.val()) as User[]).filter(
                (u) => u.role === 'teacher' && u.adminId === user.uid
              );
              setAllTeachers(teachersList);
            }
          })
          .catch(e => console.warn('فشل تحميل قائمة التدريسيين:', e));
      }
    } catch (error) {
      console.error('Error loading initial data:', error);
    }
  }, []);

  const loadAllAdminData = useCallback(async () => {
    if (!currentUser || currentUser.role !== 'admin') return;
    setUniversityDataLoading(true);
    try {
      const adminUid = currentUser.uid;
      const stagesDataMap: AllStagesData = {};
      const yearPath = `academicYears/${currentAcademicYear}/userData/${adminUid}`;

      // طلب واحد على كل stageData بدل S + 2·S·U طلبات منفصلة
      const stageDataSnap = await get(dbRef(database, `${yearPath}/stageData`));
      const stageData = stageDataSnap.exists() ? (stageDataSnap.val() as Record<string, any>) : {};
      const { decompressRecord } = await import('../firebase/dataServiceCompressed');

      for (const stage of stages) {
        try {
          const sd = stageData[stage.id];
          let stageStudents: Student[] = [];
          const allRecords: AttendanceRecord[] = [];
          const allSessions: AttendanceSession[] = [];

          if (sd) {
            if (sd.students) {
              stageStudents = Array.isArray(sd.students) ? sd.students : Object.values(sd.students);
              // دمج faceDescriptor من العقدة المنفصلة descriptors/ (إن وُجدت)
              const descriptors = sd.descriptors as Record<string, unknown> | undefined;
              if (descriptors && typeof descriptors === 'object') {
                stageStudents = stageStudents.map(s =>
                  s && s.id && descriptors[s.id] !== undefined && descriptors[s.id] !== null
                    ? { ...s, faceDescriptor: descriptors[s.id] }
                    : s
                );
              }
            }
            const teacherRecords = sd.teacherRecords || {};
            for (const teacher of Object.values(teacherRecords) as any[]) {
              if (!teacher) continue;
              if (teacher.records) {
                const arr = Array.isArray(teacher.records) ? teacher.records : Object.values(teacher.records);
                allRecords.push(...(arr as AttendanceRecord[]));
              }
              if (teacher.recordsCompressed) {
                const arr = Array.isArray(teacher.recordsCompressed)
                  ? teacher.recordsCompressed
                  : Object.values(teacher.recordsCompressed);
                for (const c of arr as any[]) {
                  try {
                    allRecords.push(decompressRecord(c));
                  } catch {
                    /* سجل تالف — نتجاهله */
                  }
                }
              }
              if (teacher.sessions) {
                const arr = Array.isArray(teacher.sessions) ? teacher.sessions : Object.values(teacher.sessions);
                allSessions.push(...(arr as AttendanceSession[]));
              }
            }
          }

          stagesDataMap[stage.id] = {
            students: stageStudents,
            records: allRecords,
            sessions: allSessions,
          };
        } catch {
          console.warn(`فشل تحميل بيانات المرحلة ${stage.id}`);
        }
      }

      setAllStagesData(stagesDataMap);
      setUniversityDataLoaded(true);
    } catch (error) {
      console.error('❌ خطأ في تحميل بيانات الأدمن الشاملة:', error);
      alert('❌ فشل تحميل بيانات الجامعة. حاول مرة ثانية.');
    } finally {
      setUniversityDataLoading(false);
    }
  }, [currentUser, stages]);

  return {
    allTeachers,
    allStagesData,
    universityDataLoading,
    universityDataLoaded,
    telegramConfig,
    colleges,
    stages,
    loadInitialData,
    loadAllAdminData,
    setColleges,
    setStages,
    setTelegramConfig,
    setAllStagesData,
  };
}
