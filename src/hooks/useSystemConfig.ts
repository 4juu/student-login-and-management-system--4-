import { useState, useEffect } from 'react';
import { getCurrentAcademicYear, loadSystemTitle } from '../firebase/dataService';

function useSystemConfig() {
  const currentAcademicYear = getCurrentAcademicYear();
  const [systemTitle, setSystemTitle] = useState('نظام إدارة الحضور الجامعي');

  useEffect(() => {
    loadSystemTitle().then(title => {
      if (title) setSystemTitle(title);
    });
  }, []);

  return { systemTitle, setSystemTitle, currentAcademicYear };
}

export default useSystemConfig;
