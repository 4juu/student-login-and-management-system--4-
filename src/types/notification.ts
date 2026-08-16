export interface AdminNotification {
  id: string;
  title: string;
  body: string;
  senderUid: string;
  senderName: string;
  createdAt: number;
  readBy: Record<string, number>;
}

export const isNotificationRead = (n: AdminNotification, uid: string): boolean =>
  !!n.readBy && !!n.readBy[uid];