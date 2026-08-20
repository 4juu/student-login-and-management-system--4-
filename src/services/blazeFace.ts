import * as tf from '@tensorflow/tfjs';
import * as blazeface from '@tensorflow-models/blazeface';

const MODEL_URL = '/models/blazeface/model.json';

let model: blazeface.BlazeFaceModel | null = null;
let loading = false;
let loadPromise: Promise<blazeface.BlazeFaceModel> | null = null;

export const isBlazeFaceReady = (): boolean => model !== null;

export const loadBlazeFace = async (): Promise<blazeface.BlazeFaceModel> => {
  if (model) return model;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    loading = true;
    try {
      model = await blazeface.load({
        modelUrl: MODEL_URL,
        maxFaces: 3,
        scoreThreshold: 0.5,
      });
      return model;
    } finally {
      loading = false;
      loadPromise = null;
    }
  })();

  return loadPromise;
};

export interface BlazeFaceDetection {
  box: { x: number; y: number; width: number; height: number };
  score: number;
}

export const detectFacesBlaze = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  flipHorizontal = false
): Promise<BlazeFaceDetection[]> => {
  if (!model) return [];

  const vw = 'videoWidth' in input ? (input as HTMLVideoElement).videoWidth : (input as HTMLCanvasElement | HTMLImageElement).width;
  const vh = 'videoHeight' in input ? (input as HTMLVideoElement).videoHeight : (input as HTMLCanvasElement | HTMLImageElement).height;

  const predictions = await model.estimateFaces(input, false, flipHorizontal);

  return predictions.map(p => {
    const tl = Array.isArray(p.topLeft) ? p.topLeft : [0, 0];
    const br = Array.isArray(p.bottomRight) ? p.bottomRight : [0, 0];
    const prob = Array.isArray(p.probability) ? p.probability[0] : (p.probability ?? 0);
    return {
      box: {
        x: tl[0],
        y: tl[1],
        width: br[0] - tl[0],
        height: br[1] - tl[1],
      },
      score: prob,
    };
  });
};

export const disposeBlazeFace = (): void => {
  if (model) {
    model.dispose();
    model = null;
  }
};
