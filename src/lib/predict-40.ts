// Morin-style mono-exponential 40-yard prediction from cumulative sprint checkpoints.

/*
 * Sprint acceleration force-velocity-power profiling methodology adapted from:
 * Morin, J-B. (2017). "A spreadsheet for sprint acceleration force-velocity-power profiling."
 * https://jbmorin.net/2017/12/13/a-spreadsheet-for-sprint-acceleration-force-velocity-power-profiling/
 */

export type SprintCheckpoint = {
  distanceYards: number;
  cumulativeTimeSeconds: number;
};

export type Predicted40Result = {
  predicted40Seconds: number | null;
  modelVmaxMs: number | null;
  tauSeconds: number | null;
  rmseMeters: number | null;
  confidence: "higher" | "moderate" | "limited" | "unavailable";
  method: "actual-checkpoint" | "interpolated" | "morin-exponential-model" | "unavailable";
  warning?: string;
};

const YARDS_TO_METERS = 0.9144;
const FORTY_YARDS_METERS = 40 * YARDS_TO_METERS;

/**
 * velocity(t) = Vmax * (1 - exp(-t / tau))
 * distance(t) = Vmax * (t + tau * exp(-t / tau) - tau)
 */
function predictedDistanceMeters(timeSeconds: number, vMaxMs: number, tauSeconds: number): number {
  return vMaxMs * (timeSeconds + tauSeconds * Math.exp(-timeSeconds / tauSeconds) - tauSeconds);
}

function sumSquaredError(
  checkpoints: Array<{ distanceMeters: number; timeSeconds: number }>,
  vMaxMs: number,
  tauSeconds: number,
): number {
  return checkpoints.reduce((sum, checkpoint) => {
    const predicted = predictedDistanceMeters(checkpoint.timeSeconds, vMaxMs, tauSeconds);
    const residual = predicted - checkpoint.distanceMeters;
    return sum + residual ** 2;
  }, 0);
}

/** Deterministic coarse-to-fine search (replaces the spreadsheet Solver workflow). */
function fitSprintModel(
  checkpoints: Array<{ distanceMeters: number; timeSeconds: number }>,
): { vMaxMs: number; tauSeconds: number; rmseMeters: number } | null {
  if (checkpoints.length < 2) return null;

  let vMaxMin = 4;
  let vMaxMax = 14;
  let tauMin = 0.25;
  let tauMax = 2.5;

  let bestVMax = 0;
  let bestTau = 0;
  let bestError = Number.POSITIVE_INFINITY;

  const STEPS = 70;
  const ROUNDS = 6;

  for (let round = 0; round < ROUNDS; round++) {
    bestError = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= STEPS; i++) {
      const vMax = vMaxMin + ((vMaxMax - vMaxMin) * i) / STEPS;
      for (let j = 0; j <= STEPS; j++) {
        const tau = tauMin + ((tauMax - tauMin) * j) / STEPS;
        const error = sumSquaredError(checkpoints, vMax, tau);
        if (error < bestError) {
          bestError = error;
          bestVMax = vMax;
          bestTau = tau;
        }
      }
    }
    const vMaxSpan = (vMaxMax - vMaxMin) / 5;
    const tauSpan = (tauMax - tauMin) / 5;
    vMaxMin = Math.max(3, bestVMax - vMaxSpan);
    vMaxMax = Math.min(15, bestVMax + vMaxSpan);
    tauMin = Math.max(0.1, bestTau - tauSpan);
    tauMax = Math.min(3, bestTau + tauSpan);
  }

  if (!Number.isFinite(bestVMax) || !Number.isFinite(bestTau) || bestVMax <= 0 || bestTau <= 0) {
    return null;
  }

  return {
    vMaxMs: bestVMax,
    tauSeconds: bestTau,
    rmseMeters: Math.sqrt(bestError / checkpoints.length),
  };
}

/** Solve the fitted distance equation for the time at a target distance (bisection). */
function solveTimeAtDistance(
  targetDistanceMeters: number,
  vMaxMs: number,
  tauSeconds: number,
): number | null {
  let lowerTime = 0;
  let upperTime = 15;
  if (predictedDistanceMeters(upperTime, vMaxMs, tauSeconds) < targetDistanceMeters) return null;

  for (let iteration = 0; iteration < 100; iteration++) {
    const midpoint = (lowerTime + upperTime) / 2;
    const distance = predictedDistanceMeters(midpoint, vMaxMs, tauSeconds);
    if (distance < targetDistanceMeters) lowerTime = midpoint;
    else upperTime = midpoint;
  }
  return (lowerTime + upperTime) / 2;
}

function validateCheckpoints(checkpoints: SprintCheckpoint[]): SprintCheckpoint[] {
  return checkpoints
    .filter(
      (checkpoint) =>
        Number.isFinite(checkpoint.distanceYards) &&
        Number.isFinite(checkpoint.cumulativeTimeSeconds) &&
        checkpoint.distanceYards > 0 &&
        checkpoint.cumulativeTimeSeconds > 0,
    )
    .sort((a, b) => a.distanceYards - b.distanceYards)
    .filter((checkpoint, index, values) => {
      if (index === 0) return true;
      return (
        checkpoint.distanceYards > values[index - 1]!.distanceYards &&
        checkpoint.cumulativeTimeSeconds > values[index - 1]!.cumulativeTimeSeconds
      );
    });
}

export function predict40FromSplits(inputCheckpoints: SprintCheckpoint[]): Predicted40Result {
  const checkpoints = validateCheckpoints(inputCheckpoints);

  if (checkpoints.length === 0) {
    return {
      predicted40Seconds: null,
      modelVmaxMs: null,
      tauSeconds: null,
      rmseMeters: null,
      confidence: "unavailable",
      method: "unavailable",
      warning: "Enter valid cumulative sprint checkpoints.",
    };
  }

  // 1. Use an actual 40-yard checkpoint when available.
  const exact40 = checkpoints.find((checkpoint) => Math.abs(checkpoint.distanceYards - 40) < 0.001);
  if (exact40) {
    return {
      predicted40Seconds: Number(exact40.cumulativeTimeSeconds.toFixed(2)),
      modelVmaxMs: null,
      tauSeconds: null,
      rmseMeters: null,
      confidence: "higher",
      method: "actual-checkpoint",
    };
  }

  // 2. Interpolate when the entered test crosses 40 yards.
  const checkpointAfter40 = checkpoints.find((checkpoint) => checkpoint.distanceYards > 40);
  if (checkpointAfter40) {
    const afterIndex = checkpoints.indexOf(checkpointAfter40);
    const checkpointBefore40 = checkpoints[afterIndex - 1];
    if (checkpointBefore40) {
      const segmentDistance = checkpointAfter40.distanceYards - checkpointBefore40.distanceYards;
      const segmentTime =
        checkpointAfter40.cumulativeTimeSeconds - checkpointBefore40.cumulativeTimeSeconds;
      const distanceNeeded = 40 - checkpointBefore40.distanceYards;
      const interpolatedTime =
        checkpointBefore40.cumulativeTimeSeconds + segmentTime * (distanceNeeded / segmentDistance);
      return {
        predicted40Seconds: Number(interpolatedTime.toFixed(2)),
        modelVmaxMs: null,
        tauSeconds: null,
        rmseMeters: null,
        confidence: "higher",
        method: "interpolated",
      };
    }
  }

  // 3. Model fit requires at least three checkpoints (four or more preferred).
  if (checkpoints.length < 3) {
    return {
      predicted40Seconds: null,
      modelVmaxMs: null,
      tauSeconds: null,
      rmseMeters: null,
      confidence: "unavailable",
      method: "unavailable",
      warning:
        "Add at least three cumulative checkpoints to predict a 40. Four or more are preferred.",
    };
  }

  const metricCheckpoints = checkpoints.map((checkpoint) => ({
    distanceMeters: checkpoint.distanceYards * YARDS_TO_METERS,
    timeSeconds: checkpoint.cumulativeTimeSeconds,
  }));

  const fit = fitSprintModel(metricCheckpoints);
  if (!fit) {
    return {
      predicted40Seconds: null,
      modelVmaxMs: null,
      tauSeconds: null,
      rmseMeters: null,
      confidence: "unavailable",
      method: "unavailable",
      warning: "The sprint model could not fit the entered splits.",
    };
  }

  const predicted40 = solveTimeAtDistance(FORTY_YARDS_METERS, fit.vMaxMs, fit.tauSeconds);
  if (!predicted40) {
    return {
      predicted40Seconds: null,
      modelVmaxMs: fit.vMaxMs,
      tauSeconds: fit.tauSeconds,
      rmseMeters: fit.rmseMeters,
      confidence: "unavailable",
      method: "unavailable",
      warning: "The model could not produce a realistic 40-yard prediction.",
    };
  }

  const longestDistance = checkpoints[checkpoints.length - 1]!.distanceYards;
  let confidence: Predicted40Result["confidence"];
  if (checkpoints.length >= 4 && longestDistance >= 30 && fit.rmseMeters <= 0.35) {
    confidence = "higher";
  } else if (checkpoints.length >= 3 && longestDistance >= 20 && fit.rmseMeters <= 0.75) {
    confidence = "moderate";
  } else {
    confidence = "limited";
  }

  return {
    predicted40Seconds: Number(predicted40.toFixed(2)),
    modelVmaxMs: Number(fit.vMaxMs.toFixed(3)),
    tauSeconds: Number(fit.tauSeconds.toFixed(3)),
    rmseMeters: Number(fit.rmseMeters.toFixed(3)),
    confidence,
    method: "morin-exponential-model",
    warning:
      confidence === "limited"
        ? "Prediction is based on limited distance or a weaker model fit."
        : undefined,
  };
}
