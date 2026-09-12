// ─────────────────────────────────────────────────────────────
// تقويم المنظور — يحوّل الصورة المائلة للبطاقة إلى صورة أمامية
// مسطحة بنسبة أبعاد البطاقة الحقيقية (85.6×53.98) بدقة عالية
// ─────────────────────────────────────────────────────────────
import type { OCVCV, OCVMat, OCVPoint } from './opencvTypes';
import { CARD_RATIO } from './cardCorners';

export interface DewarpResult {
  file: File;
  width: number;
  height: number;
  blob: Blob;
}

const normPoint = (p: OCVPoint) => ({ x: p.x, y: p.y });

/**
 * يقوّم منظور صورة البطاقة من الإطار الكامل.
 * @param cv  مثيل OpenCV الجاهز
 * @param fullFrame  الإطار الكامل (قبل التحويل للرمادي)
 * @param corners  زوايا البطاقة بإحداثيات الفيديو
 * @param scaleTarget  العرض المستهدف للإخراج (بكسل)
 */
export async function dewarpCard(
  cv: OCVCV,
  fullFrame: OCVMat,
  corners: { topLeft: OCVPoint; topRight: OCVPoint; bottomRight: OCVPoint; bottomLeft: OCVPoint },
  scaleTarget = 1400,
): Promise<DewarpResult> {
  const outW = Math.max(640, Math.round(scaleTarget));
  const outH = Math.max(403, Math.round(outW / CARD_RATIO));

  // مساحة المصدر والوجهة (نقاط 2D float)
  const srcMat = new cv.Mat(4, 1, cv.CV_32FC2);
  const dstMat = new cv.Mat(4, 1, cv.CV_32FC2);

  // مصفوفة التحويل المنظوري 3×3
  let transform: OCVMat | null = null;
  const warped = new cv.Mat(outH, outW, fullFrame.type());

  try {
    const srcPts = [
      normPoint(corners.topLeft),
      normPoint(corners.topRight),
      normPoint(corners.bottomRight),
      normPoint(corners.bottomLeft),
    ];
    const dstPts = [
      { x: 0, y: 0 },
      { x: outW, y: 0 },
      { x: outW, y: outH },
      { x: 0, y: outH },
    ];

    for (let i = 0; i < 4; i++) {
      srcMat.data32F[i * 2] = srcPts[i].x;
      srcMat.data32F[i * 2 + 1] = srcPts[i].y;
      dstMat.data32F[i * 2] = dstPts[i].x;
      dstMat.data32F[i * 2 + 1] = dstPts[i].y;
    }

    transform = cv.getPerspectiveTransform(srcMat as any, dstMat as any);
    cv.warpPerspective(fullFrame, warped, transform, { width: outW, height: outH });

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    cv.imshow(canvas, warped);

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('فشل تحويل الصورة المقوّمة'))), 'image/jpeg', 0.92);
    });

    const file = new File([blob], 'id-card-dewarped.jpg', { type: 'image/jpeg', lastModified: Date.now() });
    return { file, width: outW, height: outH, blob };
  } finally {
    srcMat.delete();
    dstMat.delete();
    if (transform && transform.delete) transform.delete();
    warped.delete();
  }
}