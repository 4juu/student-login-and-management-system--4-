import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Send, Trash2, X } from 'lucide-react';
import { AdminNotification, isNotificationRead } from '../types/notification';
import {
  subscribeNotifications, sendNotification, markNotificationRead, deleteNotification, deleteAllNotifications,
} from '../services/notificationService';
import { User } from '../types/user';

interface NotificationsProps {
  currentUser: User | null;
}

export const Notifications: React.FC<NotificationsProps> = ({ currentUser }) => {
  const [items, setItems] = useState<AdminNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  const uid = currentUser?.uid || '';
  const isMainAdmin = currentUser?.role === 'admin';
  const mainAdminCanSend = isMainAdmin;

  useEffect(() => {
    if (!uid) return;
    const unsub = subscribeNotifications(
      (list) => setItems(list),
      () => setError('فشل تحميل الإشعارات')
    );
    return unsub;
  }, [uid]);

  const unreadCount = useMemo(
    () => items.filter(n => !isNotificationRead(n, uid)).length,
    [items, uid]
  );

  const formatTime = (ts: number) => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString('ar-IQ', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const handleOpen = useCallback(async (n: AdminNotification) => {
    if (!isNotificationRead(n, uid)) {
      await markNotificationRead(n.id, uid).catch(() => {});
    }
  }, [uid]);

  const handleSend = async () => {
    if (!title.trim() || !body.trim() || !currentUser) return;
    setSending(true);
    setError('');
    try {
      await sendNotification({ title: title.trim(), body: body.trim(), senderUid: currentUser.uid, senderName: currentUser.displayName });
      setTitle(''); setBody(''); setComposeOpen(false);
    } catch {
      setError('فشل إرسال الرسالة');
    } finally {
      setSending(false);
    }
  };

  const handleStartCompose = () => {
    setComposeOpen(true);
    setError('');
  };

  // Body scroll lock while panel open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setComposeOpen(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {/* 🔔 Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="relative shrink-0 w-11 h-11 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 flex items-center justify-center transition active:scale-90"
        aria-label="الإشعارات"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span
            className="absolute bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-[20px] px-1 flex items-center justify-center shadow-lg"
            style={{ top: '-6px', left: '-6px', animation: 'pulse-badge 1.8s ease-in-out infinite' }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* 📬 Panel */}
      {open && createPortal(
        <div className="fixed inset-0 z-[9010] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { setOpen(false); setComposeOpen(false); }} />
          <div
            ref={panelRef}
            dir="rtl"
            className="relative w-full sm:max-w-md max-h-[88dvh] bg-slate-900 border border-white/10 rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-modalUp"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <span className="text-xl">📬</span>
                <h3 className="font-extrabold text-white">إشعارات الإدارة</h3>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-300 text-[10px] font-bold">{unreadCount} غير مقروءة</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {mainAdminCanSend && (
                  <button onClick={handleStartCompose} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition active:scale-95">
                    <Send className="w-3.5 h-3.5" /> إرسال
                  </button>
                )}
                {items.length > 0 && mainAdminCanSend && (
                  <button
                    onClick={() => { if (confirm('حذف كل الرسائل؟')) deleteAllNotifications(); }}
                    className="bg-white/5 hover:bg-red-500/15 text-slate-300 hover:text-red-300 p-2 rounded-lg transition active:scale-90"
                    title="حذف الكل"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => { setOpen(false); setComposeOpen(false); }} className="bg-white/5 hover:bg-white/15 text-slate-300 p-2 rounded-lg transition active:scale-90">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Compose form (admin) */}
            {composeOpen && mainAdminCanSend && (
              <div className="px-5 py-4 border-b border-white/10 bg-blue-950/20 space-y-2.5">
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="عنوان الرسالة"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-white/15 text-white placeholder:text-slate-500 focus:border-blue-500 outline-none text-sm"
                />
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  placeholder="نص الرسالة..."
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-white/15 text-white placeholder:text-slate-500 focus:border-blue-500 outline-none text-sm resize-none"
                />
                {error && <p className="text-red-400 text-xs font-bold">{error}</p>}
                <div className="flex items-center justify-end gap-2">
                  <button onClick={() => setComposeOpen(false)} className="text-slate-400 text-xs font-bold px-3 py-2 hover:text-white">إلغاء</button>
                  <button
                    onClick={handleSend}
                    disabled={sending || !title.trim() || !body.trim()}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1 transition active:scale-95"
                  >
                    {sending ? 'جاري الإرسال...' : 'إرسال الآن'}
                  </button>
                </div>
              </div>
            )}

            {/* List */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-2.5" style={{ WebkitOverflowScrolling: 'touch' }}>
              {items.length === 0 && (
                <div className="text-center py-12 text-slate-500">
                  <div className="text-4xl mb-2">🔕</div>
                  <p className="text-sm font-bold">لا توجد إشعارات</p>
                </div>
              )}

              {items.map(n => {
                const read = isNotificationRead(n, uid);
                return (
                  <button
                    key={n.id}
                    onClick={() => handleOpen(n)}
                    className={`w-full text-right block p-3.5 rounded-2xl border transition-all duration-200 active:scale-[0.99] ${
                      read
                        ? 'bg-white/5 border-white/10'
                        : 'bg-red-500/10 border-red-500/40'
                    }`}
                    style={!read ? { animation: 'pulse-badge 2s ease-in-out infinite' } : undefined}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0 ${read ? 'bg-white/10' : 'bg-red-500/20'}`}>
                        {read ? '📩' : '🆕'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className={`font-extrabold text-sm truncate ${read ? 'text-slate-200' : 'text-white'}`}>{n.title}</p>
                          <span className="text-[10px] text-slate-500 shrink-0 whitespace-nowrap">{formatTime(n.createdAt)}</span>
                        </div>
                        <p className={`text-xs mt-1 leading-relaxed break-words ${read ? 'text-slate-400' : 'text-slate-200'}`}>{n.body}</p>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-[10px] text-slate-500">من: {n.senderName || 'الإدارة'}</span>
                          {mainAdminCanSend && (
                            <span
                              onClick={async (e) => { e.stopPropagation(); await deleteNotification(n.id); }}
                              className="inline-flex items-center gap-1 text-[10px] text-red-400/80 hover:text-red-300"
                            >
                              <Trash2 className="w-3 h-3" /> حذف
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default Notifications;