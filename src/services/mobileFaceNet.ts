import * as tf from '@tensorflow/tfjs';
import { initBackend, ensureBackend, fallbackToCPU } from './tfBackend';

const MODEL_URL = '/models/mobilefacenet/model.json';
const INPUT_SIZE = 112;
const EMBEDDING_DIM = 192;

let model: tf.GraphModel | null = null;
let loadPromise: Promise<tf.GraphModel> | null = null;

export const getMobileFaceNetModel = (): tf.GraphModel | null => model;
export const isMobileFaceNetReady = (): boolean => model !== null;
export const getEmbeddingDim = () => EMBEDDING_DIM;

export const loadMobileFaceNet = async (): Promise<tf.GraphModel> => {
  if (model) return model;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    await initBackend();
    model = await tf.loadGraphModel(MODEL_URL);
    const dummy = tf.zeros([1, INPUT_SIZE, INPUT_SIZE, 3]);
    try {
      const warmup = model.predict(dummy) as tf.Tensor;
      warmup.dispose();
    } catch {
      await fallbackToCPU();
      const warmup = model.predict(dummy) as tf.Tensor;
      warmup.dispose();
    }
    dummy.dispose();
    return model;
  })();

  return loadPromise;
};

export const cropAndResizeFace = (
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  box: { x: number; y: number; width: number; height: number },
  sourceWidth: number,
  sourceHeight: number
): tf.Tensor4D => {
  const padRatio = 0.2;
  const padX = box.width * padRatio;
  const padY = box.height * padRatio;

  const cropX = Math.max(0, box.x - padX);
  const cropY = Math.max(0, box.y - padY);
  const cropW = Math.min(sourceWidth - cropX, box.width + padX * 2);
  const cropH = Math.min(sourceHeight - cropY, box.height + padY * 2);

  if (cropW <= 0 || cropH <= 0) {
    return tf.zeros([1, INPUT_SIZE, INPUT_SIZE, 3]) as tf.Tensor4D;
  }

  const c = document.createElement('canvas');
  c.width = INPUT_SIZE;
  c.height = INPUT_SIZE;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const imgData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const d = imgData.data;

  const pixels = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3);
  const n = INPUT_SIZE * INPUT_SIZE;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    pixels[i * 3] = d[j] / 255.0;
    pixels[i * 3 + 1] = d[j + 1] / 255.0;
    pixels[i * 3 + 2] = d[j + 2] / 255.0;
  }

  return tf.tensor4d(pixels, [1, INPUT_SIZE, INPUT_SIZE, 3]) as tf.Tensor4D;
};

export const extractEmbedding = async (
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  box: { x: number; y: number; width: number; height: number },
  sourceWidth: number,
  sourceHeight: number
): Promise<Float32Array | null> => {
  if (!model) return null;

  await ensureBackend();

  const input = cropAndResizeFace(source, box, sourceWidth, sourceHeight);
  try {
    const output = model.predict(input) as tf.Tensor;
    const data = await output.data();
    output.dispose();

    const embedding = new Float32Array(data);
    let norm = 0;
    for (let i = 0; i < embedding.length; i++) norm += embedding[i] * embedding[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < embedding.length; i++) embedding[i] /= norm;
    return embedding;
  } catch (e: any) {
    if (e?.message?.includes('shader') || e?.message?.includes('link') || e?.message?.includes('WebGL')) {
      await fallbackToCPU();
      const output = model.predict(input) as tf.Tensor;
      const data = await output.data();
      output.dispose();
      const embedding = new Float32Array(data);
      let norm = 0;
      for (let i = 0; i < embedding.length; i++) norm += embedding[i] * embedding[i];
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < embedding.length; i++) embedding[i] /= norm;
      return embedding;
    }
    throw e;
  } finally {
    input.dispose();
  }
};

export const extractEmbeddingsBatch = async (
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  boxes: Array<{ x: number; y: number; width: number; height: number }>,
  sourceWidth: number,
  sourceHeight: number
): Promise<(Float32Array | null)[]> => {
  if (!model || boxes.length === 0) return boxes.map(() => null);

  const results: (Float32Array | null)[] = [];
  for (const box of boxes) {
    const emb = await extractEmbedding(source, box, sourceWidth, sourceHeight);
    results.push(emb);
  }
  return results;
};

export const cosineSimilarity = (a: Float32Array, b: Float32Array): number => {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
};
