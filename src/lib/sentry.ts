// 📡 تهيئة Sentry — تُستدعى فقط في الإنتاج وعند توفر VITE_SENTRY_DSN.
// بدون DSN يكون كل شيء no-op (لا تبعات على الحجم في التطوير).

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  if (!import.meta.env.PROD) return;

  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  import('@sentry/react')
    .then((Sentry) => {
      Sentry.init({
        dsn,
        environment: import.meta.env.MODE,
        tracesSampleRate: 0.1,
        ignoreErrors: [
          // أخطاء شائعة غير خطيرة من المتصفحات/الأدوبي extensions
          'ResizeObserver loop',
          'Non-Error exception captured',
        ],
      });
      initialized = true;
    })
    .catch(() => {
      /* Sentry غير متاح — نُهمل بصمت */
    });
}

export function captureException(
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  if (!import.meta.env.PROD) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  import('@sentry/react')
    .then((Sentry) => {
      Sentry.captureException(error, extra ? { extra } : undefined);
    })
    .catch(() => {
      /* غير متاح — نُهمل */
    });
}

export function captureMessage(message: string): void {
  if (!import.meta.env.PROD) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  import('@sentry/react')
    .then((Sentry) => {
      Sentry.captureMessage(message);
    })
    .catch(() => {
      /* غير متاح — نُهمل */
    });
}
