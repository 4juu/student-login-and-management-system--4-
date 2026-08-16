import { useEffect, useState, useCallback } from 'react';
import {
  areModelsLoaded,
  isDetectorReady,
  onModelProgress,
  loadModelsWithProgress,
  startBackgroundPreload,
  type LoadProgressInfo,
} from '../services/faceRecognition';

export interface UseFaceModelsResult {
  loaded: boolean;
  detectorReady: boolean;
  progress: LoadProgressInfo;
  startLoading: () => Promise<void>;
}

export function useFaceModels(): UseFaceModelsResult {
  const [loaded, setLoaded] = useState(areModelsLoaded());
  const [detectorReady, setDetectorReady] = useState(isDetectorReady());
  const [progress, setProgress] = useState<LoadProgressInfo>({
    stage: 'detector',
    stageIndex: 0,
    percent: 0,
    detail: 'جاري تحميل الموديلات...',
  });

  useEffect(() => {
    // Start background preload if not started
    if (!areModelsLoaded() && !isDetectorReady()) {
      startBackgroundPreload();
    }

    const unsub = onModelProgress((info) => {
      setProgress(info);
      setLoaded(info.stage === 'done');
      setDetectorReady(info.stageIndex >= 0 && info.percent > 10);
    });

    return unsub;
  }, []);

  const startLoading = useCallback(async () => {
    if (areModelsLoaded()) return;
    try {
      await loadModelsWithProgress();
    } catch (e) {
      console.warn('Model loading failed:', e);
    }
  }, []);

  return { loaded, detectorReady, progress, startLoading };
}
