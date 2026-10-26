import {
  MOVEMENTS, EQUIPMENT, MUSCLES, LEVELS, PREFERENCES,
} from '../data/exercises.js';
import {
  ALGORITHM_VERSION, FOCUSES, VOLUME_GROUPS, directGroups, dominantMuscles, focusesFor,
  groupCoefficients, groupTargets, isMovementAllowedForFocus, matchesBlock,
} from './training.js';

// 用户通过自定义表单添加的器械与动作，与内置数据同等参与筛选和计划生成。
let customData = { equipment: [], movements: [] };
export function setCustomData(data) {
  customData = { equipment: data?.equipment ?? [], movements: data?.movements ?? [] };
}
export const allMovements = () => [...MOVEMENTS, ...customData.movements];
export const allEquipment = () => [...EQUIPMENT, ...customData.equipment];

export const movementById = (id) => allMovements().find((movement) => movement.id === id);

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
export function pickVariant(movement, equipment, attachments, weights = {}) {
  const available = getAvailableVariants(movement, equipment, attachments);
  if (!available.length) return null;
  return available.find((variant) => (weights[variant.id] ?? 0) > 0) ?? available[0];
}

// 将动作的主＋辅肌群系数归一化为占比，用于界面展示相对强度（估算值，非实测）。
export function muscleShares(movement) {
  const entries = Object.entries({ ...movement.primary, ...movement.secondary });
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (!total) return [];
  const shares = entries.map(([id, value]) => ({ id, percent: Math.round(value / total * 100) }))
    .sort((a, b) => b.percent - a.percent);
  shares[0].percent += 100 - shares.reduce((sum, item) => sum + item.percent, 0);
  return shares;
}

// Volume targets are adjustable starting budgets. Training age alone cannot predict
// an individual's optimal volume; there is no muscle-specific growth multiplier.
export function getTargets(profile) {
  const level = LEVELS[profile.level] ?? LEVELS.intermediate;
  return Object.fromEntries(Object.keys(MUSCLES).map((id) => {
    const preference = PREFERENCES.find((item) => item.id === profile.preferences?.[id]) ?? PREFERENCES[2];
    return [id, Math.round(level.baseSets * preference.factor * 10) / 10];
  }));
}

function emptyVolume() {
  return Object.fromEntries(Object.keys(MUSCLES).map((id) => [id, 0]));
}

function addVolume(volume, movement, sets) {
  for (const [muscle, coefficient] of Object.entries({ ...movement.primary, ...movement.secondary })) {
    volume[muscle] = (volume[muscle] ?? 0) + coefficient * sets;
  }
}

export function estimateDay(day) {
  if (!day?.exercises?.length) return 8;
  const work = day.exercises.reduce((total, item) => {
    const movement = movementById(item.movementId);
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
  const muscles = new Set(FOCUSES[focus].muscles);
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

export function analyzePlan(days, targets) {
  const volume = emptyVolume();
  const groupedVolume = Object.fromEntries(Object.keys(VOLUME_GROUPS).map((id) => [id, 0]));
  const directVolume = { ...groupedVolume };
  const frequency = { ...groupedVolume };
  days.forEach((day) => {
    const trained = new Set();
    day.exercises.forEach((item) => {
      const movement = movementById(item.movementId);
      if (!movement) return;
      addVolume(volume, movement, item.sets);
      for (const [id, coefficient] of Object.entries(groupCoefficients(movement))) groupedVolume[id] += coefficient * item.sets;
      for (const id of directGroups(movement)) { directVolume[id] += item.sets; trained.add(id); }
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
    target: Math.round(budgets[id] * 10) / 10,
    percent: budgets[id] ? Math.round(groupedVolume[id] / budgets[id] * 100) : 0,
  }]));
  return { volume, coverage, groupedVolume, directVolume, groupCoverage };
}

function dailyDirectVolume(day) {
  const volume = Object.fromEntries(Object.keys(VOLUME_GROUPS).map((id) => [id, 0]));
  day.exercises.forEach((item) => directGroups(movementById(item.movementId)).forEach((id) => { volume[id] += item.sets; }));
  return volume;
}

function localBudget(id, days, targets) {
  const count = days.filter((day) => VOLUME_GROUPS[id].muscles.some((muscle) => FOCUSES[day.focus].muscles.includes(muscle))).length;
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
  for (const other of days) {
    if (other === day || hoursBetween(day.weekday, other.weekday) >= RECOVERY_HOURS) continue;
    if (other.exercises.some((item) => directGroups(movementById(item.movementId)).some((id) => directGroups(movement).includes(id)))) score *= .7;
  }
  const existingPattern = day.exercises.some((item) => item.movementId !== movement.id && movementById(item.movementId).pattern === movement.pattern);
  if (existingPattern) score *= .8;
  const time = sets * (45 + movement.rest) / 60 + (day.exercises.some((item) => item.movementId === movement.id) ? 0 : 1.2);
  return score / time;
}

function substantialMuscles(day) {
  const volume = emptyVolume();
  day.exercises.forEach((item) => {
    const movement = movementById(item.movementId);
    if (!movement) return;
    for (const [id, coefficient] of Object.entries({ ...movement.primary, ...movement.secondary })) {
      if (coefficient >= .35) volume[id] += coefficient * item.sets;
    }
  });
  return Object.keys(volume).filter((id) => volume[id] >= 2);
}

export function getPlanWarnings(days, targets, profile, equipment, attachments) {
  const warnings = [];
  const available = getAvailableMovements(equipment, attachments, profile.excluded);
  const analysis = analyzePlan(days, targets);
  for (const day of days) {
    if (!FOCUSES[day.focus]) continue;
    if (estimateDay(day) > profile.minutes) warnings.push(`${day.title}约 ${estimateDay(day)} 分钟，超过 ${profile.minutes} 分钟预算；请减少锁定或手动增加的组数。`);
    if (day.exercises.some((item) => !isMovementAllowedForFocus(movementById(item.movementId), day.focus))) warnings.push(`${day.title}含有分化范围之外的动作，请替换或重新生成。`);
    for (const block of FOCUSES[day.focus].blocks) {
      if (day.exercises.some((item) => matchesBlock(movementById(item.movementId), block) && item.sets >= 2)) continue;
      const possible = available.some((movement) => isMovementAllowedForFocus(movement, day.focus) && matchesBlock(movement, block));
      warnings.push(`${day.title}未完成「${block.name}」基础安排：${possible ? '时间不足或锁定动作占用预算，可延长时长或调整分化' : '缺少可用动作，请检查器械与排除设置'}。`);
    }
  }
  for (const [id, data] of Object.entries(analysis.groupCoverage)) {
    if (data.percent < 60) warnings.push(`${VOLUME_GROUPS[id].name}估算量为起始预算的 ${data.percent}%；可调整时长、分化或偏好，无需为凑满百分比跨部位加动作。`);
    if (!data.directSets) warnings.push(`${VOLUME_GROUPS[id].name}暂无主导目标动作；辅助参与不能保证充分训练。`);
  }
  const once = Object.entries(analysis.groupCoverage).filter(([id, data]) => ['chest', 'back', 'quads', 'hamstrings'].includes(id) && data.frequency === 1).map(([id]) => VOLUME_GROUPS[id].name);
  if (once.length) warnings.push(`${once.join('、')}本周主导训练仅 1 天；如希望分散训练量、提高频次，可选择上下肢或全身训练。`);
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
  const available = getAvailableMovements(equipment, attachments, profile.excluded);
  const targets = getTargets(profile);
  const budgets = groupTargets(targets);
  // Actual selected weekdays are authoritative if an imported profile has a stale count.
  const weekdays = [...new Set(profile.weekdays)].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).sort((a, b) => (a || 7) - (b || 7)).slice(0, 6);
  const focuses = arrangeFocuses(focusesFor(weekdays.length, profile.split), weekdays);
  const days = weekdays.map((weekday, index) => ({
    id: `day-${weekday}`, weekday, focus: focuses[index], title: FOCUSES[focuses[index]].title, exercises: [],
  }));
  const generationWarnings = [];
  for (const day of days) {
    const oldDay = previousPlan?.days.find((item) => item.weekday === day.weekday);
    const kept = new Set();
    for (const item of oldDay?.exercises ?? []) {
      if (!item.locked) continue;
      const movement = available.find((candidate) => candidate.id === item.movementId);
      if (!movement || !isMovementAllowedForFocus(movement, day.focus)) {
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
    const variant = pickVariant(movement, equipment, attachments, profile.weights);
    day.exercises.push({ id: `${day.id}-${movement.id}`, movementId: movement.id, variantId: variant.id, sets, weight: profile.weights?.[variant.id] ?? 0, locked: false });
    for (const [id, coefficient] of Object.entries(groupCoefficients(movement))) volume[id] += coefficient * sets;
  };

  // Reserve the basic movement blocks before spending spare time on weekly deficits.
  // Two sets is a template minimum, not a claim that this fully trains a muscle.
  for (const day of days) {
    for (const block of FOCUSES[day.focus].blocks) {
      if (day.exercises.some((item) => matchesBlock(movementById(item.movementId), block) && item.sets >= 2)) continue;
      const candidates = available.filter((movement) => isMovementAllowedForFocus(movement, day.focus)
        && matchesBlock(movement, block) && !day.exercises.some((item) => item.movementId === movement.id)
        && estimateDay({ ...day, exercises: [...day.exercises, { movementId: movement.id, sets: 2 }] }) <= profile.minutes);
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
        if (!isMovementAllowedForFocus(movement, day.focus)) continue;
        const existing = day.exercises.find((item) => item.movementId === movement.id);
        if (existing?.locked || existing?.sets >= MAX_EXERCISE_SETS) continue;
        const sets = existing ? 1 : 2;
        const primaryGroups = directGroups(movement);
        if (primaryGroups.some((id) => local[id] + sets > MAX_DAILY_DIRECT_SETS)) continue;
        if (!primaryGroups.some((id) => volume[id] < budgets[id] && local[id] < localBudget(id, days, budgets))) continue;
        const exercises = existing
          ? day.exercises.map((item) => item === existing ? { ...item, sets: item.sets + sets } : item)
          : [...day.exercises, { movementId: movement.id, sets }];
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
  const analysis = analyzePlan(days, targets);
  return {
    id: `plan-${Date.now()}`, algorithmVersion: ALGORITHM_VERSION, createdAt: new Date().toISOString(),
    profile: structuredClone({ ...profile, daysPerWeek: weekdays.length, weekdays }),
    equipment: [...equipment], attachments: [...attachments], days, targets, analysis, generationWarnings,
    warnings: [...new Set([...generationWarnings, ...getPlanWarnings(days, targets, profile, equipment, attachments)])],
  };
}

export function getProgressionAdvice(movement, sets, repRange = movement.repRange) {
  if (!sets?.length) return { type: 'hold', text: '完成本次记录后生成建议', delta: 0 };
  const valid = sets.every((set) => ['reps', 'rir'].every((field) => set[field] !== '' && set[field] != null && Number.isFinite(Number(set[field])) && Number(set[field]) >= 0));
  if (!valid) return { type: 'hold', text: '补全有效的次数和 RIR 后再判断进阶', delta: 0 };
  if (sets.some((set) => set.weight != null)) {
    const weights = sets.map((set) => set.weight === '' || set.weight == null ? NaN : Number(set.weight));
    if (weights.some((weight) => !Number.isFinite(weight) || weight < 0 || weight !== weights[0])) return { type: 'hold', text: '先使用同一工作重量完成各组，再判断是否加重', delta: 0 };
  }
  const [low, high] = repRange;
  const isTimed = movement.id === 'plank';
  const allAtTop = sets.every((set) => Number(set.reps) >= high);
  const enoughReserve = sets.every((set) => Number(set.rir) >= 1);
  const tooHard = sets.some((set) => Number(set.reps) < low || Number(set.rir) < 1);
  if (allAtTop && enoughReserve) return { type: 'up', text: `下次 ${isTimed ? '增加 5 秒' : `增加 ${movement.increment} kg`}`, delta: movement.increment };
  if (tooHard) return { type: 'down', text: '先保持重量；动作变形或 RIR＜1 时减重 5–10%', delta: 0 };
  return { type: 'hold', text: '保持重量，尝试在部分组增加 1 次', delta: 0 };
}

export function createInitialLogs(plan) {
  return plan.days.map((day) => ({
    dayId: day.id,
    exercises: day.exercises.map((item) => {
      const movement = movementById(item.movementId);
      const repRange = item.repRange ?? movement.repRange;
      return {
        movementId: item.movementId,
        variantId: item.variantId,
        repRange,
        sets: Array.from({ length: item.sets }, () => ({
          weight: item.weight || 0,
          reps: repRange[0],
          rir: movement.rir,
        })),
      };
    }),
  }));
}

// ---- v1 → v2 迁移：旧数据中的 exerciseId 即新版本 id ----

export function migrateLegacyEntry(entry) {
  if (entry.movementId) return entry;
  const movementId = movementIdForVariant(entry.exerciseId);
  if (!movementId) return null;
  const { exerciseId, ...rest } = entry;
  return { ...rest, movementId, variantId: exerciseId };
}

export function migrateLegacyPlan(plan) {
  if (!plan?.days) return null;
  const days = plan.days.map((day) => ({
    ...day,
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
