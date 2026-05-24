/**
 * ضغط/فك ضغط بصمات الوجه.
 * يدعم 3 صيغ:
 * - normal: number[] Float
 * - compressed: number[] Int8 تقريبا
 * - base64: string
 */

const SCALE_FACTOR = 127;

export const compressFaceDescriptor = (descriptor: number[] | Float32Array): number[] => {
  const arr = descriptor instanceof Float32Array ? Array.from(descriptor) : descriptor;
  return arr.map(v => Math.max(-127, Math.min(127, Math.round(v * SCALE_FACTOR))));
};

export const decompressFaceDescriptor = (compressed: number[]): number[] => {
  return compressed.map(v => v / SCALE_FACTOR);
};

export const compressToBase64 = (descriptor: number[] | Float32Array): string => {
  const compressed = compressFaceDescriptor(descriptor);
  const int8Array = new Int8Array(compressed);
  const uint8Array = new Uint8Array(int8Array.buffer);

  let binary = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }

  return btoa(binary);
};

export const decompressFromBase64 = (base64: string): number[] => {
  const binary = atob(base64);
  const uint8Array = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    uint8Array[i] = binary.charCodeAt(i);
  }

  const int8Array = new Int8Array(uint8Array.buffer);
  return decompressFaceDescriptor(Array.from(int8Array));
};

export const detectDescriptorFormat = (data: any): 'base64' | 'compressed' | 'normal' | 'invalid' => {
  if (typeof data === 'string') return 'base64';
  if (!Array.isArray(data) || data.length === 0) return 'invalid';

  const isCompressed = data.every(v =>
    Number.isInteger(v) && v >= -127 && v <= 127
  );

  if (isCompressed) return 'compressed';
  return 'normal';
};

export const ensureDecompressed = (data: any): number[] => {
  const format = detectDescriptorFormat(data);

  switch (format) {
    case 'base64':
      return decompressFromBase64(data);
    case 'compressed':
      return decompressFaceDescriptor(data);
    case 'normal':
      return data;
    default:
      return [];
  }
};

export const calculateDescriptorSize = (data: any): number => {
  const format = detectDescriptorFormat(data);

  switch (format) {
    case 'base64':
      return (data as string).length;
    case 'compressed':
      return (data as number[]).length;
    case 'normal':
      return (data as number[]).length * 4;
    default:
      return 0;
  }
};

export const getCompressionStats = (
  students: { faceDescriptor?: number[] | string }[]
): {
  total: number;
  withFace: number;
  totalSizeKB: number;
  compressedCount: number;
  uncompressedCount: number;
  potentialSavingsKB: number;
} => {
  let totalSize = 0;
  let compressedCount = 0;
  let uncompressedCount = 0;
  let withFace = 0;
  let potentialSavings = 0;

  students.forEach(s => {
    if (!s.faceDescriptor) return;
    withFace++;

    const format = detectDescriptorFormat(s.faceDescriptor);
    const size = calculateDescriptorSize(s.faceDescriptor);
    totalSize += size;

    if (format === 'compressed' || format === 'base64') {
      compressedCount++;
    } else if (format === 'normal') {
      uncompressedCount++;
      potentialSavings += size * 0.75;
    }
  });

  return {
    total: students.length,
    withFace,
    totalSizeKB: Math.round((totalSize / 1024) * 100) / 100,
    compressedCount,
    uncompressedCount,
    potentialSavingsKB: Math.round((potentialSavings / 1024) * 100) / 100,
  };
};
