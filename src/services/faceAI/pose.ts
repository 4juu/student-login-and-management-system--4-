// ─────────────────────────────────────────────────────────────
// تقدير زاوية الوجه (yaw/pitch) من النقاط المرجعية الست لـ MediaPipe
// ترتيب النقاط القياسي: [عين_يمين, عين_يسار, أنف, فم, أذن_يمين, أذن_يسار]
// ─────────────────────────────────────────────────────────────

export interface PoseEstimate { yaw: number; pitch: number; }

export function estimatePose(
  keypoints: { x: number; y: number }[] | undefined,
): PoseEstimate | null {
  if (!keypoints || keypoints.length < 4) return null;

  const [rightEye, leftEye, nose, mouth] = keypoints;

  // ── Yaw: موضع الأنف أفقياً بالنسبة لمنتصف العينين ──
  const eyeMidX = (rightEye.x + leftEye.x) / 2;
  const eyeDist = Math.abs(leftEye.x - rightEye.x) || 1;
  const yawRatio = (nose.x - eyeMidX) / eyeDist;
  const yaw = Math.max(-45, Math.min(45, yawRatio * 90));

  // ── Pitch: موضع الأنف عمودياً بالنسبة لخط العين-الفم ──
  const eyeMidY = (rightEye.y + leftEye.y) / 2;
  const eyeToMouth = Math.abs(mouth.y - eyeMidY) || 1;
  const pitchRatio = (nose.y - eyeMidY) / eyeToMouth - 0.45;
  const pitch = Math.max(-30, Math.min(30, pitchRatio * 60));

  return { yaw: Math.round(yaw), pitch: Math.round(pitch) };
}

// ── شبكة الزوايا: 7 × 7 = 49 خانة ──
export const YAW_STEPS  = [-45, -30, -15, 0, 15, 30, 45];
export const PITCH_STEPS = [-30, -20, -10, 0, 10, 20, 30];

function nearestStep(val: number, steps: number[]): number {
  return steps.reduce((a, b) => Math.abs(b - val) < Math.abs(a - val) ? b : a);
}

/** يحوّل زاوية مقاسة لمعرّف خانة ثابت بالشبكة */
export function poseToBin(pose: PoseEstimate): string {
  const y = nearestStep(pose.yaw, YAW_STEPS);
  const p = nearestStep(pose.pitch, PITCH_STEPS);
  return `${y}_${p}`;
}

export const TOTAL_POSE_BINS = YAW_STEPS.length * PITCH_STEPS.length; // 49
