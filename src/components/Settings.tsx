import React, { useRef } from 'react';
import { Student, AttendanceRecord } from '../types/student';

interface SettingsProps {
  students: Student[];
  attendanceRecords: AttendanceRecord[];
  onDataRestored: () => void;
}

export const Settings: React.FC<SettingsProps> = ({
  students,
  attendanceRecords,
  onDataRestored,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDownloadBackup = () => {
    try {
      const backupData = {
        students,
        attendanceRecords,
        timestamp: new Date().toISOString(),
        version: '2.0',
      };
      
      const dataStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const now = new Date();
      const fileName = `نسخة_احتياطية_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.json`;
      
      link.setAttribute('href', url);
      link.setAttribute('download', fileName);
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      alert('✅ تم تنزيل النسخة الاحتياطية بنجاح!');
    } catch (error) {
      console.error('Error downloading backup:', error);
      alert('❌ حدث خطأ أثناء إنشاء النسخة الاحتياطية');
    }
  };

  const handleRestoreBackup = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        try {
          JSON.parse(content);
          if (window.confirm('هل أنت متأكد من استعادة النسخة الاحتياطية؟ سيتم تحديث الصفحة...')) {
            alert('✅ تم استعادة النسخة الاحتياطية بنجاح! سيتم تحديث الصفحة...');
            onDataRestored();
            window.location.reload();
          }
        } catch {
          alert('❌ فشل استعادة النسخة الاحتياطية. تأكد من صحة الملف.');
        }
      }
    };
    reader.readAsText(file);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const calculateDataSize = () => {
    const dataString = JSON.stringify({ students, attendanceRecords });
    return dataString.length;
  };

  const dataSize = calculateDataSize();

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">الإعدادات والنسخ الاحتياطي</h2>

      {/* Firebase Storage Info */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-3 text-gray-700">💾 معلومات التخزين</h3>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-start gap-3 mb-4">
            <svg className="w-6 h-6 text-green-600 flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
            </svg>
            <div className="flex-1">
              <p className="text-green-800 font-medium mb-2">
                ✅ البيانات محفوظة في Firebase (السحابة)
              </p>
              <ul className="text-sm text-green-700 space-y-1">
                <li>• <strong>مساحة غير محدودة</strong> - لا قيود على حجم البيانات!</li>
                <li>• <strong>آمن وموثوق</strong> - نسخ احتياطي تلقائي من Google</li>
                <li>• <strong>وصول من أي مكان</strong> - من أي جهاز وأي متصفح</li>
                <li>• <strong>سرعة عالية</strong> - مزامنة فورية</li>
              </ul>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div className="bg-white rounded-lg p-3 border border-green-200">
              <p className="text-sm text-gray-600 mb-1">حجم البيانات الحالية:</p>
              <p className="text-2xl font-bold text-green-600">{formatBytes(dataSize)}</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-green-200">
              <p className="text-sm text-gray-600 mb-1">المساحة المتاحة:</p>
              <p className="text-2xl font-bold text-blue-600">غير محدودة ∞</p>
            </div>
          </div>
        </div>
      </div>

      {/* Data Summary */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-3 text-gray-700">📊 ملخص البيانات</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="bg-blue-500 rounded-full p-3">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-600">عدد الطلاب</p>
                <p className="text-2xl font-bold text-gray-800">{students.length.toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="bg-purple-500 rounded-full p-3">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-600">سجلات الحضور</p>
                <p className="text-2xl font-bold text-gray-800">{attendanceRecords.length.toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Backup Section */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-3 text-gray-700">💾 النسخ الاحتياطي الإضافي</h3>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">💡 نصيحة</p>
              <p>بياناتك محفوظة تلقائياً في Firebase، لكن يمكنك تحميل نسخة احتياطية إضافية على جهازك للأمان المضاعف.</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={handleDownloadBackup}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-md transition duration-200 flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            تحميل نسخة احتياطية
          </button>

          <button
            onClick={handleRestoreBackup}
            className="bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-md transition duration-200 flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            استعادة نسخة احتياطية
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Info Section */}
      <div className="bg-gradient-to-r from-green-50 to-blue-50 border border-green-200 rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-3 text-gray-700 flex items-center gap-2">
          <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          مميزات Firebase Realtime Database
        </h3>
        <ul className="space-y-2 text-sm text-gray-700">
          <li className="flex items-start gap-2">
            <span className="text-green-500 mt-1">✓</span>
            <span><strong>لا حدود للمساحة:</strong> يمكنك إضافة آلاف الطلاب وملايين السجلات</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-green-500 mt-1">✓</span>
            <span><strong>نسخ احتياطي تلقائي:</strong> Google تحفظ نسخ احتياطية تلقائية كل يوم</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-green-500 mt-1">✓</span>
            <span><strong>مزامنة فورية:</strong> التحديثات تظهر فوراً على جميع الأجهزة</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-green-500 mt-1">✓</span>
            <span><strong>أمان عالي:</strong> بيانات مشفرة ومحمية بقواعد الأمان</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-green-500 mt-1">✓</span>
            <span><strong>متاح دائماً:</strong> خوادم Google متوفرة 24/7 مع ضمان 99.9%</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-500 mt-1">💡</span>
            <span><strong>مثالي للجامعات:</strong> يدعم آلاف المستخدمين والطلاب في نفس الوقت</span>
          </li>
        </ul>
      </div>
    </div>
  );
};
