import { TelegramConfig, SendQueueItem } from '../types/telegram';

const TELEGRAM_API = 'https://api.telegram.org/bot';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function getArabicDayName(dateStr: string): string {
  const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const date = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'));
  return days[date.getDay()];
}

export function formatDisplayDate(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return dateStr;
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  parseMode: 'HTML' | 'MarkdownV2' = 'HTML'
): Promise<boolean> {
  try {
    const url = `${TELEGRAM_API}${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.warn('⚠️ Telegram error:', data.description);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('⚠️ Telegram send failed:', e);
    return false;
  }
}

export function buildAttendanceMessage(
  studentName: string,
  stageName: string,
  date: string,
  time: string,
  method: string,
  subjectName?: string,
  teacherName?: string
): string {
  const methodEmoji = method === 'qr' ? '🔳' : method === 'face' ? '📸' : '⌨️';
  const subject = subjectName || stageName;
  return (
    `✅ <b>تسجيل حضور</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `📚 <b>المادة:</b> ${escapeHtml(subject)}\n` +
    (teacherName ? `👨‍🏫 <b>الدكتور:</b> ${escapeHtml(teacherName)}\n` : '') +
    `👤 <b>الطالب:</b> ${escapeHtml(studentName)}\n` +
    `📅 <b>التاريخ:</b> ${escapeHtml(date)}\n` +
    `⏰ <b>الوقت:</b> ${escapeHtml(time)}\n` +
    `${methodEmoji} <b>طريقة التسجيل:</b> ${method === 'qr' ? 'QR' : method === 'face' ? 'بصمة وجه' : 'يدوي'}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🟢 <b>حاضر</b>`
  );
}

export function buildAbsenceAlertMessage(
  studentName: string,
  stageName: string,
  date: string,
  absenceCount: number,
  subjectName?: string,
  teacherName?: string
): string {
  const emoji = absenceCount >= 3 ? '🚨' : absenceCount >= 2 ? '⚠️' : '📌';
  const subject = subjectName || stageName;
  return (
    `${emoji} <b>تنبيه غياب</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `📚 <b>المادة:</b> ${escapeHtml(subject)}\n` +
    (teacherName ? `👨‍🏫 <b>الدكتور:</b> ${escapeHtml(teacherName)}\n` : '') +
    `👤 <b>الطالب:</b> ${escapeHtml(studentName)}\n` +
    `📅 <b>التاريخ:</b> ${escapeHtml(date)}\n` +
    `🔴 <b>عدد الغيابات:</b> ${absenceCount}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `${absenceCount >= 3 ? '🚨 إنذار: تجاوز حد الغياب المسموح' : absenceCount >= 2 ? '⚠️ غياب متكرر يرجى الانتباه' : '📌 تم تسجيل الغياب'}`
  );
}

export function buildDailyReportMessage(
  stageName: string,
  date: string,
  totalStudents: number,
  presentCount: number,
  absentCount: number,
  presentPercent: number,
  absentStudents: string[],
  subjectName?: string,
  teacherName?: string
): string {
  const subject = subjectName || stageName;
  return (
    `📊 <b>التقرير اليومي</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `📚 <b>المادة:</b> ${escapeHtml(subject)}\n` +
    (teacherName ? `👨‍🏫 <b>الدكتور:</b> ${escapeHtml(teacherName)}\n` : '') +
    `📅 <b>التاريخ:</b> ${escapeHtml(date)}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `👥 <b>إجمالي الطلاب:</b> ${totalStudents}\n` +
    `🟢 <b>الحاضرون:</b> ${presentCount}\n` +
    `🔴 <b>الغائبون:</b> ${absentCount}\n` +
    `📈 <b>نسبة الحضور:</b> ${presentPercent}%\n` +
    `━━━━━━━━━━━━━━━\n` +
    (absentStudents.length > 0
      ? `❌ <b>الغائبون:</b>\n${escapeHtml(absentStudents.map(n => `• ${n}`).join('\n'))}`
      : `🎉 <b>غياب صفري! لا يوجد غائبون</b>`) +
    `\n━━━━━━━━━━━━━━━\n` +
    `✅ <i>تقرير تلقائي من نظام الحضور</i>`
  );
}

export function buildTestMessage(stageName: string): string {
  return (
    `✅ <b>تم ربط القناة بنجاح!</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `📚 <b>المادة:</b> ${escapeHtml(stageName)}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🟢 <b>سيتم إرسال إشعارات الحضور والغياب إلى هذه القناة تلقائياً</b>`
  );
}

export async function sendAttendanceNotification(
  config: TelegramConfig,
  stageId: string,
  studentName: string,
  date: string,
  time: string,
  method: string,
  subjectName?: string,
  teacherName?: string
): Promise<boolean> {
  const channel = config.channels[stageId];
  if (!channel || !channel.enabled || !channel.notifyOnAttendance) return false;

  const message = buildAttendanceMessage(
    studentName,
    channel.stageName,
    date,
    time,
    method,
    subjectName,
    teacherName
  );

  return sendTelegramMessage(config.botToken, channel.chatId, message);
}

export async function sendAbsenceNotification(
  config: TelegramConfig,
  stageId: string,
  studentName: string,
  date: string,
  absenceCount: number,
  subjectName?: string,
  teacherName?: string
): Promise<boolean> {
  const channel = config.channels[stageId];
  if (!channel || !channel.enabled || !channel.notifyOnAbsence) return false;

  const message = buildAbsenceAlertMessage(
    studentName,
    channel.stageName,
    date,
    absenceCount,
    subjectName,
    teacherName
  );

  return sendTelegramMessage(config.botToken, channel.chatId, message);
}

export async function sendDailyReport(
  config: TelegramConfig,
  stageId: string,
  stats: {
    date: string;
    totalStudents: number;
    presentCount: number;
    absentCount: number;
    absentStudents: string[];
  }
): Promise<boolean> {
  const channel = config.channels[stageId];
  if (!channel || !channel.enabled || !channel.sendDailyReport) return false;

  const percent = stats.totalStudents > 0
    ? Math.round((stats.presentCount / stats.totalStudents) * 100)
    : 0;

  const message = buildDailyReportMessage(
    channel.stageName,
    stats.date,
    stats.totalStudents,
    stats.presentCount,
    stats.absentCount,
    percent,
    stats.absentStudents
  );

  return sendTelegramMessage(config.botToken, channel.chatId, message);
}

export function buildAbsenceGroupReport(
  subjectName: string,
  groupName: string,
  date: string,
  absentStudents: Array<{ name: string; count: number }>
): string {
  const dayName = getArabicDayName(date);
  const displayDate = formatDisplayDate(date);

  const lines = absentStudents.map(
    (s, i) => `${i + 1}. ${escapeHtml(s.name)} - ${s.count} ❌ <b>غايب</b>`
  );

  return (
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `❌ <b>غيابات يوم ${escapeHtml(dayName)}</b>\n` +
    `📅 المصادف ${escapeHtml(displayDate)}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📚 <b>المادة:</b> ${escapeHtml(subjectName)}\n` +
    (groupName ? `👥 <b>الكروب:</b> ${escapeHtml(groupName)}\n` : '') +
    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    lines.join('\n') + '\n\n' +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🔢 <b>مجموع الغائبين اليوم:</b> ${absentStudents.length}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━`
  );
}

export async function sendAbsenceGroupReport(
  config: TelegramConfig,
  stageId: string,
  subjectName: string,
  groupName: string,
  date: string,
  absentStudents: Array<{ name: string; count: number }>
): Promise<boolean> {
  const channel = config.channels[stageId];
  if (!channel || !channel.enabled || !channel.notifyOnAbsence) return false;

  const message = buildAbsenceGroupReport(subjectName, groupName, date, absentStudents);
  return sendTelegramMessage(config.botToken, channel.chatId, message);
}

export async function sendTestMessage(
  config: TelegramConfig,
  stageId: string
): Promise<boolean> {
  const channel = config.channels[stageId];
  if (!channel) return false;

  const message = buildTestMessage(channel.stageName);
  return sendTelegramMessage(config.botToken, channel.chatId, message);
}

export function buildRegistrationLinksMessage(
  links: Array<{ studentName: string; studentCode: string; url: string }>,
  stageName: string,
  expiryDays: number
): string {
  const header = `📨 <b>روابط تسجيل جديدة</b>\n━━━━━━━━━━━━━━━\n📚 <b>المرحلة:</b> ${escapeHtml(stageName)}\n📅 <b>تاريخ الإنشاء:</b> ${new Date().toLocaleDateString('ar-IQ')}\n⏳ <b>تنتهي بعد:</b> ${expiryDays} يوم\n━━━━━━━━━━━━━━━\n\n`;

  const linkLines = links.map((l, i) => {
    return `${i + 1}. <b>${escapeHtml(l.studentName)}</b> (${escapeHtml(l.studentCode)})\n<code>${l.url}</code>`;
  });

  const footer = `\n━━━━━━━━━━━━━━━\n✅ أرسل كل طالب رابطه الخاص لتسجيل بصمة الوجه ورمز QR`;

  return header + linkLines.join('\n\n') + footer;
}

export async function sendRegistrationLinksToTelegram(
  config: TelegramConfig,
  stageId: string,
  links: Array<{ studentName: string; studentCode: string; url: string }>,
  stageName: string,
  expiryDays: number
): Promise<{ success: boolean; count: number; error?: string }> {
  const channel = config.channels[stageId];
  if (!channel || !channel.chatId) {
    return { success: false, count: 0, error: 'لم يتم ربط تيليغرام بهذه المرحلة' };
  }

  const message = buildRegistrationLinksMessage(links, stageName, expiryDays);
  const ok = await sendTelegramMessage(config.botToken, channel.chatId, message);

  if (!ok) {
    return { success: false, count: 0, error: 'فشل إرسال الرسالة إلى تيليغرام' };
  }

  return { success: true, count: links.length };
}

export async function verifyBotToken(botToken: string): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    const res = await fetch(`${TELEGRAM_API}${botToken}/getMe`);
    const data = await res.json();
    if (data.ok) {
      return { ok: true, username: data.result.username };
    }
    return { ok: false, error: data.description };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export function buildQueueFromGroups(
  config: TelegramConfig,
  stageId: string,
  subjectName: string,
  date: string,
  groups: Array<{
    groupName: string;
    absentStudents: Array<{ name: string; count: number }>;
  }>
): SendQueueItem[] {
  const stageChannels = config.channels[stageId];
  if (!stageChannels || !stageChannels.enabled || !stageChannels.notifyOnAbsence) return [];

  const queue: SendQueueItem[] = [];
  for (const group of groups) {
    if (group.absentStudents.length === 0) continue;
    const message = buildAbsenceGroupReport(subjectName, group.groupName, date, group.absentStudents);
    queue.push({
      id: `${Date.now()}_${group.groupName}`,
      chatId: stageChannels.chatId,
      channelLabel: stageChannels.stageName,
      groupName: group.groupName,
      message,
      status: 'pending',
    });
  }

  return queue;
}

export async function sendQueuedMessages(
  items: SendQueueItem[],
  botToken: string,
  onProgress: (items: SendQueueItem[]) => void,
  signal?: AbortSignal
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) break;

    items[i].status = 'sending';
    onProgress([...items]);

    const ok = await sendTelegramMessage(botToken, items[i].chatId, items[i].message);

    items[i].status = ok ? 'sent' : 'failed';
    onProgress([...items]);

    if (i < items.length - 1 && !signal?.aborted) {
      await sleep(3000);
    }
  }
}
