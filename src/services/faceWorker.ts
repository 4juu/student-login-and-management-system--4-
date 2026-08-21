const DESC_DIM = 192;

const workerCode = `
  function cosineSim(a, b) {
    var dot = 0, len = ${DESC_DIM};
    for (var i = 0; i < len; i++) dot += a[i] * b[i];
    return dot;
  }

  self.onmessage = function(e) {
    var type = e.data.type;
    var data = e.data.data;

    if (type === 'normalizeDescriptor') {
      var d = new Float32Array(data);
      var norm = 0;
      for (var i = 0; i < ${DESC_DIM}; i++) norm += d[i] * d[i];
      norm = Math.sqrt(norm) || 1;
      for (var i = 0; i < ${DESC_DIM}; i++) d[i] /= norm;
      self.postMessage({ type: 'normalized', data: Array.from(d) });
    }

    if (type === 'filterOutliers') {
      var descriptors = data.descriptors;
      var maxDist = data.maxDist;
      var descs = descriptors.map(function(d) { return new Float32Array(d); });
      if (descs.length <= 2) {
        self.postMessage({ type: 'filtered', data: descriptors });
        return;
      }
      var merged = new Float32Array(${DESC_DIM});
      for (var k = 0; k < descs.length; k++) {
        for (var i = 0; i < ${DESC_DIM}; i++) merged[i] += descs[k][i];
      }
      for (var i = 0; i < ${DESC_DIM}; i++) merged[i] /= descs.length;
      var norm = 0;
      for (var i = 0; i < ${DESC_DIM}; i++) norm += merged[i] * merged[i];
      norm = Math.sqrt(norm) || 1;
      for (var i = 0; i < ${DESC_DIM}; i++) merged[i] /= norm;

      var filtered = [];
      for (var j = 0; j < descs.length; j++) {
        var sim = cosineSim(descs[j], merged);
        var dist = 1 - sim;
        if (dist <= maxDist) filtered.push(descriptors[j]);
      }
      self.postMessage({ type: 'filtered', data: filtered.length >= 2 ? filtered : descriptors.slice(0, 2) });
    }

    if (type === 'batchCompare') {
      var query = data.query;
      var storedDescriptors = data.storedDescriptors;
      var threshold = data.threshold;
      var q = new Float32Array(query);
      for (var s = 0; s < storedDescriptors.length; s++) {
        var stored = new Float32Array(storedDescriptors[s].desc);
        var sim = cosineSim(q, stored);
        var dist = 1 - sim;
        storedDescriptors[s]._dist = dist;
      }
      storedDescriptors.sort(function(a, b) { return a._dist - b._dist; });
      var results = [];
      for (var s = 0; s < storedDescriptors.length; s++) {
        if (storedDescriptors[s]._dist < threshold) {
          results.push({ index: storedDescriptors[s].index, distance: storedDescriptors[s]._dist });
        }
        delete storedDescriptors[s]._dist;
      }
      self.postMessage({ type: 'batchResult', data: results });
    }

    if (type === 'findBestMatch') {
      var query = data.query;
      var storedDescriptors = data.storedDescriptors;
      var threshold = data.threshold;
      var q = new Float32Array(query);
      var bestIndex = -1;
      var bestDist = threshold;
      for (var s = 0; s < storedDescriptors.length; s++) {
        var stored = new Float32Array(storedDescriptors[s].desc);
        var sim = cosineSim(q, stored);
        var dist = 1 - sim;
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
      var queries = data.queries;
      var storedDescriptors = data.storedDescriptors;
      var threshold = data.threshold;
      var results = [];
      for (var qIdx = 0; qIdx < queries.length; qIdx++) {
        var q = new Float32Array(queries[qIdx]);
        var bestIndex = -1;
        var bestDist = threshold;
        for (var s = 0; s < storedDescriptors.length; s++) {
          var stored = new Float32Array(storedDescriptors[s].desc);
          var sim = cosineSim(q, stored);
          var dist = 1 - sim;
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
      var query = data.query;
      var storedDescriptors = data.storedDescriptors;
      var threshold = data.threshold;
      var q = new Float32Array(query);
      var matches = [];
      for (var s = 0; s < storedDescriptors.length; s++) {
        var sd = storedDescriptors[s];
        var stored = new Float32Array(sd.desc);
        var sim = cosineSim(q, stored);
        var dist = 1 - sim;
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
