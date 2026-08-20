import * as tf from '@tensorflow/tfjs';

const MODEL_URL = '/models/mobilefacenet/model.json';
const INPUT_SIZE = 112;
const EMBEDDING_DIM = 512;

let model: tf.GraphModel | null = null;
let loading = false;
let loadPromise: Promise<tf.GraphModel> | null = null;

export const getMobileFaceNetModel = (): tf.GraphModel | null => model;
export const isMobileFaceNetReady = (): boolean => model !== null;
export const getEmbeddingDim = () => EMBEDDING_DIM;

export const loadMobileFaceNet = async (): Promise<tf.GraphModel> => {
  if (model) return model;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    loading = true;
    try {
      model = await tf.loadGraphModel(MODEL_URL);
      const dummy = tf.zeros([1, INPUT_SIZE, INPUT_SIZE, 3]);
      const warmup = model.predict(dummy) as tf.Tensor;
      warmup.dispose();
      dummy.dispose();
      return model;
    } finally {
      loading = false;
      loadPromise = null;
    }
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

  const scaleX = cropW / sourceWidth;
  const scaleY = cropH / sourceHeight;

  const imgTensor = tf.browser.fromPixels(source);
  const batched = imgTensor.expandDims(0);

  const boxTensor = tf.tensor2d([[cropY / sourceHeight, cropX / sourceWidth, (cropY + cropH) / sourceHeight, (cropX + cropW) / sourceWidth]]);
  const cropTensor = tf.image.cropAndResize(batched, boxTensor, [0], [INPUT_SIZE, INPUT_SIZE]);

  const normalized = cropTensor.div(255.0);

  imgTensor.dispose();
  batched.dispose();
  boxTensor.dispose();
  cropTensor.dispose();

  return normalized as tf.Tensor4D;
};

export const extractEmbedding = async (
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  box: { x: number; y: number; width: number; height: number },
  sourceWidth: number,
  sourceHeight: number
): Promise<Float32Array | null> => {
  if (!model) return null;

  const input = cropAndResizeFace(source, box, sourceWidth, sourceHeight);
  try {
    const output = model.predict(input) as tf.Tensor;
    const data = await output.data();
    output.dispose();
    const embedding = new Float32Array(data);

    let norm = 0;
    for (let i = 0; i < EMBEDDING_DIM; i++) norm += embedding[i] * embedding[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < EMBEDDING_DIM; i++) embedding[i] /= norm;

    return embedding;
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
