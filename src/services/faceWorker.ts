// src/services/faceWorker.ts
const workerCode = `
  self.onmessage = function(e) {
    const { type, data } = e.data;
    
    if (type === 'normalizeDescriptor') {
      const d = new Float32Array(data);
      let norm = 0;
      for (let i = 0; i < 128; i++) norm += d[i] * d[i];
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < 128; i++) d[i] /= norm;
      self.postMessage({ type: 'normalized', data: Array.from(d) });
    }
    
    if (type === 'filterOutliers') {
      const { descriptors, maxDist } = data;
      const descs = descriptors.map(function(d) { return new Float32Array(d); });
      if (descs.length <= 2) {
        self.postMessage({ type: 'filtered', data: descriptors });
        return;
      }
      const merged = new Float32Array(128);
      for (let k = 0; k < descs.length; k++) {
        for (let i = 0; i < 128; i++) merged[i] += descs[k][i];
      }
      for (let i = 0; i < 128; i++) merged[i] /= descs.length;
      let norm = 0;
      for (let i = 0; i < 128; i++) norm += merged[i] * merged[i];
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < 128; i++) merged[i] /= norm;
      
      const filtered = [];
      for (let j = 0; j < descs.length; j++) {
        let dist = 0;
        for (let i = 0; i < 128; i++) dist += (descs[j][i] - merged[i]) * (descs[j][i] - merged[i]);
        dist = Math.sqrt(dist);
        if (dist <= maxDist) filtered.push(descriptors[j]);
      }
      self.postMessage({ type: 'filtered', data: filtered.length >= 2 ? filtered : descriptors.slice(0, 2) });
    }
    
    if (type === 'batchCompare') {
      const { query, storedDescriptors, threshold } = data;
      const q = new Float32Array(query);
      const results = [];
      for (let s = 0; s < storedDescriptors.length; s++) {
        const stored = new Float32Array(storedDescriptors[s].desc);
        let dist = 0;
        for (let i = 0; i < 128; i++) dist += (q[i] - stored[i]) * (q[i] - stored[i]);
        dist = Math.sqrt(dist);
        if (dist < threshold) {
          results.push({ index: storedDescriptors[s].index, distance: dist });
        }
      }
      results.sort(function(a, b) { return a.distance - b.distance; });
      self.postMessage({ type: 'batchResult', data: results });
    }
    
    if (type === 'tamper') {
      const { query, storedDescriptors, threshold } = data;
      const q = new Float32Array(query);
      const matches = [];
      for (let s = 0; s < storedDescriptors.length; s++) {
        const sd = storedDescriptors[s];
        const stored = new Float32Array(sd.desc);
        let dist = 0;
        for (let i = 0; i < 128; i++) dist += (q[i] - stored[i]) * (q[i] - stored[i]);
        dist = Math.sqrt(dist);
        if (dist < threshold) {
          matches.push({ id: sd.id, name: sd.name, distance: dist });
        }
      }
      self.postMessage({ type: 'tamperResult', data: matches });
    }
  };
`;

let worker: Worker | null = null;

export const getWorker = (): Worker | null => {
  if (worker) return worker;
  try {
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    return worker;
  } catch {
    return null;
  }
};

export const terminateWorker = () => {
  if (worker) { worker.terminate(); worker = null; }
};

export const workerBatchCompare = (
  query: Float32Array,
  stored: Array<{ index: number; desc: number[] }>,
  threshold: number
): Promise<Array<{ index: number; distance: number }>> => {
  const w = getWorker();
  if (!w) return Promise.resolve([]);
  return new Promise(resolve => {
    const handler = (e: MessageEvent) => {
      if (e.data.type === 'batchResult') {
        w.removeEventListener('message', handler);
        resolve(e.data.data);
      }
    };
    w.addEventListener('message', handler);
    w.postMessage({
      type: 'batchCompare',
      data: { query: Array.from(query), storedDescriptors: stored, threshold },
    });
    setTimeout(() => { w.removeEventListener('message', handler); resolve([]); }, 5000);
  });
};