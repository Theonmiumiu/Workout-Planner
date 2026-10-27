import { resolveMovement } from '../data/muscleModel.js';

export const DOSE_MODEL_VERSION = 2;
export const numeric = (value) => value !== '' && value != null && Number.isFinite(Number(value));
export const round = (value) => Math.round(value * 10) / 10;

export function workingLoad(set, movement, bodyWeight) {
  if (!numeric(set.weight) || Number(set.weight) < 0) return null;
  const weight = Number(set.weight);
  if (movement.loadMode === 'timed' || movement.loadMode === 'bodyweightPartial') return null;
  if (movement.loadMode === 'bodyweight' || movement.loadMode === 'assisted') {
    if (!numeric(bodyWeight) || Number(bodyWeight) <= 0) return null;
    const load = Number(bodyWeight) + (movement.loadMode === 'assisted' ? -weight : weight);
    return load > 0 ? load : null;
  }
  return weight > 0 ? weight : null;
}

export function estimatedMax(set, movement, bodyWeight) {
  const load = workingLoad(set, movement, bodyWeight);
  if (set.kind === 'warmup' || !load || !numeric(set.reps) || !numeric(set.rir)) return null;
  const reps = Number(set.reps); const rir = Number(set.rir);
  if (reps < 3 || reps > 12 || rir < 0 || rir > 3 || reps + rir > 15) return null;
  return load * (1 + (reps + rir) / 30);
}

export function assessWorkSet(set, movement, repRange = movement.repRange, bodyWeight) {
  const valid = set.kind !== 'warmup' && numeric(set.reps) && Number(set.reps) > 0
    && numeric(set.weight) && Number(set.weight) >= 0 && numeric(set.rir) && Number(set.rir) >= 0 && Number(set.rir) <= 6;
  const load = valid ? workingLoad(set, movement, bodyWeight) : null;
  const known = valid && (!['external', 'assisted'].includes(movement.loadMode ?? 'external') || load != null);
  const reps = Number(set.reps); const rir = Number(set.rir);
  return {
    valid, known, load, reps, rir,
    target: known && reps >= repRange[0],
    matched: known && reps >= repRange[0] && reps <= repRange[1] && rir >= 1 && rir <= 3,
    light: known && reps >= repRange[0] && (rir > 3 || (reps > repRange[1] && rir >= 1)),
    heavy: known && reps < repRange[0] && rir <= 1,
    failure: known && rir === 0,
  };
}

export function summarizeEntry(entry, definition, { bodyWeight, referenceMax } = {}) {
  const movement = resolveMovement(definition, entry.variantId);
  const repRange = entry.repRange ?? movement.repRange;
  const result = { sets: 0, targetSets: 0, matchedSets: 0, lightSets: 0, heavySets: 0, failureSets: 0, challengingSets: 0, warmupSets: 0, unknownSets: 0, reps: 0, seconds: 0, volumeLoad: 0, loadedSets: 0, estimatedMax: null, relativeLoads: [], issues: [] };
  for (const set of entry.sets ?? []) {
    if (set.kind === 'warmup') { result.warmupSets += 1; continue; }
    const assessment = assessWorkSet(set, movement, repRange, bodyWeight);
    if (!assessment.known) { result.unknownSets += 1; continue; }
    const { reps, rir, load } = assessment;
    result.sets += 1;
    if (movement.loadMode === 'timed') result.seconds += reps;
    else result.reps += reps;
    if (load != null) {
      result.loadedSets += 1;
      result.volumeLoad += load * reps * (movement.loadMultiplier ?? 1);
      if (referenceMax > 0) result.relativeLoads.push(round(load / referenceMax * 100));
    }
    if (rir <= 4) result.challengingSets += 1;
    if (assessment.target) result.targetSets += 1;
    if (assessment.matched) result.matchedSets += 1;
    if (assessment.light) result.lightSets += 1;
    if (assessment.heavy) result.heavySets += 1;
    if (assessment.failure) result.failureSets += 1;
    const max = estimatedMax(set, movement, bodyWeight);
    if (max != null) result.estimatedMax = Math.max(result.estimatedMax ?? 0, max);
    if (assessment.heavy) result.issues.push('负荷偏高');
    if (assessment.light) result.issues.push('负荷偏低');
    if (assessment.failure) result.issues.push('出现力竭组');
    if (reps < repRange[0]) result.issues.push('次数不足');
  }
  result.volumeLoad = round(result.volumeLoad);
  result.estimatedMax = result.estimatedMax == null ? null : round(result.estimatedMax);
  result.issues = [...new Set(result.issues)];
  return result;
}

export function buildLoadHistory(logs, lookup, { planId, before = new Date().toISOString() } = {}) {
  const history = {};
  const seen = new Set();
  const earliest = new Date(new Date(before).getTime() - 56 * 86400000).toISOString();
  for (const record of [...logs].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!record.verified || record.date >= before || record.date < earliest || (planId && record.planId !== planId) || (record.id && seen.has(record.id))) continue;
    seen.add(record.id);
    for (const entry of record.exercises ?? []) {
      const definition = entry.movementSnapshot ?? lookup(entry.movementId);
      if (!definition) continue;
      const movement = resolveMovement(definition, entry.variantId);
      const summary = summarizeEntry(entry, movement, { bodyWeight: record.bodyWeight });
      const key = `${entry.movementId}|${entry.variantId}`;
      const candidates = (entry.sets ?? []).filter((set) => set.kind !== 'warmup' && estimatedMax(set, movement, record.bodyWeight) != null);
      if (!candidates.length) continue;
      const top = candidates.reduce((best, set) => estimatedMax(set, movement, record.bodyWeight) > estimatedMax(best, movement, record.bodyWeight) ? set : best);
      const point = { date: record.date, max: summary.estimatedMax, bodyWeight: record.bodyWeight, weight: Number(top.weight), reps: Number(top.reps), rir: Number(top.rir), basis: movement.loadMode };
      history[key] = [...(history[key] ?? []), point].slice(-3);
    }
  }
  return history;
}

export function loadPrescription(movement, entry, history = {}, bodyWeight) {
  const points = history[`${movement.id}|${entry.variantId}`] ?? [];
  const recent = points.filter((point) => point.max > 0 && point.basis === movement.loadMode);
  if (!recent.length) return { suggestedWeight: null, referenceMax: null, expectedReps: null, status: numeric(entry.weight) && Number(entry.weight) > 0 ? '待记录校准' : '待填写重量' };
  const values = recent.map((point) => point.max).sort((a, b) => a - b);
  const referenceMax = values[Math.floor(values.length / 2)];
  const range = entry.repRange ?? movement.repRange;
  const reps = (range[0] + range[1]) / 2;
  const rir = entry.rir ?? movement.rir;
  const targetLoad = referenceMax / (1 + (reps + rir) / 30);
  let target = targetLoad;
  if (movement.loadMode === 'assisted' || movement.loadMode === 'bodyweight') {
    if (!numeric(bodyWeight) || Number(bodyWeight) <= 0) return { suggestedWeight: null, referenceMax, expectedReps: null, status: '待填写体重' };
    target = movement.loadMode === 'assisted' ? Number(bodyWeight) - targetLoad : targetLoad - Number(bodyWeight);
  }
  const increment = movement.increment ?? 1;
  const suggestedWeight = Math.max(0, Math.round(target / increment) * increment);
  const current = workingLoad({ weight: entry.weight }, movement, bodyWeight);
  const expectedReps = current ? Math.max(0, referenceMax / current * 30 - 30 - rir) : null;
  const status = expectedReps == null ? '待填写重量' : expectedReps < range[0] - 1 ? '重量偏高' : expectedReps > range[1] + 1 ? '重量偏低' : '重量匹配';
  return { suggestedWeight, referenceMax: round(referenceMax), expectedReps: expectedReps == null ? null : round(expectedReps), status };
}

export function plannedEntryMetrics(entry, definition, context = {}) {
  const movement = resolveMovement(definition, entry.variantId);
  const range = entry.repRange ?? movement.repRange;
  const prescription = loadPrescription(movement, entry, context.loadHistory, context.bodyWeight);
  const reps = round((range[0] + range[1]) / 2);
  const synthetic = { ...entry, sets: Array.from({ length: entry.sets }, () => ({ weight: entry.weight ?? '', reps, rir: entry.rir ?? movement.rir })) };
  const result = summarizeEntry(synthetic, movement, { bodyWeight: context.bodyWeight, referenceMax: prescription.referenceMax });
  const mismatch = ['重量偏高', '重量偏低'].includes(prescription.status);
  return { ...result, matchedSets: mismatch ? 0 : result.matchedSets, prescription, repRange: range };
}
