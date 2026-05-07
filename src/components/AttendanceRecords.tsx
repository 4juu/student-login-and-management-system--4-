import React, { useState } from 'react';
import { AttendanceRecord, AttendanceSession } from '../types/student';
import { exportToExcel, exportToCSV, shareAsText } from '../utils/exportUtils';

interface AttendanceRecordsProps {
  records: AttendanceRecord[];
  sessions: AttendanceSession[];
  activeSessionId: string | null;
  onClearRecords: () => void;
}

export const AttendanceRecords: React.FC<AttendanceRecordsProps> = ({
  records,
  sessions,
  activeSessionId,
  onClearRecords,
}) => {
  const [selectedSessionId, setSelectedSessionId] = useState<string | 'all'>(activeSessionId || 'all');

  // Filter records based on selected session
  const filteredRecords = selectedSessionId === 'all' 
    ? records 
    : records.filter(r => r.sessionId === selectedSessionId);
  const handleExportExcel = () => {
    const success = exportToExcel(filteredRecords);
    if (success) {
      alert('✅ تم تصدير الملف بنجاح!');
    } else {
      alert('❌ حدث خطأ أثناء التصدير. جرب تصدير CSV بدلاً من ذلك.');
    }
  };

  const handleExportCSV = () => {
    const success = exportToCSV(filteredRecords);
    if (success) {
      alert('✅ تم تصدير الملف بنجاح!');
    } else {
      alert('❌ حدث خطأ أثناء التصدير.');
    }
  };

  const handleShare = () => {
    shareAsText(filteredRecords);
  };

  const handleClearRecords = () => {
    if (window.confirm('هل أنت متأكد من حذف جميع السجلات؟')) {
      onClearRecords();
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <h2 className="text-2xl font-bold text-gray-800">سجل الحضور</h2>
          <div className="text-gray-600">
            عدد السجلات: <span className="font-bold text-blue-600 text-lg">{filteredRecords.length}</span>
            {selectedSessionId !== 'all' && <span className="text-sm"> (من {records.length})</span>}
          </div>
        </div>
        
        {/* Session Filter */}
        {sessions.length > 0 && (
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700">عرض سجل:</label>
            <select
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">جميع السجلات</option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.name}
                </option>
              ))}
            </select>
          </div>
        )}
        
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleExportExcel}
            disabled={records.length === 0}
            className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-md transition duration-200 flex items-center gap-2 shadow-sm"
            title="تصدير إلى ملف Excel (.xlsx)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            تصدير Excel
          </button>
          
          <button
            onClick={handleExportCSV}
            disabled={records.length === 0}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-md transition duration-200 flex items-center gap-2 shadow-sm"
            title="تصدير إلى ملف CSV"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            تصدير CSV
          </button>
          
          <button
            onClick={handleShare}
            disabled={records.length === 0}
            className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-md transition duration-200 flex items-center gap-2 shadow-sm"
            title="مشاركة أو نسخ السجل"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            مشاركة
          </button>
          
          <button
            onClick={handleClearRecords}
            disabled={records.length === 0}
            className="bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-md transition duration-200 flex items-center gap-2 shadow-sm"
            title="حذف جميع السجلات"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            مسح السجلات
          </button>
        </div>
      </div>

      <div className="overflow-x-auto max-h-96 overflow-y-auto border rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 sticky top-0">
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
                التاريخ
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الوقت
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredRecords.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                  <div className="flex flex-col items-center gap-2">
                    <svg className="w-16 h-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-lg font-medium">لا توجد سجلات حضور</p>
                    <p className="text-sm">سيتم عرض السجلات هنا بعد تسجيل حضور الطلاب</p>
                  </div>
                </td>
              </tr>
            ) : (
              [...filteredRecords].reverse().map((record, index) => (
                <tr key={record.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {filteredRecords.length - index}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-bold bg-blue-100 text-blue-800">
                      {record.studentCode}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right font-medium text-gray-900">
                    {record.studentName}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-600">
                    {record.date}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-600">
                    {record.time}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {records.length > 0 && (
        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <p className="text-sm text-blue-800">
            💡 <strong>نصيحة:</strong> يمكنك تصدير السجلات إلى Excel أو CSV لحفظها على جهازك، 
            أو استخدام زر "مشاركة" لنسخ السجل ومشاركته عبر WhatsApp أو أي تطبيق آخر.
          </p>
        </div>
      )}
    </div>
  );
};
