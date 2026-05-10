import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { Student, AttendanceRecord } from '../types/student';

interface AttendanceLoginProps {
  students: Student[];
  activeSessionId: string | null;
  onAttendanceRecord: (record: AttendanceRecord) => void;
}

export const AttendanceLogin: React.FC<AttendanceLoginProps> = ({
  students,
  activeSessionId,
  onAttendanceRecord,
}) => {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  
  // 🔒 مرجع للحاوية لمنع التمرير
  const containerRef = useRef<HTMLDivElement>(null);

  // ============================================================
  // 🔒 منع التمرير التلقائي عند تغيير الـ code
  // ============================================================
  useLayoutEffect(() => {
    // حفظ موقع التمرير الحالي قبل أي تحديث للـ DOM
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    
    // إعادة الموقع فوراً بعد التحديث
    requestAnimationFrame(() => {
      window.scrollTo(scrollX, scrollY);
    });
  }, [code, message, pressedKey]);

  // ============================================================
  // ⏱️ إخفاء الرسالة بعد 3 ثواني
  // ============================================================
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => {
        setMessage(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // ============================================================
  // 🎯 إدخال رقم
  // ============================================================
  const handleCodeInput = useCallback((digit: string) => {
    setCode(prev => {
      if (prev.length >= 4) return prev;
      const newCode = prev + digit;
      
      if (newCode.length === 4) {
        setTimeout(() => checkAndSubmit(newCode), 150);
      }
      
      return newCode;
    });
  }, []);

  // ============================================================
  // ✅ التحقق وتسجيل الحضور
  // ============================================================
  const checkAndSubmit = (codeToCheck: string) => {
    if (!activeSessionId) {
      setMessage({
        type: 'error',
        text: '⚠️ لا يوجد سجل نشط!\nالرجاء تفعيل سجل أولاً',
      });
      setCode('');
      return;
    }

    const student = students.find((s) => s.code === codeToCheck);

    if (student) {
      const now = new Date();

      const record: AttendanceRecord = {
        id: Date.now().toString(),
        studentId: student.id,
        studentName: student.name,
        studentCode: student.code,
        studentGroup: student.group,
        timestamp: now.toISOString(),
        date: now.toLocaleDateString('ar-EG'),
        time: now.toLocaleTimeString('ar-EG'),
        sessionId: activeSessionId,
      };

      onAttendanceRecord(record);

      setMessage({
        type: 'success',
        text: `✅ مرحباً ${student.name}!\n${student.group ? `🏷️ الكروب: ${student.group}\n` : ''}تم تسجيل حضورك بنجاح`,
      });
      setCode('');
    } else {
      setMessage({
        type: 'error',
        text: '❌ الرمز غير صحيح\nحاول مرة أخرى',
      });
      setCode('');
    }
  };

  const handleClear = useCallback(() => {
    setCode('');
    setMessage(null);
  }, []);

  const handleBackspace = useCallback(() => {
    setCode(prev => prev.slice(0, -1));
  }, []);

  // ============================================================
  // ⌨️ دعم الكيبورد
  // ============================================================
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // منع التمرير بالأسهم والـ Space
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', ' '].includes(e.key)) {
        // ما نمنعه عشان ما نأثر على بقية الصفحة
      }

      // الأرقام
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handleCodeInput(e.key);
        setPressedKey(e.key);
        setTimeout(() => setPressedKey(null), 150);
      }
      
      // Backspace
      else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
        setPressedKey('backspace');
        setTimeout(() => setPressedKey(null), 150);
      }
      
      // Escape أو Delete = مسح الكل
      else if (e.key === 'Escape' || e.key === 'Delete') {
        e.preventDefault();
        handleClear();
        setPressedKey('clear');
        setTimeout(() => setPressedKey(null), 150);
      }
      
      // Enter = تحقق فوري إذا كملت 4
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (code.length === 4) {
          checkAndSubmit(code);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [code, handleCodeInput, handleBackspace, handleClear]);

  // ============================================================
  // 🎨 العرض
  // ============================================================
  
  // إنشاء مصفوفة من 4 خانات لعرض الأرقام
  const codeDigits = Array(4).fill('').map((_, i) => code[i] || '');

  return (
    <div ref={containerRef} className="bg-white rounded-2xl shadow-xl p-6 md:p-8 select-none">
      {/* العنوان */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full mb-3 shadow-lg">
          <svg className="w-9 h-9 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
          </svg>
        </div>
        <h2 className="text-3xl font-bold text-gray-800">تسجيل الحضور</h2>
        <p className="text-sm text-gray-500 mt-1">أدخل رمزك المكون من 4 أرقام</p>
      </div>

      {/* ============================================================ */}
      {/* 🔢 عرض الأرقام (LTR - من اليسار لليمين) */}
      {/* ============================================================ */}
      <div className="mb-6">
        <div 
          className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl p-6 border-2 border-gray-200 shadow-inner"
          dir="ltr"
        >
          {/* خانات الأرقام */}
          <div className="flex items-center justify-center gap-3 md:gap-4" dir="ltr">
            {codeDigits.map((digit, index) => (
              <div
                key={index}
                className={`
                  w-16 h-20 md:w-20 md:h-24
                  flex items-center justify-center
                  rounded-xl border-2 transition-all duration-200
                  ${digit 
                    ? 'bg-gradient-to-br from-blue-500 to-blue-600 border-blue-700 text-white shadow-lg scale-105' 
                    : 'bg-white border-gray-300 text-gray-300'
                  }
                `}
                style={{ fontFamily: 'Arial, sans-serif' }}
              >
                <span className="text-4xl md:text-5xl font-bold" style={{ fontFeatureSettings: '"tnum"' }}>
                  {digit || '·'}
                </span>
              </div>
            ))}
          </div>
          
          {/* عداد الأرقام */}
          <div className="text-center mt-4">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-white rounded-full shadow-sm border border-gray-200">
              <span className="text-xs text-gray-500">الأرقام المدخلة:</span>
              <span className={`font-bold ${code.length === 4 ? 'text-green-600' : 'text-blue-600'}`} style={{ fontFamily: 'Arial' }}>
                {code.length}/4
              </span>
            </div>
          </div>
        </div>

        {/* الرسائل */}
        {message && (
          <div
            className={`mt-4 p-4 rounded-xl text-center font-medium whitespace-pre-line border-2 shadow-md animate-fadeIn ${
              message.type === 'success'
                ? 'bg-gradient-to-r from-green-50 to-emerald-50 text-green-800 border-green-300'
                : 'bg-gradient-to-r from-red-50 to-rose-50 text-red-800 border-red-300'
            }`}
            dir="rtl"
          >
            {message.text}
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* 🎹 لوحة الأرقام */}
      {/* ============================================================ */}
      <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto" dir="ltr">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => {
          const numStr = num.toString();
          const isPressed = pressedKey === numStr;
          return (
            <button
              key={num}
              onClick={() => handleCodeInput(numStr)}
              disabled={code.length >= 4}
              className={`
                relative overflow-hidden
                bg-gradient-to-br from-blue-500 to-blue-600
                hover:from-blue-600 hover:to-blue-700
                active:from-blue-700 active:to-blue-800
                disabled:from-gray-300 disabled:to-gray-400
                disabled:cursor-not-allowed
                text-white text-3xl font-bold
                py-5 rounded-xl
                transition-all duration-150
                shadow-md hover:shadow-lg
                transform active:scale-95
                ${isPressed ? 'scale-95 from-blue-700 to-blue-800 shadow-inner' : ''}
              `}
              style={{ fontFamily: 'Arial, sans-serif', fontFeatureSettings: '"tnum"' }}
            >
              {num}
            </button>
          );
        })}

        {/* زر مسح */}
        <button
          onClick={handleClear}
          className={`
            bg-gradient-to-br from-red-500 to-red-600
            hover:from-red-600 hover:to-red-700
            active:from-red-700 active:to-red-800
            text-white text-base font-bold
            py-5 rounded-xl
            transition-all duration-150
            shadow-md hover:shadow-lg
            transform active:scale-95
            flex items-center justify-center gap-1
            ${pressedKey === 'clear' ? 'scale-95 from-red-700 to-red-800 shadow-inner' : ''}
          `}
        >
          <span>مسح</span>
        </button>

        {/* زر صفر */}
        <button
          onClick={() => handleCodeInput('0')}
          disabled={code.length >= 4}
          className={`
            bg-gradient-to-br from-blue-500 to-blue-600
            hover:from-blue-600 hover:to-blue-700
            active:from-blue-700 active:to-blue-800
            disabled:from-gray-300 disabled:to-gray-400
            disabled:cursor-not-allowed
            text-white text-3xl font-bold
            py-5 rounded-xl
            transition-all duration-150
            shadow-md hover:shadow-lg
            transform active:scale-95
            ${pressedKey === '0' ? 'scale-95 from-blue-700 to-blue-800 shadow-inner' : ''}
          `}
          style={{ fontFamily: 'Arial, sans-serif', fontFeatureSettings: '"tnum"' }}
        >
          0
        </button>

        {/* زر Backspace */}
        <button
          onClick={handleBackspace}
          className={`
            bg-gradient-to-br from-amber-500 to-orange-500
            hover:from-amber-600 hover:to-orange-600
            active:from-amber-700 active:to-orange-700
            text-white text-2xl font-bold
            py-5 rounded-xl
            transition-all duration-150
            shadow-md hover:shadow-lg
            transform active:scale-95
            flex items-center justify-center
            ${pressedKey === 'backspace' ? 'scale-95 from-amber-700 to-orange-700 shadow-inner' : ''}
          `}
        >
          ⌫
        </button>
      </div>

      {/* ============================================================ */}
      {/* 💡 معلومات وإرشادات */}
      {/* ============================================================ */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* الكيبورد */}
        <div className="p-3 bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-200 rounded-xl">
          <div className="flex items-start gap-2">
            <span className="text-2xl">⌨️</span>
            <div className="text-xs text-purple-800">
              <p className="font-bold mb-1">من الكيبورد:</p>
              <ul className="space-y-0.5">
                <li>• <kbd className="px-1.5 py-0.5 bg-white rounded border border-purple-300 font-mono">0-9</kbd> أرقام</li>
                <li>• <kbd className="px-1.5 py-0.5 bg-white rounded border border-purple-300 font-mono">⌫</kbd> حذف</li>
                <li>• <kbd className="px-1.5 py-0.5 bg-white rounded border border-purple-300 font-mono">Esc</kbd> مسح الكل</li>
              </ul>
            </div>
          </div>
        </div>

        {/* الماوس */}
        <div className="p-3 bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-200 rounded-xl">
          <div className="flex items-start gap-2">
            <span className="text-2xl">🖱️</span>
            <div className="text-xs text-blue-800">
              <p className="font-bold mb-1">من الأزرار:</p>
              <ul className="space-y-0.5">
                <li>• اضغط الأرقام بالتسلسل</li>
                <li>• تسجيل تلقائي عند 4 أرقام</li>
                <li>• الرموز من 1000-9999</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* CSS للـ Animations */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
        kbd {
          font-size: 0.75rem;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
};