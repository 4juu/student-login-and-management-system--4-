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

      try {
        const config = await loadTelegramConfig(adminUid);
        setTelegramConfig(config);
      } catch (e) {
        console.warn('فشل تحميل تهيئة التلغرام:', e);
      }

      if (user.role === 'admin') {
        try {
          const usersSnap = await get(dbRef(database, 'users'));
          if (usersSnap.exists()) {
            const teachersList = (Object.values(usersSnap.val()) as User[]).filter(
              (u) => u.role === 'teacher' && u.adminId === user.uid
            );
            setAllTeachers(teachersList);
          }
        } catch (e) {
          console.warn('فشل تحميل قائمة التدريسيين:', e);
        }
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
      const allUserIds = [adminUid, ...allTeachers.map((t) => t.uid)];
      const stagesDataMap: AllStagesData = {};
      const yearPath = `academicYears/${currentAcademicYear}/userData/${adminUid}`;

      await Promise.all(
        stages.map(async (stage) => {
          try {
            const studentsSnap = await get(
              dbRef(database, `${yearPath}/stageData/${stage.id}/students`)
            );
            let stageStudents: Student[] = [];
            if (studentsSnap.exists()) {
              const data = studentsSnap.val();
              stageStudents = Array.isArray(data) ? data : Object.values(data);
            }

            const allRecords: AttendanceRecord[] = [];
            const allSessions: AttendanceSession[] = [];

            await Promise.all(
              allUserIds.map(async (userId) => {
                try {
                  const recSnap = await get(
                    dbRef(database, `${yearPath}/stageData/${stage.id}/teacherRecords/${userId}/records`)
                  );
                  if (recSnap.exists()) {
                    const data = recSnap.val();
                    allRecords.push(...(Array.isArray(data) ? data : Object.values(data)));
                  }
                  const sesSnap = await get(
                    dbRef(database, `${yearPath}/stageData/${stage.id}/teacherRecords/${userId}/sessions`)
                  );
                  if (sesSnap.exists()) {
                    const data = sesSnap.val();
                    allSessions.push(...(Array.isArray(data) ? data : Object.values(data)));
                  }
                } catch {
                  console.warn(`فشل جلب بيانات المستخدم ${userId}`);
                }
              })
            );

            stagesDataMap[stage.id] = {
              students: stageStudents,
              records: allRecords,
              sessions: allSessions,
            };
          } catch {
            console.warn(`فشل تحميل بيانات المرحلة ${stage.id}`);
          }
        })
      );

      setAllStagesData(stagesDataMap);
      setUniversityDataLoaded(true);
    } catch (error) {
      console.error('❌ خطأ في تحميل بيانات الأدمن الشاملة:', error);
      alert('❌ فشل تحميل بيانات الجامعة. حاول مرة ثانية.');
    } finally {
      setUniversityDataLoading(false);
    }
  }, [currentUser, allTeachers, stages]);

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
