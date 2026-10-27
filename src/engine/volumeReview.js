import { movementForEntry } from './planner.js';
import { MUSCLE_MODEL_VERSION } from '../data/exercises.js';
import { directGroups, groupCoefficients, groupTargets, VOLUME_GROUPS } from './training.js';
import { summarizeEntry, numeric } from './workload.js';

// All thresholds below are conservative product rules, not a fitted response model.
// Review only verified actual records from this plan and complete local-calendar weeks.
export function weekKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const validSet = (set) => set.kind !== 'warmup' && ['weight', 'reps', 'rir'].every((key) => numeric(set[key]) && Number(set[key]) >= 0) && Number(set.reps) > 0;
const definition = movementForEntry;

function performanceTrend(records, groupId) {
  const series = new Map();
  for (const record of records) for (const entry of record.exercises) {
    const movement = definition(entry);
    if (!movement || movement.id === 'plank' || !directGroups(movement).includes(groupId)) continue;
    const sets = entry.sets.filter(validSet);
    if (!sets.length) continue;
    const summary = summarizeEntry(entry, movement, { bodyWeight: record.bodyWeight });
    if (summary.unknownSets > 0 || summary.sets !== sets.length) continue;
    const range = entry.repRange ?? movement.repRange;
    const hasMax = summary.estimatedMax != null;
    if (!hasMax && sets.some((set) => Number(set.weight) !== Number(sets[0].weight))) continue;
    const key = `${entry.movementId}|${entry.variantId}|${movement.loadMode}|rest-${movement.rest}|${hasMax ? 'estimatedMax' : `reps-${sets[0].weight}`}|${sets.length}|${JSON.stringify(range)}`;
    const points = series.get(key) ?? new Map();
    const last = points.get(weekKey(record.date));
    if (!last || record.date > last.date) points.set(weekKey(record.date), { date: record.date, performance: hasMax ? summary.estimatedMax : sets.reduce((sum, set) => sum + Number(set.reps) + Number(set.rir), 0) / sets.length, suitableEffort: summary.matchedSets === sets.length });
    series.set(key, points);
  }
  const latestWeek = weekKey(records.at(-1)?.date);
  const comparable = [...series.values()].map((points) => [...points.values()].sort((a, b) => a.date.localeCompare(b.date))).filter((points) => points.length >= 3 && weekKey(points.at(-1).date) === latestWeek);
  if (!comparable.length) return 'unknown';
  const changes = comparable.map((points) => (points.at(-1).performance - points[0].performance) / points[0].performance);
  if (changes.some((change) => change >= .02)) return 'progress';
  if (changes.every((change) => change <= -.03)) return 'decline';
  if (comparable.every((points) => points.every((point) => point.suitableEffort)) && changes.every((change) => Math.abs(change) < .015)) return 'plateau';
  return 'unknown';
}

export function reviewVolume(plan, logs, planId, now = new Date()) {
  const currentWeek = weekKey(now);
  const oldest = new Date(now);
  oldest.setDate(oldest.getDate() - 28);
  const firstWeek = weekKey(oldest);
  const budgets = groupTargets(plan.targets);
  const seen = new Set();
  const eligible = logs.filter((log) => {
    if (!log.id || seen.has(log.id)) return false;
    seen.add(log.id);
    const key = weekKey(log.date);
    return log.planId === planId && log.verified === true && log.muscleModelVersion === MUSCLE_MODEL_VERSION && key && key < currentWeek && key >= firstWeek && Array.isArray(log.exercises);
  }).sort((a, b) => a.date.localeCompare(b.date));
  return Object.entries(VOLUME_GROUPS).map(([id, group]) => {
    const reviewedThrough = plan.profile.volumeReviews?.[id]?.through;
    const related = eligible.filter((log) => (!reviewedThrough || log.date > reviewedThrough)
      && Math.abs((log.budgetSnapshot?.[id] ?? -1) - budgets[id]) < .01
      && log.exercises.some((entry) => {
        const movement = definition(entry);
        return movement && (groupCoefficients(movement)[id] ?? 0) > 0 && entry.sets?.some(validSet);
      }));
    const records = related.filter((log) => log.exercises.some((entry) => {
      const movement = definition(entry);
      return movement && directGroups(movement).includes(id) && entry.sets?.some(validSet);
    }));
    const weekly = new Map();
    for (const record of related) {
      const key = weekKey(record.date);
      const value = weekly.get(key) ?? { sets: 0, rawSets: 0, sessions: 0 };
      if (records.includes(record)) value.sessions += 1;
      for (const entry of record.exercises) {
        const movement = definition(entry);
        if (movement) {
          const summary = summarizeEntry(entry, movement, { bodyWeight: record.bodyWeight });
          value.sets += (groupCoefficients(movement)[id] ?? 0) * summary.matchedSets;
          value.rawSets += (groupCoefficients(movement)[id] ?? 0) * summary.sets;
        }
      }
      weekly.set(key, value);
    }
    const directWeeks = new Set(records.map((record) => weekKey(record.date))).size;
    const base = { id, name: group.name, current: Math.round(budgets[id] * 10) / 10, weeks: directWeeks, records: records.length, through: related.at(-1)?.date,
      weekly: [...weekly].map(([week, value]) => ({ week, sets: Math.round(value.sets * 10) / 10, rawSets: Math.round(value.rawSets * 10) / 10 })), type: 'hold', next: null };
    if (directWeeks < 3) return { ...base, reason: `有效记录 ${directWeeks} / 3 周，暂不调整。` };
    if (related.some((record) => record.recovery === 'pain')) return { ...base, reason: '存在不适反馈，暂停调整。' };
    const fatigueWeeks = new Set(records.filter((record) => record.recovery === 'tired').map((record) => weekKey(record.date))).size;
    const trend = performanceTrend(records, id);
    if (fatigueWeeks >= 2 && trend === 'decline' && base.current > 2) return { ...base, type: 'decrease', next: Math.max(2, Math.round((base.current - 1) * 10) / 10), reason: '恢复不足，且同器械版本的重量、次数与 RIR 综合表现下降。建议减少 1 组。' };
    if (trend === 'progress') return { ...base, reason: '重量、次数与 RIR 综合表现进步，维持周目标。' };
    const expectedSessions = new Set(plan.days.filter((day) => day.exercises.some((entry) => directGroups(definition(entry) ?? { primary: {} }).includes(id))).map((day) => day.id)).size;
    const sufficient = [...weekly.values()].every((week) => week.sets >= budgets[id] * .85 && week.sessions >= Math.max(1, expectedSessions));
    if (trend === 'plateau' && sufficient && related.every((record) => record.recovery === 'good') && base.current < 30) return { ...base, type: 'increase', next: Math.min(30, Math.round((base.current + 1) * 10) / 10), reason: '连续三周负荷匹配、恢复良好，同版本综合表现持平。建议增加 1 组。' };
    return { ...base, reason: '负荷匹配组数、恢复或可比表现不足，暂不调整。' };
  });
}
