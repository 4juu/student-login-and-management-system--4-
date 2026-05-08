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
      text: "مرحباً 👋 أنا مساعدك الذكي.\nاسألني عن:\n• عدد الطلاب\n• الحضور والغياب\n• أسماء الطلاب\n• إحصائيات الجلسات",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // 🔴 مسح المحادثة عند إغلاق الموقع
  useEffect(() => {
    const handleUnload = () => {
      sessionStorage.removeItem("chatMessages");
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  // 🟢 جلب البيانات من Firebase
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

  // 🟢 إرسال الرسالة إلى Gemini
  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMsg: Message = { role: "user", text: input };
    setMessages((prev) => [...prev, userMsg]);
    const currentInput = input;
    setInput("");
    setLoading(true);

    try {
      const { students, attendance, sessions } = await fetchAllData();

      const dataContext = `
أنت مساعد ذكي لنظام إدارة حضور الطلاب. أجب باللغة العربية فقط بشكل مختصر ودقيق ومفيد.

📊 البيانات الحالية:
- عدد الطلاب الكلي: ${students.length}
- عدد سجلات الحضور: ${attendance.length}
- عدد الجلسات: ${sessions.length}

👥 قائمة الطلاب:
${(students as any[])
  .map((s, i) => `${i + 1}. ${s.name} (كود: ${s.code})`)
  .join("\n")}

📋 الجلسات:
${(sessions as any[])
  .map((s, i) => `${i + 1}. ${s.name} - تاريخ: ${s.date}`)
  .join("\n")}

✅ سجلات الحضور:
${(attendance as any[])
  .map(
    (a) =>
      `- ${a.studentName} (كود ${a.studentCode}) حضر بتاريخ ${a.date} الساعة ${a.time}`
  )
  .join("\n")}

❓ سؤال المستخدم: ${currentInput}

أعطني الإجابة مباشرة باللغة العربية:`;

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
      console.log("Gemini Response:", data);

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
      {/* زر فتح الشات */}
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

      {/* نافذة الشات */}
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
          {/* الهيدر */}
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

          {/* الرسائل */}
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

          {/* الإدخال */}
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