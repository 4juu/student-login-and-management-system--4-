// ─────────────────────────────────────────────────────────────
// متتبّع الوجوه عبر IOU — يربط صندوق الوجه بين الفريمات المتتالية
// بدون الحاجة لإعادة حساب embedding كل مرة، ويتيح تنعيم حقيقي
// لكل وجه على حدة حتى لو كان في عدة وجوه بنفس اللحظة
// ─────────────────────────────────────────────────────────────

export interface TrackBox {
  x: number; y: number; width: number; height: number;
  keypoints?: { x: number; y: number }[] | undefined;
}

interface Track {
  id: number;
  box: TrackBox;
  missedFrames: number;
  embeddingBuffer: Float32Array[];
  smoothedEmbedding: Float32Array | null;
  lastEmbedTime: number;
  lastEmbedBox: TrackBox | null;
  cachedMatchId: string | null;
  cachedConfidence: number;
  confirmCount: number;
  // ── #6: Velocity prediction ──
  velocityX: number;
  velocityY: number;
  lastBoxTime: number;
  // #1.4: Motion tracking — كشف الوجوه الساكنة (صور/جدران)
  positionHistory: Array<{ cx: number; cy: number }>;
  // #1.5: حماية من المطابقة المزدوجة — عدد مرات تغيّر المطابقة
  matchChanges: number;
}

function iou(a: TrackBox, b: TrackBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const interArea = interW * interH;
  const unionArea = a.width * a.height + b.width * b.height - interArea;
  return unionArea <= 0 ? 0 : interArea / unionArea;
}

/** فرق نسبي بين صندوقين — يُستخدم لتحديد هل الوجه "تحرك كثير" */
export function boxDelta(a: TrackBox, b: TrackBox): number {
  const cxA = a.x + a.width / 2, cyA = a.y + a.height / 2;
  const cxB = b.x + b.width / 2, cyB = b.y + b.height / 2;
  const dx = Math.abs(cxA - cxB) / a.width;
  const dy = Math.abs(cyA - cyB) / a.height;
  const dSize = Math.abs(a.width - b.width) / a.width;
  return Math.max(dx, dy, dSize);
}

export class FaceTracker {
  private tracks: Track[] = [];
  private nextId = 1;
  private readonly IOU_THRESHOLD = 0.3;
  private readonly MAX_MISSED = 6;
  private readonly BUFFER_SIZE = 4;

  /** استدعِها كل فريم بعد الكشف — قبل حساب أي embedding */
  update(detections: TrackBox[]): Array<{ trackId: number; box: TrackBox; isNew: boolean }> {
    const matched = new Set<number>();
    const results: Array<{ trackId: number; box: TrackBox; isNew: boolean }> = [];

    // ── #6: Predict positions for missed tracks ──
    const now = performance.now();
    for (const track of this.tracks) {
      if (track.missedFrames > 0 && track.lastBoxTime > 0) {
        const dt = (now - track.lastBoxTime) / 1000;
        const predicted: TrackBox = {
          x: track.box.x + track.velocityX * dt,
          y: track.box.y + track.velocityY * dt,
          width: track.box.width,
          height: track.box.height,
        };
        // Use predicted box for IOU matching when face is lost
        if (track.missedFrames <= 3) {
          track.box = { ...predicted, keypoints: track.box.keypoints };
        }
      }
    }

    for (const track of this.tracks) {
      let bestIdx = -1, bestScore = this.IOU_THRESHOLD;
      for (let i = 0; i < detections.length; i++) {
        const det = detections[i];
        if (!det || matched.has(i)) continue;
        const score = iou(track.box, det);
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }
      if (bestIdx >= 0) {
        const bestDet = detections[bestIdx]!;
        matched.add(bestIdx);
        // ── #6: Update velocity ──
        const dt = track.lastBoxTime > 0 ? Math.max(0.016, (now - track.lastBoxTime) / 1000) : 0.05;
        const dx = bestDet.x - track.box.x;
        const dy = bestDet.y - track.box.y;
        track.velocityX = dx / dt * 0.3 + track.velocityX * 0.7; // exponential smoothing
        track.velocityY = dy / dt * 0.3 + track.velocityY * 0.7;

        track.box = bestDet;
        track.missedFrames = 0;
        track.lastBoxTime = now;
        // #1.4: سجل الموضع في السجل (آخر 8 فريمات)
        const cx = track.box.x + track.box.width / 2;
        const cy = track.box.y + track.box.height / 2;
        track.positionHistory.push({ cx, cy });
        if (track.positionHistory.length > 8) track.positionHistory.shift();
        results.push({ trackId: track.id, box: track.box, isNew: false });
      } else {
        track.missedFrames++;
      }
    }

    this.tracks = this.tracks.filter(t => t.missedFrames <= this.MAX_MISSED);

    for (let i = 0; i < detections.length; i++) {
      const det = detections[i];
      if (!det || matched.has(i)) continue;
      const track: Track = {
        id: this.nextId++,
        box: det,
        missedFrames: 0,
        embeddingBuffer: [],
        smoothedEmbedding: null,
        lastEmbedTime: 0,
        lastEmbedBox: null,
        cachedMatchId: null,
        cachedConfidence: 0,
        confirmCount: 0,
        velocityX: 0,
        velocityY: 0,
        lastBoxTime: now,
        positionHistory: [],
        matchChanges: 0,
      };
      this.tracks.push(track);
      results.push({ trackId: track.id, box: track.box, isNew: true });
    }

    return results;
  }

  /** هل يستحق هذا المسار إعادة حساب embedding الآن؟ */
  shouldReembed(trackId: number, nowMs: number, minIntervalMs: number, moveThreshold: number): boolean {
    const t = this.tracks.find(tr => tr.id === trackId);
    if (!t) return true;
    if (!t.lastEmbedBox) return true;
    if (nowMs - t.lastEmbedTime > minIntervalMs) return true;
    return boxDelta(t.box, t.lastEmbedBox) > moveThreshold;
  }

  /** أضف embedding جديد لمسار معيّن، يرجع النسخة المنعّمة */
  addEmbedding(trackId: number, embedding: Float32Array, nowMs: number): Float32Array {
    const t = this.tracks.find(tr => tr.id === trackId);
    if (!t) return embedding;
    t.embeddingBuffer.push(embedding);
    if (t.embeddingBuffer.length > this.BUFFER_SIZE) t.embeddingBuffer.shift();
    t.lastEmbedTime = nowMs;
    t.lastEmbedBox = { ...t.box };

    const dim = embedding.length;
    const avg = new Float32Array(dim);
    for (const e of t.embeddingBuffer) for (let i = 0; i < dim; i++) avg[i] = avg[i]! + e[i]!;
    for (let i = 0; i < dim; i++) avg[i] = avg[i]! / t.embeddingBuffer.length;
    let norm = 0; for (let i = 0; i < dim; i++) norm += avg[i]! * avg[i]!;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) avg[i] = avg[i]! / norm;

    t.smoothedEmbedding = avg;
    return avg;
  }

  getCache(trackId: number) {
    return this.tracks.find(t => t.id === trackId);
  }

  setCache(trackId: number, matchId: string | null, confidence: number) {
    const t = this.tracks.find(tr => tr.id === trackId);
    if (t) { t.cachedMatchId = matchId; t.cachedConfidence = confidence; }
  }

  /** عداد تأكيد المطابقة لنفس الطالب عبر فريمات متتالية */
  bumpConfirm(trackId: number, matchId: string): number {
    const t = this.tracks.find(tr => tr.id === trackId);
    if (!t) return 0;
    if (t.cachedMatchId === matchId) {
      // #1.4: لو الوجه ساكن تماماً → تأكيد أبطأ (احتمال صورة)
      if (this.isStatic(trackId)) {
        t.confirmCount = Math.max(0, t.confirmCount - 1);
      } else {
        t.confirmCount++;
      }
    } else {
      // #1.5: لو المطابقة تغيّرت لأكثر من 3 مرات → مسار غير موثوق
      t.matchChanges++;
      if (t.matchChanges > 3) {
        t.confirmCount = 0;
        return 0;
      }
      t.cachedMatchId = matchId;
      t.confirmCount = 1;
    }
    return t.confirmCount;
  }

  /** أزل مساراً من المتابعة نهائياً — يُستخدم فور تسجيل حضور الطالب لتلاشي إطاره والانتقال لغيره */
  removeTrack(trackId: number) {
    this.tracks = this.tracks.filter(t => t.id !== trackId);
  }

  /** هل ما زال المسار موجوداً؟ */
  hasTrack(trackId: number): boolean {
    return this.tracks.some(t => t.id === trackId);
  }

  // #1.4: هل الوجه ساكن تماماً (احتمال صورة/شاشة)؟
  // يتحقق من تباين موضعمركز الوجه آخر 8 فريمات
  isStatic(trackId: number): boolean {
    const t = this.tracks.find(tr => tr.id === trackId);
    if (!t || t.positionHistory.length < 5) return false;
    const hist = t.positionHistory;
    let sumCx = 0, sumCy = 0;
    for (const p of hist) { sumCx += p.cx; sumCy += p.cy; }
    const meanCx = sumCx / hist.length;
    const meanCy = sumCy / hist.length;
    let varCx = 0, varCy = 0;
    for (const p of hist) {
      varCx += (p.cx - meanCx) * (p.cx - meanCx);
      varCy += (p.cy - meanCy) * (p.cy - meanCy);
    }
    const variance = (varCx + varCy) / hist.length;
    return variance < 0.003;
  }

  /** أزل جميع المسارات وأعد العدّاد */
  reset() { this.tracks = []; this.nextId = 1; }
}
