import React, { useState } from 'react';
import { Student } from '../types/student';

interface StudentManagerProps {
  students: Student[];
  onAddStudent: (student: Student) => void;
  onDeleteStudent: (id: string) => void;
}

export const StudentManager: React.FC<StudentManagerProps> = ({
  students,
  onAddStudent,
  onDeleteStudent,
}) => {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate code (3 or 4 digits)
    if (!/^\d{3,4}$/.test(code)) {
      setError('الرمز يجب أن يكون 3 أو 4 أرقام فقط');
      return;
    }

    // Check if code already exists
    if (students.some(s => s.code === code)) {
      setError('هذا الرمز مستخدم بالفعل');
      return;
    }

    if (!name.trim()) {
      setError('الرجاء إدخال اسم الطالب');
      return;
    }

    const newStudent: Student = {
      id: Date.now().toString(),
      name: name.trim(),
      code,
      createdAt: new Date().toISOString(),
    };

    onAddStudent(newStudent);
    setName('');
    setCode('');
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-bold mb-4 text-gray-800">إدارة الطلاب</h2>
      
      <form onSubmit={handleSubmit} className="mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              اسم الطالب
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="أدخل اسم الطالب"
              dir="rtl"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              رمز الطالب (3-4 أرقام)
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={4}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center text-lg font-bold"
              placeholder="123"
              inputMode="numeric"
            />
          </div>
          
          <div className="flex items-end">
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition duration-200"
            >
              إضافة طالب
            </button>
          </div>
        </div>
        
        {error && (
          <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-md" dir="rtl">
            {error}
          </div>
        )}
      </form>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الرمز
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الاسم
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                إجراءات
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {students.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-6 py-4 text-center text-gray-500">
                  لا توجد طلاب مسجلين
                </td>
              </tr>
            ) : (
              students.map((student) => (
                <tr key={student.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-lg font-bold text-blue-600">
                      {student.code}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    {student.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <button
                      onClick={() => onDeleteStudent(student.id)}
                      className="text-red-600 hover:text-red-900 font-medium"
                    >
                      حذف
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
