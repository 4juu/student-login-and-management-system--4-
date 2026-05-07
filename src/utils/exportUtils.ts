import { AttendanceRecord } from '../types/student';
import { utils, writeFile } from 'xlsx';

export const exportToExcel = (records: AttendanceRecord[]): boolean => {
  if (records.length === 0) {
    alert('لا توجد سجلات للتصدير');
    return false;
  }

  try {
    // Prepare data for Excel
    const excelData = records.map((record, index) => ({
      'الرقم': index + 1,
      'رمز الطالب': record.studentCode,
      'اسم الطالب': record.studentName,
      'التاريخ': record.date,
      'الوقت': record.time,
    }));

    // Create worksheet
    const ws = utils.json_to_sheet(excelData);

    // Set column widths
    ws['!cols'] = [
      { wch: 10 },  // الرقم
      { wch: 15 },  // رمز الطالب
      { wch: 30 },  // اسم الطالب
      { wch: 15 },  // التاريخ
      { wch: 15 },  // الوقت
    ];

    // Create workbook
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, 'سجل الحضور');

    // Generate file name with current date
    const now = new Date();
    const fileName = `سجل_الحضور_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.xlsx`;

    // Save file
    writeFile(wb, fileName);
    return true;
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    return false;
  }
};

export const exportToCSV = (records: AttendanceRecord[]): boolean => {
  if (records.length === 0) {
    alert('لا توجد سجلات للتصدير');
    return false;
  }

  try {
    // Create CSV content with BOM for Arabic support
    const BOM = '\uFEFF';
    const headers = ['الرقم', 'رمز الطالب', 'اسم الطالب', 'التاريخ', 'الوقت'];
    const csvRows = [headers.join(',')];

    records.forEach((record, index) => {
      const row = [
        index + 1,
        record.studentCode,
        `"${record.studentName}"`,
        record.date,
        record.time
      ];
      csvRows.push(row.join(','));
    });

    const csvContent = BOM + csvRows.join('\n');

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const now = new Date();
    const fileName = `سجل_الحضور_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.csv`;
    
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    return true;
  } catch (error) {
    console.error('Error exporting to CSV:', error);
    return false;
  }
};

export const shareAsText = (records: AttendanceRecord[]): void => {
  if (records.length === 0) {
    alert('لا توجد سجلات للمشاركة');
    return;
  }

  const text = records.map((record, index) => 
    `${index + 1}. ${record.studentName} (${record.studentCode}) - ${record.date} ${record.time}`
  ).join('\n');

  const fullText = `سجل الحضور\n${'='.repeat(50)}\n\n${text}\n\nإجمالي: ${records.length} طالب`;

  if (navigator.share) {
    navigator.share({
      title: 'سجل الحضور',
      text: fullText,
    }).catch((error) => {
      console.error('Error sharing:', error);
      copyToClipboard(fullText);
    });
  } else {
    copyToClipboard(fullText);
  }
};

const copyToClipboard = (text: string): void => {
  navigator.clipboard.writeText(text).then(() => {
    alert('تم نسخ السجل! يمكنك الآن لصقه في أي مكان.');
  }).catch(() => {
    // Fallback method
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      alert('تم نسخ السجل! يمكنك الآن لصقه في أي مكان.');
    } catch (err) {
      alert('حدث خطأ أثناء النسخ');
    }
    document.body.removeChild(textArea);
  });
};
