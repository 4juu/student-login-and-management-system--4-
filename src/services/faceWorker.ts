const workerCode = `
  const DESC_DIM = 512;

  function cosineSimilarity(a, b) {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
  }

  function l2Normalize(d) {
    let norm = 0;
    for (let i = 0; i < d.length; i++) norm += d[i] * d[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < d.length; i++) d[i] /= norm;
    return d;
  }

  self.onmessage = function(e) {
    const { type, data } = e.data;

    if (type === 'normalizeDescriptor') {
      const d = new Float32Array(data);
      l2Normalize(d);
      self.postMessage({ type: 'normalized', data: Array.from(d) });
    }

    if (type === 'filterOutliers') {
      const { descriptors, maxDist } = data;
      const descs = descriptors.map(function(d) { return l2Normalize(new Float32Array(d)); });
      if (descs.length <= 2) {
        self.postMessage({ type: 'filtered', data: descriptors });
        return;
      }
      const merged = new Float32Array(DESC_DIM);
      for (let k = 0; k < descs.length; k++) {
        for (let i = 0; i < DESC_DIM; i++) merged[i] += descs[k][i];
      }
      for (let i = 0; i < DESC_DIM; i++) merged[i] /= descs.length;
      l2Normalize(merged);

      const filtered = [];
      for (let j = 0; j < descs.length; j++) {
        const sim = cosineSimilarity(descs[j], merged);
        const dist = 1 - sim;
        if (dist <= maxDist) filtered.push(descriptors[j]);
      }
      self.postMessage({ type: 'filtered', data: filtered.length >= 2 ? filtered : descriptors.slice(0, 2) });
    }

    if (type === 'batchCompare') {
      const { query, storedDescriptors, threshold } = data;
      const q = l2Normalize(new Float32Array(query));
      for (let s = 0; s < storedDescriptors.length; s++) {
        const stored = l2Normalize(new Float32Array(storedDescriptors[s].desc));
        const sim = cosineSimilarity(q, stored);
        storedDescriptors[s]._dist = 1 - sim;
      }
      storedDescriptors.sort(function(a, b) { return a._dist - b._dist; });
      const results = [];
      for (let s = 0; s < storedDescriptors.length; s++) {
        if (storedDescriptors[s]._dist < threshold) {
          results.push({ index: storedDescriptors[s].index, distance: storedDescriptors[s]._dist });
        }
        delete storedDescriptors[s]._dist;
      }
      self.postMessage({ type: 'batchResult', data: results });
    }

    if (type === 'findBestMatch') {
      const { query, storedDescriptors, threshold } = data;
      const q = l2Normalize(new Float32Array(query));
      let bestIndex = -1;
      let bestDist = threshold;
      for (let s = 0; s < storedDescriptors.length; s++) {
        const stored = l2Normalize(new Float32Array(storedDescriptors[s].desc));
        const sim = cosineSimilarity(q, stored);
        const dist = 1 - sim;
        if (dist < bestDist) {
          bestDist = dist;
          bestIndex = storedDescriptors[s].index;
        }
      }
      self.postMessage({
        type: 'matchResult',
        data: bestIndex >= 0 ? { index: bestIndex, distance: bestDist } : null
      });
    }

    if (type === 'batchMatchAll') {
      const { queries, storedDescriptors, threshold } = data;
      const results = [];
      for (let qIdx = 0; qIdx < queries.length; qIdx++) {
        const q = l2Normalize(new Float32Array(queries[qIdx]));
        let bestIndex = -1;
        let bestDist = threshold;
        for (let s = 0; s < storedDescriptors.length; s++) {
          const stored = l2Normalize(new Float32Array(storedDescriptors[s].desc));
          const sim = cosineSimilarity(q, stored);
          const dist = 1 - sim;
          if (dist < bestDist) {
            bestDist = dist;
            bestIndex = storedDescriptors[s].index;
          }
        }
        results.push(bestIndex >= 0 ? { index: bestIndex, distance: bestDist } : null);
      }
      self.postMessage({ type: 'batchMatchAllResult', data: results });
    }

    if (type === 'tamper') {
      const { query, storedDescriptors, threshold } = data;
      const q = l2Normalize(new Float32Array(query));
      const matches = [];
      for (let s = 0; s < storedDescriptors.length; s++) {
        const sd = storedDescriptors[s];
        const stored = l2Normalize(new Float32Array(sd.desc));
        const sim = cosineSimilarity(q, stored);
        const dist = 1 - sim;
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

export const workerFindBestMatch = (
  query: Float32Array,
  stored: Array<{ index: number; desc: number[] }>,
  threshold: number
): Promise<{ index: number; distance: number } | null> => {
  const w = getWorker();
  if (!w) return Promise.resolve(null);
  return new Promise(resolve => {
    const handler = (e: MessageEvent) => {
      if (e.data.type === 'matchResult') {
        w.removeEventListener('message', handler);
        resolve(e.data.data);
      }
    };
    w.addEventListener('message', handler);
    w.postMessage({
      type: 'findBestMatch',
      data: { query: Array.from(query), storedDescriptors: stored, threshold },
    });
    setTimeout(() => { w.removeEventListener('message', handler); resolve(null); }, 5000);
  });
};

export const workerBatchMatchAll = (
  queries: Float32Array[],
  stored: Array<{ index: number; desc: number[] }>,
  threshold: number
): Promise<Array<{ index: number; distance: number } | null>> => {
  const w = getWorker();
  if (!w) return Promise.resolve(queries.map(() => null));
  return new Promise(resolve => {
    const handler = (e: MessageEvent) => {
      if (e.data.type === 'batchMatchAllResult') {
        w.removeEventListener('message', handler);
        resolve(e.data.data);
      }
    };
    w.addEventListener('message', handler);
    w.postMessage({
      type: 'batchMatchAll',
      data: {
        queries: queries.map(q => Array.from(q)),
        storedDescriptors: stored,
        threshold,
      },
    });
    setTimeout(() => { w.removeEventListener('message', handler); resolve(queries.map(() => null)); }, 5000);
  });
};
