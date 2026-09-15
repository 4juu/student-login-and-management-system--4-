import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { compression } from "vite-plugin-compression2";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  // 🆕 إصدار فريد لكل بناء — يقارن التطبيق به لكشف أي نشر جديد قسرياً
  define: {
    __APP_VERSION__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    tailwindcss(),
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
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'firebase-vendor': ['firebase/app', 'firebase/auth', 'firebase/database'],
          'face-engine': ['onnxruntime-web/wasm'],
          'xlsx': ['xlsx-js-style'],
          'icons': ['lucide-react'],
        },
      },
    },
    chunkSizeWarningLimit: 1500,
  },
});