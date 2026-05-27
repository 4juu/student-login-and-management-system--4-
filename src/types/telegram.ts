export interface TelegramConfig {
  botToken: string;
  channels: {
    [stageId: string]: {
      chatId: string;
      stageName: string;
      enabled: boolean;
      notifyOnAttendance: boolean;
      notifyOnAbsence: boolean;
      sendDailyReport: boolean;
    };
  };
  updatedAt: string;
}
