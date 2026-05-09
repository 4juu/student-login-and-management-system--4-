import { useState, useEffect } from "react";
import { ref, get } from "firebase/database";
import { database } from "../firebase/config";

interface Message {
  role: "user" | "bot";
  text: string;
}

interface ChatBotProps {
  userId: string;
}

export default function ChatBot({ userId }: ChatBotProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "bot",
      text: "مرحباً 👋 أنا مساعدك الذكي.\nاسألني عن:\n• حضور أي طالب بيوم أو فترة\n• من حضر/غاب من كروب معين\n• إحصائيات الحضور والغياب",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleUnload = () => {
      sessionStorage.removeItem("chatMessages");
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  const fetchAllData = async () => {
    try {
      const studentsSnap = await get(ref(database, `userData/${userId}/students`));
      const attendanceSnap = await get(
        ref(database, `userData/${userId}/attendanceRecords`)
      );
      const sessionsSnap = await get(ref(database, `userData/${userId}/sessions`));

      const students = studentsSnap.exists()
        ? Object.values(studentsSnap.val())
        : [];
      const attendance = attendanceSnap.exists()
        ? Object.values(attendanceSnap.val())
        : [];
      const sessions = sessionsSnap.exists()
        ? Object.values(sessionsSnap.val())
        : [];

      return { students, attendance, sessions };
    } catch (err) {
      console.error("خطأ في جلب البيانات:", err);
      return { students: [], attendance: [], sessions: [] };
    }
  };

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMsg: Message = { role: "user", text: input };
    setMessages((prev) => [...prev, userMsg]);
    const currentInput = input;
    setInput("");
    setLoading(true);

    try {
      const { students, attendance, sessions } = await fetchAllData();
      
      // ✅ التاريخ الحالي للمساعدة في فهم "اليوم" و "أمس"
      const today = new Date();
      const todayStr = today.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

      const dataContext = `
أنت مساعد ذكي لنظام حضور الطلاب. أجب باللغة العربية فقط.

📅 التاريخ الحالي: ${todayStr}

⚠️ قواعد الإجابة الصارمة (مهم جداً):

1. **أجب بإجابات قصيرة مباشرة** - لا تطوّل ولا تشرح.

2. **عند السؤال عن حضور طالب بيوم معين:**
   - إذا حضر: "✅ نعم حضر [الاسم] يوم [اليوم] [التاريخ] كوده [الكود]"
   - إذا غاب: "❌ لم يحضر [الاسم] يوم [اليوم] [التاريخ] كوده [الكود]"

3. **عند السؤال عن عدد مرات حضور/غياب طالب خلال فترة (مثلاً من 9-5 إلى 2-6):**
   حلل البيانات بدقة واعرضها بهذا الشكل:
   
   📊 [اسم الطالب] - كود [الكود]
   ✅ حضر [العدد] مرات:
   • [التاريخ 1]
   • [التاريخ 2]
   • [التاريخ 3]
   ❌ غاب [العدد] مرات:
   • [التاريخ 1]
   • [التاريخ 2]
   
   (الأرقام والتواريخ بالأرقام الإنكليزية: 1,2,3,4,5,6,7,8,9,0)

4. **عند السؤال عن مجموعة طلاب خلال فترة:**
   اعرض كل طالب بتنسيق مختصر:
   
   📊 محمد خالد (1001)
   ✅ حضر 4: 9-5, 12-5, 15-5, 20-5
   ❌ غاب 2: 10-5, 18-5
   
   📊 أحمد علي (1002)
   ✅ حضر 3: 9-5, 12-5, 15-5
   ❌ غاب 1: 10-5

5. **عند السؤال "من حضر من كروب [اسم] يوم [يوم]؟":**
   ✅ الحاضرون من كروب [الاسم] يوم [اليوم] [التاريخ]:
   • محمد خالد (1001)
   • أحمد علي (1002)
   • سارة محمد (1003)
   
   إذا ما حضر أحد: "❌ لا يوجد حضور من كروب [الاسم] يوم [اليوم]"

6. **عند السؤال "من غاب من كروب [اسم] يوم [يوم]؟":**
   ❌ الغائبون من كروب [الاسم] يوم [اليوم] [التاريخ]:
   • محمد خالد (1001)
   • سارة محمد (1003)
   
   (احسب الغائبين = طلاب الكروب - الحاضرين بذلك اليوم)

7. **عند السؤال "كم مرة حضر كل طالب؟" (بدون فترة):**
   اعرض قائمة بسيطة:
   محمد خالد 4
   أحمد علي 2
   سارة محمد 5

8. **عند سؤال عن من صنع/أسس/يدير الموقع:**
   "الدكتور الصيدلاني مجتبى هيثم محمد - مؤسس الموقع ومدير النظام والمسؤول عن جميع حسابات التدريسيين والإشراف عليهم 👨‍⚕️"

9. **استخدم دائماً:** ✅ للحضور، ❌ للغياب، 📊 للإحصائيات.

10. **الأرقام والتواريخ دائماً بالإنكليزي** (مثل: 9-5-2026, 1001, 4 مرات).

11. **لفهم الفترات:** "من 9-5 إلى 2-6" يعني من 9 مايو إلى 2 يونيو. حلل كل التواريخ ضمن هذه الفترة.

12. **لفهم أيام الأسبوع:** السبت، الأحد، الاثنين، الثلاثاء، الأربعاء، الخميس، الجمعة - استخرج اليوم من التاريخ تلقائياً.

📊 البيانات المتاحة:

👥 الطلاب (${students.length}):
${(students as any[])
  .map((s) => `${s.name} | كود: ${s.code} | كروب: ${s.group || '-'}`)
  .join("\n")}

📋 الجلسات (${sessions.length}):
${(sessions as any[])
  .map((s) => `${s.name} - ${s.date}`)
  .join("\n")}

✅ سجلات الحضور (${attendance.length}):
${(attendance as any[])
  .map(
    (a) =>
      `${a.studentName} | كود ${a.studentCode} | كروب ${a.group || '-'} | ${a.date} | ${a.time}`
  )
  .join("\n")}

❓ السؤال: ${currentInput}

الجواب (بالتنسيق المطلوب أعلاه):`;

      const response = await fetch(
         `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${import.meta.env.VITE_GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: dataContext }],
              },
            ],
          }),
        }
      );

      const data = await response.json();
      let botReply = "لم أفهم السؤال 😅";

      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        botReply = data.candidates[0].content.parts[0].text.trim();
      } else if (data.error) {
        botReply = `⚠️ ${data.error.message || "حدث خطأ"}`;
      }

      setMessages((prev) => [...prev, { role: "bot", text: botReply }]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { role: "bot", text: "❌ حدث خطأ في الاتصال" },
      ]);
    }

    setLoading(false);
  };

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: "fixed",
          bottom: 20,
          left: 20,
          background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
          color: "white",
          width: 60,
          height: 60,
          borderRadius: "50%",
          border: "none",
          fontSize: 26,
          cursor: "pointer",
          zIndex: 9999,
          boxShadow: "0 4px 16px rgba(79, 70, 229, 0.5)",
        }}
      >
        💬
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            bottom: 90,
            left: 20,
            width: 360,
            height: 520,
            background: "white",
            borderRadius: 16,
            boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            zIndex: 9999,
            direction: "rtl",
          }}
        >
          <div
            style={{
              background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
              color: "white",
              padding: 16,
              fontWeight: "bold",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>🤖 المساعد الذكي</span>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: "transparent",
                border: "none",
                color: "white",
                fontSize: 22,
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>

          <div
            style={{
              flex: 1,
              padding: 14,
              overflowY: "auto",
              background: "#f9fafb",
            }}
          >
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  textAlign: m.role === "user" ? "left" : "right",
                  margin: "10px 0",
                }}
              >
                <span
                  style={{
                    background:
                      m.role === "user"
                        ? "linear-gradient(135deg, #4f46e5, #7c3aed)"
                        : "#e5e7eb",
                    color: m.role === "user" ? "white" : "#1f2937",
                    padding: "10px 14px",
                    borderRadius: 14,
                    display: "inline-block",
                    maxWidth: "85%",
                    whiteSpace: "pre-wrap",
                    fontSize: 14,
                    lineHeight: 1.6,
                  }}
                >
                  {m.text}
                </span>
              </div>
            ))}
            {loading && (
              <p style={{ textAlign: "center", color: "#666" }}>
                جاري التفكير... ⏳
              </p>
            )}
          </div>

          <div style={{ display: "flex", borderTop: "1px solid #e5e7eb" }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="اكتب سؤالك هنا..."
              style={{
                flex: 1,
                border: "none",
                padding: 14,
                outline: "none",
                fontSize: 14,
              }}
            />
            <button
              onClick={sendMessage}
              disabled={loading}
              style={{
                background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
                color: "white",
                border: "none",
                padding: "0 20px",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: "bold",
              }}
            >
              إرسال
            </button>
          </div>
        </div>
      )}
    </div>
  );
}