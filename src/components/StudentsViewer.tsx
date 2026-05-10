import React, { useState } from 'react';
import { Student } from '../types/student';

interface StudentsViewerProps {
  students: Student[];
}

export const StudentsViewer: React.FC<StudentsViewerProps> = ({ students }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<string>('all');

  // استخراج جميع الكروبات الفريدة
  const uniqueGroups = Array.from(new Set(
    students.map(s => s.group).filter(Boolean)
  )).sort((a, b) => {
    const la = a!.charAt(0).toUpperCase();
    const lb = b!.charAt(0).toUpperCase();
    if (la !== lb) return la.localeCompare(lb);
    const na = parseInt(a!.slice(1)) || 0;
    const nb = parseInt(b!.slice(1)) || 0;
    return na - nb;
  });

  // تصفية الطلاب
  const filteredStudents = students.filter(s => {
    const matchSearch = !searchQuery || 
      s.name.includes(searchQuery) || 
      s.code.includes(searchQuery);
    const matchGroup = groupFilter === 'all' || s.group === groupFilter;
    return matchSearch && matchGroup;
  });

  // إحصائيات الكروبات
  const groupStats = uniqueGroups.reduce((acc, group) => {
    acc[group!] = students.filter(s => s.group === group).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-gray-800">👥 قائمة الطلاب</h2>
        <div className="px-4 py-2 bg-yellow-100 text-yellow-800 rounded-lg text-sm font-medium flex items-center gap-2">
          👁️ عرض فقط - الإدارة من قبل الأدمن
        </div>
      </div>

      {/* شريط البحث والفلتر */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* البحث */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            🔍 البحث (الاسم أو الرمز)
          </label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="اكتب اسم الطالب أو الرمز..."
            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            dir="rtl"
          />
        </div>

        {/* فلتر الكروب */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            🏷️ تصفية حسب الكروب
          </label>
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">جميع الكروبات ({students.length})</option>
            {uniqueGroups.map(g => (
              <option key={g} value={g}>
                {g} ({groupStats[g!]})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* إحصائيات الكروبات */}
      {uniqueGroups.length > 0 && (
        <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-lg">
          <h3 className="text-sm font-bold text-blue-800 mb-3">📊 إحصائيات الكروبات</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setGroupFilter('all')}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                groupFilter === 'all'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-white text-blue-700 border border-blue-300 hover:bg-blue-50'
              }`}
            >
              الكل: {students.length}
            </button>
            {uniqueGroups.map(g => (
              <button
                key={g}
                onClick={() => setGroupFilter(g!)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                  groupFilter === g
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-white text-blue-700 border border-blue-300 hover:bg-blue-50'
                }`}
              >
                {g}: {groupStats[g!]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* جدول الطلاب */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                #
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الرمز
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الاسم
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الكروب
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredStudents.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                  <div className="flex flex-col items-center gap-2">
                    <svg className="w-16 h-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    {searchQuery || groupFilter !== 'all' ? (
                      <>
                        <p className="font-medium">لا يوجد طلاب يطابقون البحث</p>
                        <button
                          onClick={() => {
                            setSearchQuery('');
                            setGroupFilter('all');
                          }}
                          className="text-blue-600 hover:underline text-sm"
                        >
                          إعادة تعيين الفلاتر
                        </button>
                      </>
                    ) : (
                      <p className="font-medium">لا يوجد طلاب في هذه المرحلة</p>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              filteredStudents.map((student, index) => (
                <tr key={student.id} className="hover:bg-blue-50 transition">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {index + 1}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-lg font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-md">
                      {student.code}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right font-medium text-gray-900">
                    {student.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    {student.group ? (
                      <span className="inline-block px-3 py-1 bg-indigo-100 text-indigo-800 text-sm font-medium rounded-full">
                        {student.group}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-sm">-</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ملخص النتائج */}
      {students.length > 0 && (
        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <p className="text-sm text-blue-800">
            📊 <strong>عدد الطلاب المعروضين:</strong> {filteredStudents.length} 
            {filteredStudents.length !== students.length && (
              <span className="mr-2">من أصل {students.length}</span>
            )}
            {groupFilter !== 'all' && (
              <span className="mr-2">| <strong>الكروب:</strong> {groupFilter}</span>
            )}
          </p>
        </div>
      )}
    </div>
  );
};