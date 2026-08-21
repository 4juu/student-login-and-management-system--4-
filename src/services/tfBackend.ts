import * as tf from '@tensorflow/tfjs';

let _webglBroken = false;
let _initialized = false;

export const isWebGLBroken = (): boolean => _webglBroken;

async function trySetBackend(name: string): Promise<boolean> {
  try {
    await tf.setBackend(name);
    await tf.ready();
    return true;
  } catch {
    return false;
  }
}

async function probeWebGL(): Promise<boolean> {
  try {
    const a = tf.randomNormal([1, 64, 64, 3]);
    const b = tf.add(a, a);
    b.dispose();
    a.dispose();
    return true;
  } catch {
    return false;
  }
}

export async function initBackend(): Promise<void> {
  if (_initialized) return;
  _initialized = true;

  if (await trySetBackend('webgl')) {
    if (await probeWebGL()) return;
    _webglBroken = true;
  }
  if (await trySetBackend('webgl2')) {
    if (await probeWebGL()) return;
    _webglBroken = true;
  }
  await trySetBackend('cpu');
}

export async function ensureBackend(): Promise<void> {
  if (_webglBroken) {
    if (tf.getBackend() !== 'cpu') await trySetBackend('cpu');
    return;
  }
  if (tf.getBackend() && tf.getBackend() !== 'none' && tf.getBackend() !== 'cpu') return;
  if (await trySetBackend('webgl')) return;
  if (await trySetBackend('webgl2')) return;
  _webglBroken = true;
  await trySetBackend('cpu');
}

export async function fallbackToCPU(): Promise<void> {
  _webglBroken = true;
  await trySetBackend('cpu');
}
