import { MUSCLES, MUSCLE_GROUPS, MUSCLE_REGIONS } from '../data/exercises.js';

export const ALGORITHM_VERSION = 6;
export const resolveRest = (value, fallback) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 900 ? value : fallback;
export function restForReplacement(entry, profile, variantRest) {
  const saved = resolveRest(entry?.rest, null);
  if (saved != null && entry.restSource !== 'variant') return { rest: saved, restSource: entry.restSource ?? 'custom' };
  const setting = resolveRest(profile.restSeconds, null);
  return { rest: setting ?? variantRest, restSource: setting == null ? 'variant' : 'profile' };
}

// These are scheduling templates, not evidence that one split produces more growth.
export const SPLITS = [
  { id: 'focused', name: '部位分化', description: '3 练推拉腿；4–5 练按部位集中；6–7 练循环推拉腿。' },
  { id: 'upperLower', name: '上下肢分化', description: '上肢与下肢交替，适合希望提高各部位周频次的安排。' },
  { id: 'full', name: '全身训练', description: '每次覆盖主要部位，适合训练日较少或偏好全身训练。' },
  { id: 'custom', name: '自定义分化', description: '按星期选择每天的训练肌群。' },
];

const chest = ['upperChest', 'midChest', 'lowerChest'];
const back = ['lats', 'upperBack'];
const shoulders = ['frontDelt', 'sideDelt', 'rearDelt'];
const legs = [...MUSCLE_GROUPS.lower.muscles, 'core'];
const block = (name, patterns, muscles = null) => ({ name, patterns, muscles });
const chestBlocks = [block('胸部推举', ['press']), block('胸部夹胸', ['fly'])];
const backBlocks = [block('垂直拉', ['verticalPull']), block('水平划船', ['row'])];
const legBlocks = [block('股四头肌', ['squat', 'lunge', 'legExtension']), block('腘绳肌', ['legCurl', 'hinge'], ['hamstrings']), block('小腿', ['calf']), block('核心', ['core']), block('髋伸', ['hinge', 'hip'])];
const shoulderBlocks = [block('肩部推举', ['overheadPress']), block('肩中束', ['lateral']), block('肩后束', ['rearFly'])];

export const FOCUSES = {
  full: { title: '全身训练', muscles: Object.keys(MUSCLES), blocks: [chestBlocks[0], backBlocks[0], legBlocks[0], legBlocks[1]] },
  upper: { title: '上肢训练', muscles: MUSCLE_GROUPS.upper.muscles, blocks: [chestBlocks[0], ...backBlocks, shoulderBlocks[1], block('肱三头肌', ['triceps']), block('肱二头肌', ['curl'])] },
  lower: { title: '下肢＋核心训练', muscles: legs, blocks: legBlocks },
  push: { title: '推训练', muscles: [...chest, 'frontDelt', 'sideDelt', 'triceps'], blocks: [chestBlocks[0], shoulderBlocks[1], block('肱三头肌', ['triceps'])] },
  pull: { title: '拉训练', muscles: [...back, 'rearDelt', 'biceps', 'forearms'], blocks: [...backBlocks, block('肱二头肌', ['curl']), shoulderBlocks[2]] },
  legs: { title: '腿训练', muscles: legs, blocks: legBlocks },
  chestTriceps: { title: '胸部＋三头训练', muscles: [...chest, 'triceps'], blocks: [...chestBlocks, block('肱三头肌', ['triceps'])] },
  backBiceps: { title: '背部＋二头训练', muscles: [...back, 'biceps', 'forearms'], blocks: [...backBlocks, block('肱二头肌', ['curl'])] },
  shoulders: { title: '肩部训练', muscles: shoulders, blocks: shoulderBlocks },
  chest: { title: '胸部训练', muscles: chest, blocks: chestBlocks },
  back: { title: '背部训练', muscles: [...back, 'rearDelt'], blocks: [...backBlocks, shoulderBlocks[2]] },
  arms: { title: '手臂＋核心训练', muscles: ['biceps', 'triceps', 'forearms', 'core'], blocks: [block('肱二头肌', ['curl']), block('肱三头肌', ['triceps']), block('前臂', ['forearm']), block('核心', ['core'])] },
};

export const weekdaysFor = (profile) => [...new Set(profile.weekdays ?? [])].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).sort((a, b) => (a || 7) - (b || 7));
export function customMusclesFor(profile, weekday) {
  const setting = profile.customSchedule?.[weekday];
  const muscles = Array.isArray(setting) ? setting : setting?.muscles;
  return [...new Set(Array.isArray(muscles) ? muscles : [])].filter((id) => MUSCLES[id]);
}

export function seedCustomSchedule(profile) {
  const weekdays = weekdaysFor(profile);
  const focuses = focusesFor(weekdays.length, profile.split === 'custom' ? 'focused' : profile.split);
  return { ...profile.customSchedule, ...Object.fromEntries(weekdays.map((weekday, index) => [weekday,
    profile.customSchedule?.[weekday] ?? { muscles: [...FOCUSES[focuses[index]].muscles] },
  ])) };
}

export function focusDefinition(focus) {
  if (typeof focus === 'string') return FOCUSES[focus];
  if (!focus) return null;
  if (focus.focus !== 'custom') return FOCUSES[focus.focus];
  const muscles = [...new Set(focus.muscles ?? [])].filter((id) => MUSCLES[id]);
  const names = [];
  const remaining = new Set(muscles);
  for (const [name, parts] of [['胸部', chest], ['背部', back], ['肩部', shoulders]]) {
    if (parts.every((id) => remaining.has(id))) { names.push(name); parts.forEach((id) => remaining.delete(id)); }
  }
  names.push(...[...remaining].map((id) => MUSCLES[id].name.replace('（多肌合并）', '')));
  const definitions = [
    [chest, block('胸部', ['press', 'fly'], chest)],
    [back, block('背部', ['verticalPull', 'row', 'pulldown'], back)],
    [['frontDelt'], block('肩前束', ['overheadPress', 'frontRaise'], ['frontDelt'])],
    [['sideDelt'], block('肩中束', ['lateral'], ['sideDelt'])],
    [['rearDelt'], block('肩后束', ['rearFly'], ['rearDelt'])],
    [['biceps'], block('肱二头肌', ['curl'], ['biceps'])],
    [['triceps'], block('肱三头肌', ['triceps'], ['triceps'])],
    [['forearms'], block('前臂', ['forearm', 'curl'], ['forearms'])],
    [['quads'], block('股四头肌', ['squat', 'lunge', 'legExtension'], ['quads'])],
    [['hamstrings'], block('腘绳肌', ['legCurl', 'hinge'], ['hamstrings'])],
    [['glutes'], block('臀部', ['hip', 'hinge', 'abduction', 'lunge'], ['glutes'])],
    [['calves'], block('小腿', ['calf'], ['calves'])],
    [['core'], block('核心', ['core'], ['core'])],
  ];
  return { title: names.length ? `${names.join('＋')}训练` : '自定义训练', muscles, blocks: definitions.filter(([parts]) => parts.some((id) => muscles.includes(id))).map(([, definition]) => definition) };
}

// Regional chest/back labels guide exercise selection, not independent full-volume quotas.
export const VOLUME_GROUPS = {
  chest: { name: '胸部（合计）', muscles: chest, note: '胸大肌各区域合并统计，区域偏好不代表能隔离某一块胸肌。' },
  back: { name: '背部（合计）', muscles: back, note: '背阔与肩胛相关肌群合并统计；总量不能证明每个背部子肌群都已练够。' },
  ...Object.fromEntries(Object.entries(MUSCLES).filter(([id]) => ![...chest, ...back].includes(id)).map(([id, muscle]) => [id, { name: muscle.name, muscles: [id], note: muscle.volumeNote }])),
};

export function dominantMuscles(movement) {
  const highest = Math.max(...Object.values(movement.primary));
  return Object.keys(movement.primary).filter((id) => movement.primary[id] === highest);
}

export function isMovementAllowedForFocus(movement, focus) {
  const allowed = focusDefinition(focus)?.muscles;
  return Boolean(movement && allowed && dominantMuscles(movement).every((id) => allowed.includes(id)));
}

export function matchesBlock(movement, block) {
  return Boolean(movement && block.patterns.includes(movement.pattern)
    && (!block.muscles || dominantMuscles(movement).some((id) => block.muscles.includes(id)))
    && (!block.regions || block.regions.some((id) => (movement.regions?.[id] ?? 0) >= .75)));
}

export function focusBlocks(focus, profile = {}, available = []) {
  const definition = focusDefinition(focus);
  const base = definition?.blocks ?? [];
  const extra = Object.entries(profile.regionPreferences ?? {}).filter(([, preference]) => ['enhance', 'priority'].includes(preference)).flatMap(([id]) => {
    const region = MUSCLE_REGIONS[id];
    const parent = region?.muscle ?? { erectors: 'hamstrings', adductorMagnus: 'quads', brachialis: 'biceps', serratus: 'frontDelt', rotatorCuff: 'rearDelt' }[id];
    if (!parent || !definition?.muscles.includes(parent)) return [];
    const patterns = [...new Set(available.filter((movement) => isMovementAllowedForFocus(movement, focus) && (movement.regions?.[id] ?? 0) >= .75).map((movement) => movement.pattern))];
    return patterns.length ? [{ name: region.name, patterns, regions: [id] }] : [];
  });
  return [...base, ...extra];
}

export function focusesFor(days, split = 'focused') {
  if (days <= 1 || split === 'full') return Array.from({ length: days }, () => 'full');
  if (split === 'upperLower' || days === 2) return Array.from({ length: days }, (_, index) => index % 2 ? 'lower' : 'upper');
  if (days === 3) return ['push', 'pull', 'legs'];
  if (days === 4) return ['chestTriceps', 'backBiceps', 'legs', 'shoulders'];
  if (days === 5) return ['chest', 'back', 'legs', 'shoulders', 'arms'];
  return Array.from({ length: days }, (_, index) => ['push', 'pull', 'legs'][index % 3]);
}

export function groupTargets(targets) {
  return Object.fromEntries(Object.entries(VOLUME_GROUPS).map(([id, group]) => [id,
    group.muscles.reduce((sum, muscle) => sum + (targets[muscle] ?? 0), 0) / group.muscles.length,
  ]));
}

// Stabilizers and weak/non-target participants are listed, but do not automatically
// count as hypertrophy sets. Explicit primary targets take precedence on overlap.
export function muscleCoefficients(movement) {
  const excluded = new Set(movement.stabilizers ?? []);
  return Object.fromEntries(Object.entries({ ...movement.secondary, ...movement.primary })
    .filter(([id, coefficient]) => MUSCLES[id] && Number.isFinite(coefficient) && coefficient > 0 && (!excluded.has(id) || movement.primary[id])));
}

// Coarse bookkeeping assumptions, capped at one set per group, never force shares.
export function groupCoefficients(movement) {
  const coefficients = muscleCoefficients(movement);
  return Object.fromEntries(Object.entries(VOLUME_GROUPS).map(([id, group]) => [id,
    Math.min(1, group.muscles.reduce((sum, muscle) => sum + (coefficients[muscle] ?? 0), 0)),
  ]).filter(([, value]) => value > 0));
}

export function directGroups(movement) {
  return Object.keys(VOLUME_GROUPS).filter((id) => VOLUME_GROUPS[id].muscles.some((muscle) => (movement.primary[muscle] ?? 0) > 0));
}
