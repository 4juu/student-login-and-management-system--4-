# تقرير الفحص الشامل — فرع `سكلز`

> **التاريخ:** 2026-10-04 · **الطريقة:** مراجعة كود موسّعة (40 ملاحظة) + بوابات كاملة
> **النتائج النهائية:** `vitest 424/424` · `tsc` صفر أخطاء · `eslint` صفر أخطاء (305 تحذير `any` سابقة) · `npm run build` ناجح

---

## ✅ ما تم إصلاحه (28 ملاحظة)

### 🔴 High

| # | المشكلة | الإصلاح | الملفات |
|---|---------|---------|---------|
| 1 | تدريسي/أدمن `active:false` ينجح دخوله (تحذير فقط) | `signOut` + رسالة «حسابك معطّل» (رمز `app/blocked`) قبل كتابة `lastLogin` | `authService.ts` |
| 2 | حساب محذوف (`deletedAccounts` tombstone موجود ولا يُقرأ أبداً) يعود نشطاً عند أول دخول | قراءة الـtombstone في `signIn` + `useAuth` → خروج فوري؛ **مع تحمّل فشل القراءة** إذا لم تُرفع القواعد بعد | `authService.ts` · `useAuth.ts` |
| 3 | كتم إعادة التسجيل (`processedAttendanceRef`) لا يُمسح بعد حذف سجل/مسح الكل → إعادة تسجيل الحضور تُتجاهَل صامتاً | مسح الكتمتين في `handleDeleteRecord`/`handleClearRecords` + فلتر upsert يمنع التكرار | `useDataActions.ts` |
| 4 | `beforeunload` غير متزامن — الكتابات المعلقة لا تكتمل | تفريغ عند `visibilitychange:hidden` + `pagehide` (المتصفح يسمح بالمهلة هنا فعلاً) مع بقاء الطبقة المتزامنة القائمة | `saveQueue.ts` |
| 5 | بوت توكِن (`telegramConfig`) مقروء لأي مستخدم موثّق **لأي أدمن** (cross-tenant) | تقييد القراءة بصاحب البيانات (نفس شرط الكتابة: المالك/الأدمن/`adminId`) — الأبناء العامون (`students`…) تبقى `.read: true` كما هي | `database.rules.json` |
| 6 | «حساب محذوف يعود نشطاً» (بند مصادقة) | مُغلق بالبند 2 (tombstone يُحترم) | — |

### 🟡 Medium

| # | المشكلة | الإصلاح | الملفات |
|---|---------|---------|---------|
| 7 | فشل `loadInitialData` يُبتلع → شاشة فارغة كأنها محمَّلة | إعادة الرمي + شاشة خطأ عربية مع زر «إعادة المحاولة» (الجلسة تبقى) | `useInitialData.ts` · `App.tsx` |
| 8 | فشل تحميل المرحلة يُبتلع ثم `dataLoaded=true` | بانر `role="alert"` مع «إعادة المحاولة»/«رجوع» فوق المحتوى | `App.tsx` |
| 9 | `validateLink` يتجاهل `usedAt` — رابط «لمرة واحدة» صالح حتى الانتهاء | رفض مسبق برسالة عربية + رمز `app/used-link` يمرّ لواجهة الطالب | `tokenService.ts` · `SelfEnrollPage.tsx` |
| 10 | تصادم معرّفات `Date.now()` في نفس المللي (تطوي مفتاح RTDB) | لاحقة عشوائية في كل مولّدات المعرّفات | `SessionManager.tsx` · `AttendanceLogin.tsx` · `useAbsenceSender.ts` |
| 11 | فشل تصدير Excel صامت (نافذة معلّقة) | toast «تعذّر تصدير الملف» | `AttendanceRecords.tsx` |
| 12 | فشل حذف المرحلة `fire-and-forget` بلا إشعار (تعود بعد التحميل) | `.catch` + toast | `useDataActions.ts` |
| 13 | `.catch(() => {})` على كتابات فعلية (تعليم مقروء/إلغاء رابط) | رسائل خطأ عربية مرئية | `Notifications.tsx` · `PendingRegistrations.tsx` |
| 14 | رسالة نجاح تغيير كلمة السر تعرض **كلمة السر نصّاً 8 ثوانٍ** | الرسالة بلا كلمة السر | `TeacherManagement.tsx` |
| 15 | أثر بصمات الوجه `[]` deps يعمل على بيانات فارغة (no-op) | `[students, onUpdateStudent]` + حذف `eslint-disable` | `StudentManager.tsx` |
| 16 | `deleteDatabase` يترك اتصال IndexedDB مفتوحاً (`onblocked` + كاش سابق يصمد بعد الخروج) | `closeDBConnection()` قبل/بعد الحذف وتصفير الوعد | `lib/db.ts` · `offlineOutbox.ts` |
| 17 | `currentUser!.uid` بـnon-null assertion | `if (!currentUser) return` في الحذفين | `useDataActions.ts` |
| 18 | `off(requestsRef)` يحذف كل المستمعين على المسار | إزالة بالمستمع المحدّد | `useNavigation.ts` |
| 19 | `studentId/stageId` تُحقن في مسارات RTDB بلا تحقق من الرموز المحظورة | `assertValidKey` في كل البنّاءات | `firebase/paths.ts` |
| 20 | تجاوزات responsive (ضغط على شاشات ضيقة) | `grid-cols` ببادئات `sm:` في ثلاثة مكونات | `StudentProfileModal` · `SelfEnrollPage` · `SmartChatBot` |

### 🟢 Low / اختبارات

| # | المشكلة | الإصلاح |
|---|---------|---------|
| 21 | رسائل مقصودة تُبتلع برسائل عامة | تمرير `e.message` للرسائل المعلّمة (`app/*`) |
| 22-23 | أيقونة القفل مخفية خلف زر العين (نفس `end-3`) | `Login.tsx` — القفل `start-3` |
| 24 | **6 اختبارات جديدة:** بوابات `signIn` (معطّل/محذوف/فشل قواعد/سليم) + `validateLink usedAt` (مرفوض/فارغ) | `signIn.test.ts` · `tokenService.test.ts` |

---

## ⏸️ ما قُصد عدم تغييره (مُوثّق — لا يُعدّ إغفالاً)

| البند | السبب |
|-------|-------|
| قواعد `.read: true` العامة: `students`/`descriptors`/`teacherRecords`/`studentAttendance`/`colleges`/`stages`/`links/$token` | **قرار مستخدم سابق معلَّق** + صفحات الطالب بلا تسجيل دخول تعتمدها؛ الإغلاق يتطلب اختبار مسارات الطالب أولاً |
| `descriptorOverrides/.write` يسمح بكتابة بلا دخول | مقصود ومعلَّق بالتعليقات («اختبار الوجه بلا دخول») مع تحقّق شكل صارم على الورقة `$studentId` |
| `system/.read: true` | عنوان النظام يُقرأ في صفحة الدخول قبل المصادقة |
| توكن البوت يبقى على العميل لطلاب التدريسيين | الإرسال يتم من المتصفح — الحل الجذري proxy من الخادم (مشروع مستقل) |
| `storedPassword` النصّي القديم في `teacherAccounts` | مسار تغيير كلمة السر الحالي معتمد عليه؛ الإزالة تتطلب تدفّق ترحيل |
| 113 `console.warn/error` · 107 `any` · 4 تعطيلات `exhaustive-deps` متبقية · تكرار منطق `adminId‖uid` (5 مواضع) · ملفا `telegramService` متماثلان | تنظيف كمي عالي المخاطر/منخفض العائد — تحذيرات لا أخطاء؛ مؤجَّل كدَّين تقني |
| سطر Credits في `App.tsx` | توقيع المؤلف — لا يُلمس |
| فجوات تغطية `hooks/firebase` الكبرى | خارج نطاق هذا الإصلاح؛ +6 اختبارات هنا، والباقي backlog |

---

## ⚠️ خطوة إلزامية بعد الدمج

```bash
firebase deploy --only database
```

**بدونها:** فحص الحساب المحذوف يعمل بوضع التحمّل (يُعامَل كعدم وجود — أي سلوك اليوم) · قراءة بوت توكِن المقيّدة لا تُفعَّل. الكود آمن في الحالتين (لا كسر للمسارات المشروعة).
