import {
  MOVEMENTS, EQUIPMENT, MUSCLES, MUSCLE_REGIONS, LEVELS, PREFERENCES, MUSCLE_MODEL_VERSION, resolveMovement,
} from '../data/exercises.js';
import {
  ALGORITHM_VERSION, FOCUSES, VOLUME_GROUPS, directGroups, dominantMuscles, focusesFor, focusBlocks, focusDefinition, weekdaysFor, customMusclesFor, resolveRest,
  groupCoefficients, groupTargets, isMovementAllowedForFocus, matchesBlock, muscleCoefficients,
} from './training.js';
import { plannedEntryMetrics, summarizeEntry, assessWorkSet, numeric, loadPrescription, round, DOSE_MODEL_VERSION } from './workload.js';

// 用户通过自定义表单添加的器械与动作，与内置数据同等参与筛选和计划生成。
let customData = { equipment: [], movements: [] };
export function setCustomData(data) {
  customData = { equipment: data?.equipment ?? [], movements: data?.movements ?? [] };
}
export const allMovements = () => [...MOVEMENTS, ...customData.movements.filter((movement) => !movement.deletedAt)];
export const allEquipment = () => [...EQUIPMENT, ...customData.equipment];

// Retain deleted definitions for existing plans, versions and training history.
export const movementById = (id) => [...MOVEMENTS, ...customData.movements].find((movement) => movement.id === id);
export const movementForEntry = (entry) => {
  if (!entry) return null;
  const movement = resolveMovement(entry.movementSnapshot ?? movementById(entry.movementId), entry.variantId);
  return movement ? { ...movement, rest: resolveRest(entry.rest, movement.rest) } : null;
};

// 版本 id 全局唯一；旧版动作 id 全部保留为版本 id，因此可作为迁移索引。
const VARIANT_INDEX = new Map(MOVEMENTS.flatMap((movement) => movement.variants.map((variant) => [variant.id, movement.id])));

export function movementIdForVariant(variantId) {
  return VARIANT_INDEX.get(variantId) ?? null;
}

export function variantById(variantId) {
  const movementId = VARIANT_INDEX.get(variantId);
  const movement = movementById(movementId);
  return movement ? { movement, variant: movement.variants.find((item) => item.id === variantId) } : null;
}

export function isVariantAvailable(variant, equipment, attachments) {
  const owned = new Set([...equipment, ...attachments]);
  return variant.requires.every((alternatives) => alternatives.some((item) => owned.has(item)));
}

export function getAvailableVariants(movement, equipment, attachments) {
  return movement.variants.filter((variant) => isVariantAvailable(variant, equipment, attachments));
}

export function isMovementAvailable(movement, equipment, attachments) {
  return getAvailableVariants(movement, equipment, attachments).length > 0;
}

export function getAvailableMovements(equipment, attachments, excluded = []) {
  const excludedSet = new Set(excluded);
  return allMovements().filter((movement) => !excludedSet.has(movement.id) && isMovementAvailable(movement, equipment, attachments));
}

// 优先选用户填过重量的版本，其次第一个可用版本。
export function pickVariant(movement, equipment, attachments, weights = {}, regionPreferences = {}) {
  const available = getAvailableVariants(movement, equipment, attachments);
  if (!available.length) return null;
  const rank = (variant) => Object.entries(variant.parameters?.regions ?? {}).reduce((score, [id, coefficient]) => score + coefficient * ((PREFERENCES.find((preference) => preference.id === regionPreferences[id])?.factor ?? 1) - 1), 0) + ((weights[variant.id] ?? 0) > 0 ? .05 : 0);
  return [...available].sort((a, b) => rank(b) - rank(a))[0];
}

export function muscleContributions(movement) {
  const coefficients = muscleCoefficients(movement);
  const training = Object.entries(coefficients).map(([id, coefficient]) => ({ id, coefficient, role: movement.primary[id] ? 'primary' : 'secondary' }))
    .sort((a, b) => Number(b.role === 'primary') - Number(a.role === 'primary') || b.coefficient - a.coefficient);
  const stabilizers = (movement.stabilizers ?? []).filter((id) => MUSCLES[id] && !coefficients[id]).map((id) => ({ id, coefficient: 0, role: 'stabilizer' }));
  return [...training, ...stabilizers];
}

// Volume targets are adjustable starting budgets. Training age alone cannot predict
// an individual's optimal volume; there is no muscle-specific growth multiplier.
export function getTargets(profile) {
  const level = LEVELS[profile.level] ?? LEVELS.intermediate;
  return Object.fromEntries(Object.keys(MUSCLES).map((id) => {
    const preference = PREFERENCES.find((item) => item.id === profile.preferences?.[id]) ?? PREFERENCES[2];
    const groupId = Object.keys(VOLUME_GROUPS).find((key) => VOLUME_GROUPS[key].muscles.includes(id));
    const override = profile.volumeOverrides?.[groupId];
    return [id, Number.isFinite(override) && override >= 2 && override <= 30 ? override : Math.round(level.baseSets * preference.factor * 10) / 10];
  }));
}

function emptyVolume() {
  return Object.fromEntries(Object.keys(MUSCLES).map((id) => [id, 0]));
}

function addVolume(volume, movement, sets) {
  for (const [muscle, coefficient] of Object.entries(muscleCoefficients(movement))) {
    volume[muscle] = (volume[muscle] ?? 0) + coefficient * sets;
  }
}

export function estimateDay(day) {
  if (!day?.exercises?.length) return 8;
  const work = day.exercises.reduce((total, item) => {
    const movement = movementForEntry(item);
    if (!movement) return total;
    return total + item.sets * (45 + movement.rest) / 60;
  }, 0);
  return Math.round(8 + work + day.exercises.length * 1.2);
}

function hoursBetween(dayA, dayB) {
  const direct = Math.abs(dayA - dayB) * 24;
  return Math.min(direct, 168 - direct);
}

// A uniform 48 h scheduling preference, not a biological recovery prediction.
const RECOVERY_HOURS = 48;
const MAX_EXERCISE_SETS = 4;
const MAX_DAILY_DIRECT_SETS = 10; // Product guardrail, not a proven physiological limit.

function exposureForFocus(focus) {
  const muscles = new Set(focusDefinition(focus)?.muscles ?? []);
  if (muscles.has('midChest')) ['frontDelt', 'triceps'].forEach((id) => muscles.add(id));
  if (muscles.has('lats')) ['biceps', 'rearDelt'].forEach((id) => muscles.add(id));
  return muscles;
}

function arrangeFocuses(focuses, weekdays) {
  let best = focuses;
  let lowest = Infinity;
  const visit = (remaining, order) => {
    if (remaining.length) {
      for (const focus of new Set(remaining)) {
        const index = remaining.indexOf(focus);
        visit(remaining.filter((_, i) => i !== index), [...order, focus]);
      }
      return;
    }
    let cost = 0;
    for (let a = 0; a < order.length; a += 1) {
      for (let b = a + 1; b < order.length; b += 1) {
        const gap = hoursBetween(weekdays[a], weekdays[b]);
        if (gap >= RECOVERY_HOURS) continue;
        const first = exposureForFocus(order[a]);
        cost += [...exposureForFocus(order[b])].filter((id) => first.has(id)).length * (RECOVERY_HOURS - gap);
      }
    }
    if (cost < lowest) { lowest = cost; best = order; }
  };
  visit(focuses, []);
  return best;
}

export function analyzePlan(days, targets, context = {}) {
  const volume = emptyVolume();
  const groupedVolume = Object.fromEntries(Object.keys(VOLUME_GROUPS).map((id) => [id, 0]));
  const directVolume = { ...groupedVolume };
  const frequency = { ...groupedVolume };
  const qualifiedVolume = { ...groupedVolume };
  const regionalVolume = Object.fromEntries(Object.keys(MUSCLE_REGIONS).map((id) => [id, 0]));
  const workloads = [];
  days.forEach((day) => {
    const trained = new Set();
    day.exercises.forEach((item) => {
      const movement = movementForEntry(item);
      if (!movement) return;
      addVolume(volume, movement, item.sets);
      for (const [id, coefficient] of Object.entries(groupCoefficients(movement))) groupedVolume[id] += coefficient * item.sets;
      for (const id of directGroups(movement)) { directVolume[id] += item.sets; trained.add(id); }
      const workload = plannedEntryMetrics(item, movement, context);
      workloads.push({ ...workload, movementId: item.movementId, variantId: item.variantId });
      for (const [id, coefficient] of Object.entries(groupCoefficients(movement))) qualifiedVolume[id] += coefficient * workload.matchedSets;
      for (const [id, coefficient] of Object.entries(movement.regions ?? {})) if (MUSCLE_REGIONS[id]) regionalVolume[id] += coefficient * item.sets;
    });
    trained.forEach((id) => { frequency[id] += 1; });
  });
  // Keep regional estimates for old backups; the scheduler and UI use groupCoverage.
  const coverage = Object.fromEntries(Object.keys(MUSCLES).map((id) => [id, {
    sets: Math.round(volume[id] * 10) / 10,
    target: targets[id],
    percent: targets[id] ? Math.round(volume[id] / targets[id] * 100) : 0,
  }]));
  const budgets = groupTargets(targets);
  const groupCoverage = Object.fromEntries(Object.keys(VOLUME_GROUPS).map((id) => [id, {
    sets: Math.round(groupedVolume[id] * 10) / 10,
    directSets: directVolume[id],
    frequency: frequency[id],
    qualifiedSets: round(qualifiedVolume[id]),
    target: Math.round(budgets[id] * 10) / 10,
    percent: budgets[id] ? Math.round(groupedVolume[id] / budgets[id] * 100) : 0,
  }]));
  const regionCoverage = Object.fromEntries(Object.entries(regionalVolume).map(([id, sets]) => [id, { sets: round(sets), ...MUSCLE_REGIONS[id] }]));
  return { volume, coverage, groupedVolume, directVolume, groupCoverage, regionCoverage, workloads };
}

export function analyzeRecords(records, targets) {
  const groups = Object.fromEntries(Object.keys(VOLUME_GROUPS).map((id) => [id, { sets: 0, targetSets: 0, matchedSets: 0, challengingSets: 0 }]));
  const regions = Object.fromEntries(Object.keys(MUSCLE_REGIONS).map((id) => [id, { sets: 0, targetSets: 0, matchedSets: 0 }]));
  const entries = [];
  for (const record of records) for (const entry of record.exercises ?? []) {
    const movement = movementForEntry(entry);
    if (!movement) continue;
    const workload = summarizeEntry(entry, movement, { bodyWeight: record.bodyWeight });
    entries.push({ date: record.date, movementId: entry.movementId, variantId: entry.variantId, ...workload });
    for (const [id, coefficient] of Object.entries(groupCoefficients(movement))) {
      groups[id].sets += coefficient * workload.sets;
      groups[id].targetSets += coefficient * workload.targetSets;
      groups[id].matchedSets += coefficient * workload.matchedSets;
      groups[id].challengingSets += coefficient * workload.challengingSets;
    }
    for (const [id, coefficient] of Object.entries(movement.regions ?? {})) if (regions[id]) {
      regions[id].sets += coefficient * workload.sets;
      regions[id].targetSets += coefficient * workload.targetSets;
      regions[id].matchedSets += coefficient * workload.matchedSets;
    }
  }
  const budgets = groupTargets(targets);
  return { groups: Object.fromEntries(Object.entries(groups).map(([id, values]) => [id, { ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, round(value)])), target: budgets[id], percent: budgets[id] ? Math.round(values.sets / budgets[id] * 100) : 0 }])), regions, entries };
}

export function getVolumeSources(days, groupId) {
  if (!VOLUME_GROUPS[groupId]) return [];
  return days.flatMap((day) => day.exercises.flatMap((entry) => {
    const movement = movementForEntry(entry);
    if (!movement) return [];
    const coefficient = groupCoefficients(movement)[groupId] ?? 0;
    if (!coefficient || !(entry.sets > 0)) return [];
    return [{ exerciseId: entry.id, dayId: day.id, weekday: day.weekday, dayTitle: day.title, movementId: movement.id, name: movement.name,
      variantName: movement.variants.find((variant) => variant.id === entry.variantId)?.name ?? '', sets: entry.sets, coefficient,
      contribution: entry.sets * coefficient, role: directGroups(movement).includes(groupId) ? '主要' : '辅助' }];
  }));
}

function dailyDirectVolume(day) {
  const volume = Object.fromEntries(Object.keys(VOLUME_GROUPS).map((id) => [id, 0]));
  day.exercises.forEach((item) => directGroups(movementForEntry(item)).forEach((id) => { volume[id] += item.sets; }));
  return volume;
}

function localBudget(id, days, targets) {
  const count = days.filter((day) => VOLUME_GROUPS[id].muscles.some((muscle) => focusDefinition(day)?.muscles.includes(muscle))).length;
  return Math.min(MAX_DAILY_DIRECT_SETS, targets[id] / Math.max(1, count));
}

function scoreCandidate(movement, sets, day, days, volume, targets, profile) {
  let score = 0;
  const localVolume = dailyDirectVolume(day);
  for (const [id, coefficient] of Object.entries(groupCoefficients(movement))) {
    score += Math.min(Math.max(0, targets[id] - volume[id]), coefficient * sets) / Math.max(1, targets[id]);
  }
  for (const id of directGroups(movement)) {
    const budget = localBudget(id, days, targets);
    score += 2 * Math.min(Math.max(0, budget - localVolume[id]), sets) / Math.max(1, budget);
  }
  // Regional preferences influence choice without adding separate chest/back quotas.
  const preferences = dominantMuscles(movement).map((id) => PREFERENCES.find((p) => p.id === profile.preferences?.[id])?.factor ?? 1);
  score *= preferences.reduce((sum, factor) => sum + factor, 0) / preferences.length;
  const regionPreferences = Object.entries(movement.regions ?? {}).filter(([, coefficient]) => coefficient >= .75).map(([id]) => PREFERENCES.find((preference) => preference.id === profile.regionPreferences?.[id])?.factor ?? 1);
  if (regionPreferences.length) score *= regionPreferences.reduce((sum, factor) => sum + factor, 0) / regionPreferences.length;
  for (const other of days) {
    if (other === day || hoursBetween(day.weekday, other.weekday) >= RECOVERY_HOURS) continue;
    if (other.exercises.some((item) => directGroups(movementForEntry(item)).some((id) => directGroups(movement).includes(id)))) score *= .7;
  }
  const existingPattern = day.exercises.some((item) => item.movementId !== movement.id && movementById(item.movementId).pattern === movement.pattern);
  if (existingPattern) score *= .8;
  const existingEntry = day.exercises.find((item) => item.movementId === movement.id);
  const rest = existingEntry ? movementForEntry(existingEntry).rest : movement.rest;
  const time = sets * (45 + rest) / 60 + (existingEntry ? 0 : 1.2);
  return score / time;
}

function substantialMuscles(day) {
  const volume = emptyVolume();
  day.exercises.forEach((item) => {
    const movement = movementForEntry(item);
    if (!movement) return;
    for (const [id, coefficient] of Object.entries(muscleCoefficients(movement))) {
      if (coefficient >= .35) volume[id] += coefficient * item.sets;
    }
  });
  return Object.keys(volume).filter((id) => volume[id] >= 2);
}

export function getPlanWarnings(days, targets, profile, equipment, attachments) {
  const warnings = [];
  const available = getAvailableMovements(equipment, attachments, profile.excluded).map((movement) => resolveMovement(movement, pickVariant(movement, equipment, attachments, profile.weights, profile.regionPreferences)?.id));
  const analysis = analyzePlan(days, targets);
  for (const day of days) {
    if (!focusDefinition(day)) continue;
    if (day.exercises.some((item) => movementById(item.movementId)?.deletedAt)) warnings.push(`${day.title}包含已从动作库删除的动作；已有安排暂时保留，可替换或重新生成。`);
    if (estimateDay(day) > profile.minutes) warnings.push(`${day.title}约 ${estimateDay(day)} 分钟，超过 ${profile.minutes} 分钟预算；请减少锁定或手动增加的组数。`);
    if (day.exercises.some((item) => !isMovementAllowedForFocus(movementForEntry(item), day))) warnings.push(`${day.title}含有分化范围之外的动作，请替换或重新生成。`);
    for (const block of focusBlocks(day, profile, available)) {
      if (day.exercises.some((item) => matchesBlock(movementForEntry(item), block) && item.sets >= 2)) continue;
      const possible = available.some((movement) => isMovementAllowedForFocus(movement, day) && matchesBlock(movement, block));
      warnings.push(`${day.title}未完成「${block.name}」基础安排：${possible ? '时间不足或锁定动作占用预算，可延长时长或调整分化' : '缺少可用动作，请检查器械与排除设置'}。`);
    }
  }
  for (const [id, data] of Object.entries(analysis.groupCoverage)) {
    if (data.percent > 150) warnings.push(`${VOLUME_GROUPS[id].name}预计折算 ${data.sets} 组，超过 ${data.target} 组预算的 150%；请检查手动加组、锁定动作及辅助参与，不必追求更高百分比。`);
    if (data.percent < 60) warnings.push(`${VOLUME_GROUPS[id].name}估算量为起始预算的 ${data.percent}%；可调整时长、分化或偏好，无需为凑满百分比跨部位加动作。`);
    if (!data.directSets) warnings.push(`${VOLUME_GROUPS[id].name}暂无主要目标动作；辅助参与不能保证充分训练。`);
  }
  const once = Object.entries(analysis.groupCoverage).filter(([id, data]) => ['chest', 'back', 'quads', 'hamstrings'].includes(id) && data.frequency === 1).map(([id]) => VOLUME_GROUPS[id].name);
  if (once.length) warnings.push(`${once.join('、')}本周直接训练仅 1 天；如希望分散训练量、提高频次，可选择上下肢或全身训练。`);
  for (let a = 0; a < days.length; a += 1) {
    for (let b = a + 1; b < days.length; b += 1) {
      const gap = hoursBetween(days[a].weekday, days[b].weekday);
      if (gap >= RECOVERY_HOURS) continue;
      const overlap = substantialMuscles(days[a]).filter((id) => substantialMuscles(days[b]).includes(id));
      if (overlap.length) warnings.push(`周${days[a].weekday || '日'}与周${days[b].weekday || '日'}间隔约 ${gap} 小时，${overlap.map((id) => MUSCLES[id].name).join('、')}负荷重叠；请结合表现调整训练日或组数。`);
    }
  }
  return [...new Set(warnings)];
}

export function createPlan(profile, equipment, attachments, previousPlan = null) {
  const available = getAvailableMovements(equipment, attachments, profile.excluded).map((movement) => {
    const resolved = resolveMovement(movement, pickVariant(movement, equipment, attachments, profile.weights, profile.regionPreferences)?.id);
    return { ...resolved, rest: resolveRest(profile.restSeconds, resolved.rest) };
  });
  const targets = getTargets(profile);
  const budgets = groupTargets(targets);
  // Actual selected weekdays are authoritative if an imported profile has a stale count.
  const weekdays = weekdaysFor(profile);
  const focuses = profile.split === 'custom' ? [] : arrangeFocuses(focusesFor(weekdays.length, profile.split), weekdays);
  const days = weekdays.map((weekday, index) => {
    const day = profile.split === 'custom' ? { focus: 'custom', muscles: customMusclesFor(profile, weekday) } : { focus: focuses[index] };
    return { id: `day-${weekday}`, weekday, ...day, title: focusDefinition(day).title, exercises: [] };
  });
  const generationWarnings = days.filter((day) => day.focus === 'custom' && !day.muscles.length).map((day) => `周${day.weekday || '日'}尚未选择训练部位。`);
  for (const day of days) {
    const oldDay = previousPlan?.days.find((item) => item.weekday === day.weekday);
    const kept = new Set();
    for (const item of oldDay?.exercises ?? []) {
      if (!item.locked) continue;
      const movement = available.find((candidate) => candidate.id === item.movementId);
      if (!movement || !isMovementAllowedForFocus(movement, day)) {
        generationWarnings.push(`${movementById(item.movementId)?.name ?? '锁定动作'}未保留：当前器械、排除设置或当天分化不兼容。`);
        continue;
      }
      if (kept.has(item.movementId)) continue;
      kept.add(item.movementId);
      const variant = getAvailableVariants(movement, equipment, attachments).find((v) => v.id === item.variantId) ?? pickVariant(movement, equipment, attachments, profile.weights);
      day.exercises.push({ ...item, id: `${day.id}-${movement.id}`, variantId: variant.id });
    }
  }
  const volume = analyzePlan(days, targets).groupedVolume;
  const append = (day, movement, sets) => {
    const variant = pickVariant(movement, equipment, attachments, profile.weights, profile.regionPreferences);
    const entry = { id: `${day.id}-${movement.id}`, movementId: movement.id, variantId: variant.id, sets, rest: movement.rest, restSource: resolveRest(profile.restSeconds, null) == null ? 'variant' : 'profile', repRange: [...movement.repRange], rir: movement.rir, weight: profile.weights?.[variant.id] ?? 0, locked: false };
    const prescription = loadPrescription(movement, entry, profile.loadHistory, profile.bodyWeight);
    if (!(entry.weight > 0) && prescription.suggestedWeight != null) entry.weight = prescription.suggestedWeight;
    day.exercises.push(entry);
    for (const [id, coefficient] of Object.entries(groupCoefficients(movement))) volume[id] += coefficient * sets;
  };

  // Reserve the basic movement blocks before spending spare time on weekly deficits.
  // Two sets is a template minimum, not a claim that this fully trains a muscle.
  for (const day of days) {
    for (const block of focusBlocks(day, profile, available)) {
      if (day.exercises.some((item) => matchesBlock(movementForEntry(item), block) && item.sets >= 2)) continue;
      const candidates = available.filter((movement) => isMovementAllowedForFocus(movement, day)
        && matchesBlock(movement, block) && !day.exercises.some((item) => item.movementId === movement.id)
        && estimateDay({ ...day, exercises: [...day.exercises, { movementId: movement.id, variantId: movement.variantId, rest: movement.rest, sets: 2 }] }) <= profile.minutes);
      candidates.sort((a, b) => Number(b.compound) - Number(a.compound)
        || scoreCandidate(b, 2, day, days, volume, budgets, profile) - scoreCandidate(a, 2, day, days, volume, budgets, profile));
      if (candidates[0]) append(day, candidates[0], 2);
    }
  }

  // Greedy marginal allocation under hard focus/time limits. No global optimality claim.
  // Compare all days each step so the first day cannot consume the whole weekly budget.
  for (let guard = 0; guard < 300; guard += 1) {
    let best = null;
    for (const day of days) {
      const local = dailyDirectVolume(day);
      for (const movement of available) {
        if (!isMovementAllowedForFocus(movement, day)) continue;
        const existing = day.exercises.find((item) => item.movementId === movement.id);
        if (existing?.locked || existing?.sets >= MAX_EXERCISE_SETS) continue;
        const sets = existing ? 1 : 2;
        const primaryGroups = directGroups(movement);
        if (primaryGroups.some((id) => local[id] + sets > MAX_DAILY_DIRECT_SETS)) continue;
        if (!primaryGroups.some((id) => volume[id] < budgets[id] && local[id] < localBudget(id, days, budgets))) continue;
        const exercises = existing
          ? day.exercises.map((item) => item === existing ? { ...item, sets: item.sets + sets } : item)
          : [...day.exercises, { movementId: movement.id, variantId: movement.variantId, rest: movement.rest, sets }];
        if (estimateDay({ ...day, exercises }) > profile.minutes) continue;
        const score = scoreCandidate(movement, sets, day, days, volume, budgets, profile);
        if (!best || score > best.score) best = { day, movement, existing, sets, score };
      }
    }
    if (!best || best.score <= 0) break;
    if (best.existing) {
      best.existing.sets += best.sets;
      for (const [id, coefficient] of Object.entries(groupCoefficients(best.movement))) volume[id] += coefficient * best.sets;
    } else append(best.day, best.movement, best.sets);
  }
  // Perform compound work before smaller isolation exercises; preserve relative order.
  days.forEach((day) => day.exercises.sort((a, b) => Number(movementById(b.movementId).compound) - Number(movementById(a.movementId).compound)));
  const analysis = analyzePlan(days, targets, profile);
  return {
    id: `plan-${Date.now()}`, algorithmVersion: ALGORITHM_VERSION, muscleModelVersion: MUSCLE_MODEL_VERSION, doseModelVersion: DOSE_MODEL_VERSION, createdAt: new Date().toISOString(),
    profile: structuredClone({ ...profile, daysPerWeek: weekdays.length, weekdays }),
    equipment: [...equipment], attachments: [...attachments], days, targets, analysis, generationWarnings,
    warnings: [...new Set([...generationWarnings, ...getPlanWarnings(days, targets, profile, equipment, attachments)])],
  };
}

export function getProgressionAdvice(movement, sets, repRange, { bodyWeight, plannedSets } = {}) {
  movement = resolveMovement(movement, movement.variantId ?? (movement.variants?.length === 1 ? movement.variants[0].id : undefined));
  repRange ??= movement.repRange;
  sets = sets?.filter((set) => set.kind !== 'warmup');
  if (!sets?.length) return { type: 'hold', text: '完成本次记录后生成建议', delta: 0 };
  const assessed = sets.map((set) => assessWorkSet(set, movement, repRange, bodyWeight));
  if (assessed.some((set) => !set.known)) return { type: 'hold', text: '补全有效重量、次数、RIR 和所需体重后再判断', delta: 0 };
  if (plannedSets > sets.length) return { type: 'hold', text: '完成计划工作组后再判断进阶', delta: 0 };
  const weights = sets.map((set) => Number(set.weight));
  if (weights.some((weight) => weight !== weights[0])) return { type: 'hold', text: '各组重量不同，先按相同工作重量比较', delta: 0 };
  const [low, high] = repRange;
  const isTimed = movement.loadMode === 'timed' || movement.id === 'plank';
  const allAtTop = assessed.every((set) => set.reps >= high && set.rir >= 1);
  const allEasy = !isTimed && assessed.every((set) => set.reps >= (low + high) / 2 && set.rir >= 4);
  const tooHard = assessed.filter((set) => set.heavy).length > assessed.length / 2;
  const increment = numeric(movement.increment) && movement.increment > 0 ? Number(movement.increment) : 1;
  const change = (up) => {
    const prefix = up ? (allEasy ? '各组余力充足，下次尝试' : '下次尝试') : '多数组低于次数下限且接近力竭，下次尝试';
    if (isTimed) return { type: up ? 'up' : 'down', text: up ? '下次增加 5 秒支撑时间' : '下次缩短 5 秒支撑时间', delta: up ? 5 : -5 };
    if (movement.loadMode === 'bodyweightPartial') return { type: up ? 'up' : 'down', text: up ? '提高动作难度，再从目标次数下限开始' : '降低动作难度，回到目标次数范围', delta: 0 };
    const assisted = movement.loadMode === 'assisted';
    if (assisted && up && weights[0] === 0) return { type: 'up', text: '已无需辅助，可尝试自重版本', delta: 0 };
    const delta = (up !== assisted ? 1 : -1) * increment;
    const nextWeight = Math.max(0, weights[0] + delta);
    if (!assisted && !up && nextWeight === 0) return { type: 'down', text: '尝试更小重量档位或更容易的动作版本', delta: 0 };
    return { type: up ? 'up' : 'down', text: `${prefix}${assisted ? (up ? '减少辅助至' : '增加辅助至') : (up ? '加重至' : '减重至')} ${nextWeight} kg`, delta: nextWeight - weights[0], nextWeight };
  };
  if (tooHard) return change(false);
  if (allAtTop || allEasy) return change(true);
  if (assessed.some((set) => set.failure)) return { type: 'hold', text: isTimed ? '先在当前目标时长留出余力，再延长支撑' : '先保持重量，在目标次数内留出余力', delta: 0 };
  if (assessed.some((set) => !set.target)) return { type: 'hold', text: isTimed ? '先完成目标支撑时长，再判断进阶' : '先保持重量，补足未完成组的目标次数', delta: 0 };
  return { type: 'hold', text: isTimed ? '保持当前难度，逐步延长支撑时间' : '保持重量，逐步增加次数并保留 1–3 次余力', delta: 0 };
}

export function createInitialLogs(plan) {
  return plan.days.map((day) => ({
    dayId: day.id,
    exercises: day.exercises.filter((item) => movementById(item.movementId)).map((item) => {
      const movement = movementForEntry(item);
      const repRange = item.repRange ?? movement.repRange;
      return {
        movementId: item.movementId,
        variantId: item.variantId,
        movementSnapshot: structuredClone(movement),
        plannedSets: item.sets,
        rest: movement.rest,
        repRange,
        sets: Array.from({ length: item.sets }, () => ({
          weight: item.weight || 0,
          reps: repRange[0],
          rir: item.rir ?? movement.rir,
          kind: 'work',
        })),
      };
    }),
  }));
}

// ---- v1 → v2 迁移：旧数据中的 exerciseId 即新版本 id ----

export function migrateLegacyEntry(entry) {
  if (entry.movementId) {
    if (entry.movementId === 'chest-fly' && entry.variantId === 'crossover-fly') return { ...entry, movementId: 'high-to-low-fly' };
    return entry;
  }
  const movementId = movementIdForVariant(entry.exerciseId);
  if (!movementId) return null;
  const { exerciseId, ...rest } = entry;
  return { ...rest, movementId, variantId: exerciseId };
}

export function migrateLegacyPlan(plan) {
  if (!plan?.days) return null;
  const days = plan.days.map((day) => ({
    ...day,
    title: FOCUSES[day.focus]?.title ?? day.title,
    exercises: (day.exercises ?? []).map(migrateLegacyEntry).filter(Boolean),
  }));
  if (plan.targets || plan.profile) {
    const targets = plan.targets ?? getTargets(plan.profile);
    return { ...plan, days, targets, analysis: analyzePlan(days, targets) };
  }
  return { ...plan, days };
}

export function migrateLegacyLogs(logs) {
  if (!Array.isArray(logs)) return [];
  return logs.map((log) => ({
    ...log,
    exercises: (log.exercises ?? []).map(migrateLegacyEntry).filter(Boolean),
  }));
}

export function migrateLegacyProfile(profile) {
  if (!profile) return profile;
  const excluded = [...new Set((profile.excluded ?? []).map((id) => movementIdForVariant(id) ?? id))];
  return { ...profile, excluded };
}
