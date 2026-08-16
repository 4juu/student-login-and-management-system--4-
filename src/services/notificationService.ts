import { ref, set, get, update, onValue, off, remove, push } from "firebase/database";
import { database } from "../firebase/config";
import { AdminNotification, isNotificationRead } from "../types/notification";

const messagesRef = () => ref(database, "notifications/messages");

// ── Subscription ──
export const subscribeNotifications = (
  cb: (items: AdminNotification[]) => void,
  onError?: (e: Error) => void
): (() => void) => {
  const r = messagesRef();
  const handler = (snap: any) => {
    const val = snap.val();
    if (!val) { cb([]); return; }
    const items: AdminNotification[] = Object.keys(val).map(k => ({ ...val[k], id: k }));
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    cb(items);
  };
  onValue(r, handler, (err: any) => onError?.(err));
  return () => off(r, "value", handler);
};

// ── Send (main admin only) ──
// إشعار واحد (body) يُبثّ لكل التدريسيين — ليس رسالة موجّهة
export const sendNotification = async (input: { content: string; senderUid: string; senderName: string }): Promise<void> => {
  const r = push(messagesRef());
  const now = Date.now();
  await set(r, {
    body: input.content,
    senderUid: input.senderUid,
    senderName: input.senderName,
    createdAt: now,
    readBy: {},
  });
};

// ── Mark as read ──
export const markNotificationRead = async (id: string, uid: string): Promise<void> => {
  const now = Date.now();
  await update(ref(database, `notifications/messages/${id}/readBy`), {
    [uid]: now,
  });
};

// ── Delete (admin only) ──
export const deleteNotification = async (id: string): Promise<void> => {
  await remove(ref(database, `notifications/messages/${id}`));
};

// ── Delete all (admin only) ──
export const deleteAllNotifications = async (): Promise<void> => {
  const snap = await get(messagesRef());
  if (!snap.exists()) return;
  const val = snap.val();
  await Promise.all(Object.keys(val).map(id => remove(ref(database, `notifications/messages/${id}`))));
};

// ── Count unread for debug ──
export const notificationUnreadCount = (items: AdminNotification[], uid: string): number =>
  items.filter(n => !isNotificationRead(n, uid)).length;