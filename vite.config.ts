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
    // �?O U,O USU^O�O_ viteSingleFile U�U+O!
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
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom')) return 'react-vendor';
            if (id.includes('firebase')) return 'firebase-vendor';
            if (id.includes('xlsx') || id.includes('xlsx-js-style')) return 'xlsx';
            if (id.includes('lucide-react')) return 'icons';
          }
        },
      },
    },
    chunkSizeWarningLimit: 1500,
  },
});