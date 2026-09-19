import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { compression } from "vite-plugin-compression2";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🌐 رابط الموقع الكامل لوسوم المعاينة (og:image لازم رابط مطلق)
// الأولوية: VITE_SITE_URL ثم CF_PAGES_URL (يوفّرها Cloudflare Pages وقت البناء)
const SITE_URL = (
  process.env.VITE_SITE_URL ||
  process.env.CF_PAGES_URL ||
  ''
).replace(/\/+$/, '');

// 🎨 عناصر OG المخصصة لكل صفحة
const OG_CONFIG: Record<string, { title: string; desc: string; url: string }> = {
  'attendance.html': {
    title: 'تقرير الحضور والغياب',
    desc: 'سجّل حضورك وتابع غيابك في محاضراتك — نظام الحضور الذكي.',
    url: '/attendance.html',
  },
  'register.html': {
    title: 'سجّل بصمتك الآن',
    desc: 'سجّل بصمة وجهك في نظام الحضور الذكي — الخطوة الأولى لتسجيل حضورك.',
    url: '/register.html',
  },
  'face-test.html': {
    title: 'اختبر بصمة وجهك',
    desc: 'اختبر إذا بصمتك تعمل في نظام الحضور — افتح الرابط واختبر عبر الكاميرا.',
    url: '/face-test.html',
  },
};

function injectSiteUrl() {
  return {
    name: 'inject-site-url',
    transformIndexHtml(html: string, ctx: { filename: string }) {
      let result = html.replace(/%SITE_URL%/g, SITE_URL);
      // حقن عناصر OG الخاصة لكل ملف HTML
      const fileName = ctx.filename.split(/[/\\]/).pop() || '';
      const og = OG_CONFIG[fileName];
      if (og) {
        result = result.replace(/%OG_TITLE%/g, og.title);
        result = result.replace(/%OG_DESC%/g, og.desc);
      } else {
        // index.html — إزالة أي placeholders متبقية
        result = result.replace(/%OG_TITLE%/g, 'نظام الحضور الذكي');
        result = result.replace(/%OG_DESC%/g, 'نظام إدارة الحضور والغياب بالتعرف على الوجه.');
      }
      return result;
    },
  };
}

export default defineConfig({
  // 🆕 إصدار فريد لكل بناء — يقارن التطبيق به لكشف أي نشر جديد قسرياً
  define: {
    __APP_VERSION__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    injectSiteUrl(),
    // 🗜️ ضغط مسبق gzip + brotli لجميع الأصول المبنية
    compression({ algorithms: ['gzip', 'brotliCompress'], threshold: 1024 }),
  ],
  publicDir: 'src/public',
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'],
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        attendance: path.resolve(__dirname, 'attendance.html'),
        register: path.resolve(__dirname, 'register.html'),
        'face-test': path.resolve(__dirname, 'face-test.html'),
      },
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'firebase-vendor': ['firebase/app', 'firebase/auth', 'firebase/database'],
          'face-engine': ['onnxruntime-web/webgpu'],
          'xlsx': ['xlsx-js-style'],
          'icons': ['lucide-react'],
        },
      },
    },
    chunkSizeWarningLimit: 1500,
  },
});