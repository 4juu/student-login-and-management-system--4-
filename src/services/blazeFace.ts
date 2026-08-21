import * as tf from '@tensorflow/tfjs';
import * as blazeface from '@tensorflow-models/blazeface';

const MODEL_URL = '/models/blazeface/model.json';

let model: blazeface.BlazeFaceModel | null = null;
let loading = false;
let loadPromise: Promise<blazeface.BlazeFaceModel> | null = null;
let backendFailed = false;

export const isBlazeFaceReady = (): boolean => model !== null;

async function ensureBackend(): Promise<void> {
  const current = tf.getBackend();
  if (current && current !== 'cpu' && !backendFailed) return;

  try {
    await tf.setBackend('webgl');
    await tf.ready();
    backendFailed = false;
  } catch {
    try {
      await tf.setBackend('cpu');
      await tf.ready();
      backendFailed = true;
    } catch {}
  }
}

export const loadBlazeFace = async (): Promise<blazeface.BlazeFaceModel> => {
  if (model) return model;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    loading = true;
    try {
      await ensureBackend();
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

  try {
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
  } catch (e: any) {
    if (e?.message?.includes('shader') || e?.message?.includes('link')) {
      console.warn('WebGL shader error, attempting CPU fallback:', e.message);
      try {
        await tf.setBackend('cpu');
        await tf.ready();
        backendFailed = true;
        if (model) {
          const predictions = await model.estimateFaces(input, false, flipHorizontal);
          return predictions.map(p => {
            const tl = Array.isArray(p.topLeft) ? p.topLeft : [0, 0];
            const br = Array.isArray(p.bottomRight) ? p.bottomRight : [0, 0];
            const prob = Array.isArray(p.probability) ? p.probability[0] : (p.probability ?? 0);
            return {
              box: { x: tl[0], y: tl[1], width: br[0] - tl[0], height: br[1] - tl[1] },
              score: prob,
            };
          });
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
