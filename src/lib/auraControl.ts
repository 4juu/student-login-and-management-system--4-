// ⚡ إيقاف خلفية Aurora أثناء فتح شاشات الكاميرا لتقليل الحرارة
let suspenders = 0;

export const suspendAurora = (): void => {
  suspenders++;
  document.documentElement.dataset.suspendAurora = '1';
};

export const resumeAurora = (): void => {
  suspenders = Math.max(0, suspenders - 1);
  if (suspenders === 0) {
    delete document.documentElement.dataset.suspendAurora;
  }
};
