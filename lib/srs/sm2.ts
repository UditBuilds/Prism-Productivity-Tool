// SM-2 spaced-repetition algorithm.
// quality: 0=blackout, 1=wrong, 2=hard, 3=ok, 4=good, 5=easy
// Used by the SRS engine in Session 4. Do not modify the math.

export interface SM2Result {
  interval: number;
  easeFactor: number;
  repetitions: number;
  nextReview: Date;
}

export function calculateSM2(
  quality: number,
  repetitions: number,
  easeFactor: number,
  interval: number
): SM2Result {
  let newInterval: number;
  let newReps: number;

  if (quality >= 3) {
    if (repetitions === 0) newInterval = 1;
    else if (repetitions === 1) newInterval = 6;
    else newInterval = Math.round(interval * easeFactor);
    newReps = repetitions + 1;
  } else {
    newReps = 0;
    newInterval = 1;
  }

  let newEF =
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (newEF < 1.3) newEF = 1.3;

  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + newInterval);

  return {
    interval: newInterval,
    easeFactor: newEF,
    repetitions: newReps,
    nextReview,
  };
}
