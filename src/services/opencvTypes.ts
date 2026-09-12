// ─────────────────────────────────────────────────────────────
// Types محلية مبسطّة لمكتبة OpenCV.js — تغطي فقط الواجهة المستخدمة
// في كشف زوايا البطاقة وتقويم المنظور. تُحذف كلياً من الحزمة النهائية
// (import type فقط) فلا تُضيف أي حجم للملفات.
// ─────────────────────────────────────────────────────────────

export interface OCVMat {
  rows: number;
  cols: number;
  data: Uint8Array;
  data8S: Int8Array;
  data16S: Int16Array;
  data16U: Uint16Array;
  data32S: Int32Array;
  data32F: Float32Array;
  data64F: Float64Array;
  type(): number;
  delete(): void;
}

export interface OCVPoint {
  x: number;
  y: number;
}

export interface OCVSize {
  width: number;
  height: number;
}

export interface OCVCV {
  Mat: new (rows?: number, cols?: number, type?: number) => OCVMat;
  imread(source: HTMLImageElement | HTMLCanvasElement): OCVMat;
  imshow(canvas: HTMLCanvasElement, mat: OCVMat): void;
  cvtColor(src: OCVMat, dst: OCVMat, code: number): void;
  GaussianBlur(src: OCVMat, dst: OCVMat, ksize: OCVSize, sigmaX: number): void;
  Canny(src: OCVMat, dst: OCVMat, threshold1: number, threshold2: number): void;
  findContours(
    image: OCVMat,
    contours: OCVMat[],
    hierarchy: OCVMat,
    mode: number,
    method: number
  ): void;
  approxPolyDP(
    curve: OCVMat,
    approxCurve: OCVMat,
    epsilon: number,
    closed: boolean
  ): void;
  contourArea(contour: OCVMat): number;
  arcLength(curve: OCVMat, closed: boolean): number;
  boundingRect(array: OCVMat): { x: number; y: number; width: number; height: number };
  pointPolygonTest(
    contour: OCVMat,
    pt: OCVPoint,
    measureDist: boolean
  ): number;
  getPerspectiveTransform(src: OCVMat, dst: OCVMat): OCVMat;
  warpPerspective(
    src: OCVMat,
    dst: OCVMat,
    M: OCVMat,
    dsize: OCVSize
  ): void;
  drawContours(
    image: OCVMat,
    contours: OCVMat[],
    contourIdx: number,
    color: OCVScalar,
    thickness: number
  ): void;
  threshold(
    src: OCVMat,
    dst: OCVMat,
    thresh: number,
    maxval: number,
    type: number
  ): number;
  resize(
    src: OCVMat,
    dst: OCVMat,
    dsize: OCVSize,
    fx: number,
    fy: number,
    interpolation: number
  ): void;
  rectangle(
    img: OCVMat,
    pt1: OCVPoint,
    pt2: OCVPoint,
    color: OCVScalar,
    thickness: number
  ): void;
  onRuntimeInitialized: (() => void) | null;
  // ثوابت واجهة
  COLOR_BGR2GRAY: number;
  COLOR_RGBA2BGR: number;
  CHAIN_APPROX_SIMPLE: number;
  RETR_LIST: number;
  RETR_EXTERNAL: number;
  INTER_LINEAR: number;
  CV_32FC1: number;
  CV_32FC2: number;
  CV_8UC4: number;
}

export interface OCVScalar {
  val: number[];
}