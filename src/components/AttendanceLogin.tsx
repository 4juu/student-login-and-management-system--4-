import React, { useState, useEffect } from 'react';
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

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => {
        setMessage(null);
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [message]);

  const handleCodeInput = (digit: string) => {
    // يمنع إدخال أكثر من 4 أرقام
    if (code.length >= 4) return;

    const newCode = code + digit;
    setCode(newCode);

    // الإرسال التلقائي فقط عند اكتمال 4 أرقام
    if (newCode.length === 4) {
      setTimeout(() => {
        checkAndSubmit(newCode);
      }, 100);
    }
  };

  const checkAndSubmit = (codeToCheck: string) => {
    if (!activeSessionId) {
      setMessage({
        type: 'error',
        text: 'لا يوجد سجل نشط! الرجاء تفعيل سجل أولاً',
      });
      setCode('');
      return;
    }

    const student = students.find(
      (s) => s.code === codeToCheck
    );

    if (student) {
      const now = new Date();

      const record: AttendanceRecord = {
        id: Date.now().toString(),
        studentId: student.id,
        studentName: student.name,
        studentCode: student.code,
        timestamp: now.toISOString(),
        date: now.toLocaleDateString('ar-EG'),
        time: now.toLocaleTimeString('ar-EG'),
        sessionId: activeSessionId,
      };

      onAttendanceRecord(record);

      setMessage({
        type: 'success',
        text: `✅ مرحباً ${student.name}!\nتم تسجيل حضورك بنجاح`,
      });

      setCode('');
    } else {
      setMessage({
        type: 'error',
        text: '❌ الرمز غير صحيح. حاول مرة أخرى',
      });

      setCode('');
    }
  };

  const handleClear = () => {
    setCode('');
    setMessage(null);
  };

  const handleBackspace = () => {
    setCode(code.slice(0, -1));
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-8">
      <h2 className="text-3xl font-bold mb-6 text-center text-gray-800">
        تسجيل الحضور
      </h2>

      <div className="mb-8">
        <div className="bg-gray-100 rounded-lg p-6 mb-4">
          <div className="text-center text-4xl font-bold text-gray-700 h-16 flex items-center justify-center tracking-[0.5em]">
            {code ? code.padEnd(4, '_').split('').join(' ') : '_ _ _ _'}
          </div>
          <p className="text-center text-sm text-gray-500 mt-2">
            {code.length}/4 أرقام
          </p>
        </div>

        {message && (
          <div
            className={`p-4 rounded-md text-center font-medium whitespace-pre-line ${
              message.type === 'success'
                ? 'bg-green-100 text-green-800 border-2 border-green-300'
                : 'bg-red-100 text-red-800 border-2 border-red-300'
            }`}
            dir="rtl"
          >
            {message.text}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4 max-w-md mx-auto">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <button
            key={num}
            onClick={() => handleCodeInput(num.toString())}
            disabled={code.length >= 4}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-2xl font-bold py-6 rounded-lg transition duration-200 active:scale-95 shadow-md"
          >
            {num}
          </button>
        ))}

        <button
          onClick={handleClear}
          className="bg-red-500 hover:bg-red-600 text-white text-xl font-bold py-6 rounded-lg transition duration-200 active:scale-95 shadow-md"
        >
          مسح
        </button>

        <button
          onClick={() => handleCodeInput('0')}
          disabled={code.length >= 4}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-2xl font-bold py-6 rounded-lg transition duration-200 active:scale-95 shadow-md"
        >
          0
        </button>

        <button
          onClick={handleBackspace}
          className="bg-yellow-500 hover:bg-yellow-600 text-white text-xl font-bold py-6 rounded-lg transition duration-200 active:scale-95 shadow-md"
        >
          ⌫
        </button>
      </div>

      <div className="mt-6 text-center">
        <p className="text-gray-600 text-lg font-medium">
          أدخل رمزك المكون من 4 أرقام
        </p>
        <p className="text-sm text-gray-500 mt-2">
          الرموز من 1000 إلى 9999
        </p>
      </div>

      {/* Info box */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-start gap-2">
          <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">💡 كيفية الاستخدام:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>أدخل رمزك المكون من 4 أرقام بالترتيب</li>
              <li>سيتم التسجيل تلقائياً عند إدخال الرقم الرابع</li>
              <li>استخدم زر "⌫" لحذف آخر رقم</li>
              <li>استخدم زر "مسح" لمسح جميع الأرقام</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};