// Telegram bot configuration (year-scoped)

import { ref, set, get } from "firebase/database";
import { database } from "./config";
import { TelegramConfig } from "../types/telegram";
import { getActiveAcademicYear } from "./academicYear";
import { getYearBasePath } from "./paths";
import { saveLocal, loadLocal } from "./localCache";

export const saveTelegramConfig = async (
  adminUid: string,
  config: TelegramConfig
): Promise<void> => {
  const year = await getActiveAcademicYear();
  const path = `${getYearBasePath(year, adminUid)}/telegramConfig`;
  await set(ref(database, path), config);
  saveLocal(`telegramConfig_${adminUid}`, config);
};

export const loadTelegramConfig = async (
  adminUid: string
): Promise<TelegramConfig | null> => {
  const year = await getActiveAcademicYear();
  const path = `${getYearBasePath(year, adminUid)}/telegramConfig`;
  try {
    const snap = await get(ref(database, path));
    if (snap.exists()) {
      const config = snap.val() as TelegramConfig;
      saveLocal(`telegramConfig_${adminUid}`, config);
      return config;
    }
  } catch (e) {
    console.warn('⚠️ فشل تحميل تهيئة التلغرام:', e);
  }
  return loadLocal<TelegramConfig | null>(`telegramConfig_${adminUid}`, null);
};
