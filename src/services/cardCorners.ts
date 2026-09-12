// ─────────────────────────────────────────────────────────────
// كاشف زوايا البطاقة — OpenCV.js في المتصفح
// يبحث في كل إطار عن أكبر رباعي بنسبة أبعاد قريبة من بطاقة الهوية
// (85.6×53.98 ≈ 1.586) ويعيد زواياه الأربع بإحداثيات الفيديو
// ─────────────────────────────────────────────────────────────
import type { OCVCV, OCVMat, OCVPoint } from './opencvTypes';

export const CARD_RATIO = 85.6 / 53.98;
const RATIO_TOL = 0.42;
const MIN_AREA_RATIO = 0.12;
const MAX_AREA_RATIO = 0.9;

export interface QuadCorners {
  topLeft: OCVPoint;
  topRight: OCVPoint;
  bottomRight: OCVPoint;
  bottomLeft: OCVPoint;
  width: number;
  height: number;
  area: number;
  ratio: number;
}

interface RankedQuad {
  quad: OCVMat;
  area: number;
  ratio: number;
  rect: { x: number; y: number; width: number; height: number };
}

function orderPoints(quad: OCVMat): QuadCorners {
  const pts: OCVPoint[] = [];
  for (let i = 0; i < quad.rows; i++) {
    pts.push({ x: quad.data32S[i * 2], y: quad.data32S[i * 2 + 1] });
  }

  // ترتيب: علوي-يسار، علوي-يمين، سفلي-يمين، سفلي-يسار
  const sum = pts.map(pt => ({ pt, v: pt.x + pt.y }));
  const diff = pts.map(pt => ({ pt, v: pt.x - pt.y }));
  const topLeft = sum.reduce((a, b) => (b.v < a.v ? b : a)).pt;
  const bottomRight = sum.reduce((a, b) => (b.v > a.v ? b : a)).pt;
  const topRight = diff.reduce((a, b) => (b.v > a.v ? b : a)).pt;
  const bottomLeft = diff.reduce((a, b) => (b.v < a.v ? b : a)).pt;

  const width = Math.max(
    Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y),
    Math.hypot(bottomRight.x - bottomLeft.x, bottomRight.y - bottomLeft.y)
  );
  const height = Math.max(
    Math.hypot(bottomLeft.y - topLeft.y, bottomLeft.x - topLeft.x),
    Math.hypot(bottomRight.y - topRight.y, bottomRight.x - topRight.x)
  );

  return {
    topLeft, topRight, bottomRight, bottomLeft,
    width, height,
    area: width * height || 0,
    ratio: width / height || 0,
  };
}

/**
 * يبحث عن أقوى رباعي بطاقة في إطار الفيديو.
 * @param cv  مثيل OpenCV الجاهز
 * @param frame  إطار بالفيديو (BGR أو RGBA — يُحوَّل داخلياً للرمادي)
 * @returns زوايا البطاقة بإحداثيات الفيديو، أو null إن لم يُعثر عليها
 */
export function detectCardCorners(
  cv: OCVCV,
  frame: OCVMat,
): QuadCorners | null {
  const gray = new cv.Mat(frame.rows, frame.cols, cv.COLOR_BGR2GRAY);
  const edges = new cv.Mat();
  try {
    cv.cvtColor(frame, gray, cv.COLOR_BGR2GRAY);
    cv.GaussianBlur(gray, gray, { width: 5, height: 5 }, 0);
    cv.Canny(gray, edges, 60, 160);

    const contours: OCVMat[] = [];
    const hierarchy = new cv.Mat();
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const frameArea = frame.rows * frame.cols;
    const ranked: RankedQuad[] = [];

    for (let i = 0; i < contours.length; i++) {
      const perimeter = cv.arcLength(contours[i], true);
      if (perimeter < 100) continue;

      const approx = new cv.Mat();
      cv.approxPolyDP(contours[i], approx, 0.025 * perimeter, true);

      if (approx.rows === 4) {
        const area = cv.contourArea(approx);
        const areaRatio = area / frameArea;
        if (areaRatio < MIN_AREA_RATIO || areaRatio > MAX_AREA_RATIO) {
          approx.delete();
          continue;
        }

        const { ratio } = orderPoints(approx);
        const ratioOk = ratio > CARD_RATIO - RATIO_TOL && ratio < CARD_RATIO + RATIO_TOL;
        if (!ratioOk) {
          approx.delete();
          continue;
        }

        const rect = cv.boundingRect(approx);
        ranked.push({ quad: approx, area, ratio, rect });
      } else {
        approx.delete();
      }
    }

    if (ranked.length === 0) {
      hierarchy.delete();
      return null;
    }

    // الأفضل: مساحة أكبر × قرب النسبة من المثالية
    ranked.sort((a, b) => {
      const scoreA = a.area * (1 - Math.abs(a.ratio - CARD_RATIO) / CARD_RATIO);
      const scoreB = b.area * (1 - Math.abs(b.ratio - CARD_RATIO) / CARD_RATIO);
      return scoreB - scoreA;
    });

    const best = ranked[0];
    const result = orderPoints(best.quad);

    for (const r of ranked) if (r.quad !== best.quad) r.quad.delete();
    hierarchy.delete();

    return result;
  } finally {
    gray.delete();
    edges.delete();
  }
}