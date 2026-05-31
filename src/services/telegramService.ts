import { TelegramConfig } from '../types/telegram';

const TELEGRAM_API = 'https://api.telegram.org/bot';

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
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
    `📚 <b>المادة:</b> ${escapeMarkdown(subject)}\n` +
    (teacherName ? `👨‍🏫 <b>الدكتور:</b> ${escapeMarkdown(teacherName)}\n` : '') +
    `👤 <b>الطالب:</b> ${escapeMarkdown(studentName)}\n` +
    `📅 <b>التاريخ:</b> ${escapeMarkdown(date)}\n` +
    `⏰ <b>الوقت:</b> ${escapeMarkdown(time)}\n` +
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
    `📚 <b>المادة:</b> ${escapeMarkdown(subject)}\n` +
    (teacherName ? `👨‍🏫 <b>الدكتور:</b> ${escapeMarkdown(teacherName)}\n` : '') +
    `👤 <b>الطالب:</b> ${escapeMarkdown(studentName)}\n` +
    `📅 <b>التاريخ:</b> ${escapeMarkdown(date)}\n` +
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
    `📚 <b>المادة:</b> ${escapeMarkdown(subject)}\n` +
    (teacherName ? `👨‍🏫 <b>الدكتور:</b> ${escapeMarkdown(teacherName)}\n` : '') +
    `📅 <b>التاريخ:</b> ${escapeMarkdown(date)}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `👥 <b>إجمالي الطلاب:</b> ${totalStudents}\n` +
    `🟢 <b>الحاضرون:</b> ${presentCount}\n` +
    `🔴 <b>الغائبون:</b> ${absentCount}\n` +
    `📈 <b>نسبة الحضور:</b> ${presentPercent}%\n` +
    `━━━━━━━━━━━━━━━\n` +
    (absentStudents.length > 0
      ? `❌ <b>الغائبون:</b>\n${escapeMarkdown(absentStudents.map(n => `• ${n}`).join('\n'))}`
      : `🎉 <b>غياب صفري! لا يوجد غائبون</b>`) +
    `\n━━━━━━━━━━━━━━━\n` +
    `✅ <i>تقرير تلقائي من نظام الحضور</i>`
  );
}

export function buildTestMessage(stageName: string): string {
  return (
    `✅ <b>تم ربط القناة بنجاح!</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `📚 <b>المادة:</b> ${escapeMarkdown(stageName)}\n` +
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
  const header = `📨 <b>روابط تسجيل جديدة</b>\n━━━━━━━━━━━━━━━\n📚 <b>المرحلة:</b> ${escapeMarkdown(stageName)}\n📅 <b>تاريخ الإنشاء:</b> ${new Date().toLocaleDateString('ar-IQ')}\n⏳ <b>تنتهي بعد:</b> ${expiryDays} يوم\n━━━━━━━━━━━━━━━\n\n`;

  const linkLines = links.map((l, i) => {
    return `${i + 1}. <b>${escapeMarkdown(l.studentName)}</b> (${escapeMarkdown(l.studentCode)})\n<code>${l.url}</code>`;
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
