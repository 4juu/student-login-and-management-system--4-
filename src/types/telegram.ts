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

export interface SendQueueItem {
  id: string;
  chatId: string;
  channelLabel: string;
  groupName: string;
  message: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
}

export interface GroupSendProgress {
  groupName: string;
  channels: {
    channelLabel: string;
    status: 'pending' | 'sending' | 'sent' | 'failed';
  }[];
  allDone: boolean;
}

export interface AbsenceSendLogEntry {
  id: string;
  sessionId: string;
  date: string;
  time: string;
  subjectName: string;
  groups: string[];
  studentCount: number;
  channelsSent: number;
  totalChannels: number;
  completedAt: string;
}
