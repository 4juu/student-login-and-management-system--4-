// ============================================================
// 📦 فحص ميزانية الحزمة — يفشل (exit 1) إذا تجاوزت الأحجام الحدود
// - يقرأ dist/assets/*.js و *.css ويحسب أحجام gzip (zlib)
// - الحد الأولي (JS+CSS المحمّلة في index.html): 200KB gzip
// - حد الإجمالي (كل JS+CSS في dist/assets): 1200KB gzip
// الاستخدام: npm run build && npm run check-bundle
// ============================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const INITIAL_LIMIT = 200 * 1024; // 200KB gzip للحزمة الأولية
const TOTAL_LIMIT = 1200 * 1024; // 1200KB gzip للإجمالي (firebase+xlsx+qr)

const assetsDir = join(process.cwd(), 'dist', 'assets');
const indexPath = join(process.cwd(), 'dist', 'index.html');

const fmt = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

let files;
try {
  files = readdirSync(assetsDir).filter((f) => /\.(js|css)$/.test(f));
} catch {
  console.error('[check-bundle] dist/assets غير موجود — شغّل npm run build أولاً');
  process.exit(1);
}

// الحزمة الأولية = الأصول المشار إليها مباشرة في dist/index.html
let initialNames = new Set();
try {
  const html = readFileSync(indexPath, 'utf8');
  for (const m of html.matchAll(/(?:src|href)="\/assets\/([^"]+\.(?:js|css))"/g)) {
    initialNames.add(m[1]);
  }
} catch {
  console.error('[check-bundle] dist/index.html غير موجود — شغّل npm run build أولاً');
  process.exit(1);
}

const rows = [];
let initialGzip = 0;
let totalGzip = 0;

for (const name of files) {
  const filePath = join(assetsDir, name);
  const raw = statSync(filePath).size;
  const gzip = gzipSync(readFileSync(filePath)).length;
  const isInitial = initialNames.has(name);
  if (isInitial) initialGzip += gzip;
  totalGzip += gzip;
  rows.push({ name, raw, gzip, isInitial });
}

rows.sort((a, b) => b.gzip - a.gzip);

console.log('\n📦 حجم أصول dist/assets (مُرتّبة تنازلياً حسب gzip):\n');
console.log('  الحجم الأصلي   gzip      النوع       الملف');
console.log('  ' + '-'.repeat(84));
for (const r of rows) {
  console.log(
    `  ${fmt(r.raw).padStart(10)}   ${fmt(r.gzip).padStart(8)}   ${r.isInitial ? '★ أولي' : '  تبعي'}   ${r.name}`,
  );
}
console.log('  ' + '-'.repeat(84));
console.log(`  الإجمالي:             ${fmt(totalGzip)} gzip (${rows.length} ملف)`);
console.log(`  الأولي (index.html):  ${fmt(initialGzip)} gzip\n`);

let failed = false;
const results = [];

if (initialGzip > INITIAL_LIMIT) {
  results.push(`❌ الحزمة الأولية تجاوزت الميزانية: ${fmt(initialGzip)} > ${fmt(INITIAL_LIMIT)} gzip`);
  failed = true;
} else {
  results.push(`✅ الحزمة الأولية ضمن الميزانية: ${fmt(initialGzip)} ≤ ${fmt(INITIAL_LIMIT)} gzip`);
}

if (totalGzip > TOTAL_LIMIT) {
  results.push(`❌ إجمالي الحزمة تجاوز الميزانية: ${fmt(totalGzip)} > ${fmt(TOTAL_LIMIT)} gzip`);
  failed = true;
} else {
  results.push(`✅ إجمالي الحزمة ضمن الميزانية: ${fmt(totalGzip)} ≤ ${fmt(TOTAL_LIMIT)} gzip`);
}

for (const line of results) console.log(line);

process.exit(failed ? 1 : 0);
