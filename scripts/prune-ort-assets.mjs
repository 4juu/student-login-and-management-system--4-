// يحذف نسخة ort-wasm-simd-threaded.wasm المكررة من dist/assets
// النسخة الرسمية تعيش في dist/ort/ (منسوخة من public) — الـ worker يحمّلها من هناك
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const assetsDir = join(process.cwd(), 'dist', 'assets');
let removed = 0;

try {
  for (const name of readdirSync(assetsDir)) {
    if (/^ort-wasm.*\.wasm$/i.test(name)) {
      unlinkSync(join(assetsDir, name));
      removed++;
    }
  }
} catch (err) {
  if (statSync(assetsDir, { throwIfNoEntry: false }) === undefined) {
    console.error('[prune] dist/assets غير موجود — شغّل vite build أولاً');
    process.exit(1);
  }
  console.error('[prune] خطأ:', err);
  process.exit(1);
}

console.log(removed > 0 ? `[prune] removed ${removed} duplicate ORT wasm asset(s)` : '[prune] nothing to remove');
