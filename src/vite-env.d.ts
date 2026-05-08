/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HF_TOKEN: string;
  readonly VITE_GEMINI_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}