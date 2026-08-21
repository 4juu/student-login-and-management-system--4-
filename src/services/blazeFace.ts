import * as blazeface from '@tensorflow-models/blazeface';
import { initBackend, fallbackToCPU } from './tfBackend';

const MODEL_URL = '/models/blazeface/model.json';

let model: blazeface.BlazeFaceModel | null = null;
let loadPromise: Promise<blazeface.BlazeFaceModel> | null = null;

export const isBlazeFaceReady = (): boolean => model !== null;

export const loadBlazeFace = async (): Promise<blazeface.BlazeFaceModel> => {
  if (model) return model;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    await initBackend();
    model = await blazeface.load({
      modelUrl: MODEL_URL,
      maxFaces: 3,
      scoreThreshold: 0.5,
    });
    return model;
  })();

  return loadPromise;
};

export interface BlazeFaceDetection {
  box: { x: number; y: number; width: number; height: number };
  score: number;
}

const mapPredictions = (predictions: any[]): BlazeFaceDetection[] =>
  predictions.map(p => {
    const tl = Array.isArray(p.topLeft) ? p.topLeft : [0, 0];
    const br = Array.isArray(p.bottomRight) ? p.bottomRight : [0, 0];
    const prob = Array.isArray(p.probability) ? p.probability[0] : (p.probability ?? 0);
    return {
      box: { x: tl[0], y: tl[1], width: br[0] - tl[0], height: br[1] - tl[1] },
      score: prob,
    };
  });

export const detectFacesBlaze = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  flipHorizontal = false
): Promise<BlazeFaceDetection[]> => {
  if (!model) return [];

  try {
    const predictions = await model.estimateFaces(input, false, flipHorizontal);
    return mapPredictions(predictions);
  } catch (e: any) {
    if (e?.message?.includes('shader') || e?.message?.includes('link') || e?.message?.includes('WebGL')) {
      try {
        await fallbackToCPU();
        if (model) {
          const predictions = await model.estimateFaces(input, false, flipHorizontal);
          return mapPredictions(predictions);
        }
      } catch {}
    }
    return [];
  }
};

export const disposeBlazeFace = (): void => {
  if (model) {
    model.dispose();
    model = null;
  }
};
