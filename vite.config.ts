import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // ❌ احذف viteSingleFile - يخرّب على Vercel والموبايل
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    target: "esnext",
    // ✅ تقسيم ذكي للملفات لتسريع التحميل
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'firebase-vendor': ['firebase/app', 'firebase/auth', 'firebase/database'],
          'face-api': ['face-api.js'],
          'xlsx': ['xlsx-js-style'],
        },
      },
    },
    chunkSizeWarningLimit: 1500,
  },
});