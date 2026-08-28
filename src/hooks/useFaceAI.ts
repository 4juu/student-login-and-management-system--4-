// hook موحد لمحرك الوجه الجديد — كاشف MediaPipe + عامل البصمات معاً
import { useEffect, useState, useCallback } from 'react';
import { faceDetectorService, type DetectorProgress } from '../services/faceAI/detector';
import { faceEmbedder, type EngineProgress } from '../services/faceAI/embedder';

export interface UseFaceAIResult {
  ready: boolean;
  progress: { percent: number; detail: string };
  error: string | null;
  retry: () => void;
}

function combine(det: DetectorProgress, emb: EngineProgress): { percent: number; detail: string } {
  // الكاشف 0-50%، البصمات 50-100%
  const detPct = (det.percent / 100) * 50;
  const embPct = det.stage === 'done' ? (emb.percent / 100) * 50 : 0;
  return {
    percent: Math.round(detPct + embPct),
    detail: det.stage !== 'done' ? det.detail : emb.detail,
  };
}

export function useFaceAI(enabled = true): UseFaceAIResult {
  const [ready, setReady] = useState(false);
  const [detProg, setDetProg] = useState<DetectorProgress>({ stage: 'wasm', percent: 0, detail: '...' });
  const [embProg, setEmbProg] = useState<EngineProgress>({ stage: 'model', percent: 0, detail: '...' });
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return;
    }

    faceDetectorService.reset();
    faceEmbedder.dispose();
    setReady(false);
    setError(null);
    setDetProg({ stage: 'wasm', percent: 0, detail: 'تهيئة محرك الوجه...' });
    setEmbProg({ stage: 'model', percent: 0, detail: '...' });

    let cancelled = false;
    const offDet = faceDetectorService.onProgress(setDetProg);
    const offEmb = faceEmbedder.onProgress(setEmbProg);

    Promise.all([faceDetectorService.ensureReady(), faceEmbedder.ensureReady()])
      .then(() => { if (!cancelled) setReady(true); })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
      offDet();
      offEmb();
    };
  }, [enabled, attempt]);

  const reinit = useCallback(() => {
    if (!enabled) return;
    faceDetectorService.reset();
    faceEmbedder.dispose();
    setReady(false);
    setError(null);
    setDetProg({ stage: 'wasm', percent: 0, detail: 'تهيئة محرك الوجه...' });
    setEmbProg({ stage: 'model', percent: 0, detail: '...' });
    setAttempt(a => a + 1);
  }, [enabled]);

  return { ready, progress: combine(detProg, embProg), error, retry: reinit };
}
