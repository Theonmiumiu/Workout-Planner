import { MUSCLES, MUSCLE_GROUPS } from '../data/exercises.js';

export const ALGORITHM_VERSION = 3;

// These are scheduling templates, not evidence that one split produces more growth.
export const SPLITS = [
  { id: 'focused', name: '部位分化', description: '3 练推拉腿；4–5 练按部位集中；6 练推拉腿两轮。' },
  { id: 'upperLower', name: '上下肢分化', description: '上肢与下肢交替，适合希望提高各部位周频次的安排。' },
  { id: 'full', name: '全身训练', description: '每次覆盖主要部位，适合训练日较少或偏好全身训练。' },
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
  push: { title: '胸肩＋三头训练', muscles: [...chest, 'frontDelt', 'sideDelt', 'triceps'], blocks: [chestBlocks[0], shoulderBlocks[1], block('肱三头肌', ['triceps'])] },
  pull: { title: '背部＋二头训练', muscles: [...back, 'rearDelt', 'biceps', 'forearms'], blocks: [...backBlocks, block('肱二头肌', ['curl']), shoulderBlocks[2]] },
  legs: { title: '腿部＋核心训练', muscles: legs, blocks: legBlocks },
  chestTriceps: { title: '胸部＋三头训练', muscles: [...chest, 'triceps'], blocks: [...chestBlocks, block('肱三头肌', ['triceps'])] },
  backBiceps: { title: '背部＋二头训练', muscles: [...back, 'biceps', 'forearms'], blocks: [...backBlocks, block('肱二头肌', ['curl'])] },
  shoulders: { title: '肩部训练', muscles: shoulders, blocks: shoulderBlocks },
  chest: { title: '胸部训练', muscles: chest, blocks: chestBlocks },
  back: { title: '背部训练', muscles: [...back, 'rearDelt'], blocks: [...backBlocks, shoulderBlocks[2]] },
  arms: { title: '手臂＋核心训练', muscles: ['biceps', 'triceps', 'forearms', 'core'], blocks: [block('肱二头肌', ['curl']), block('肱三头肌', ['triceps']), block('前臂', ['forearm']), block('核心', ['core'])] },
};

// Regional chest/back labels guide exercise selection, not independent full-volume quotas.
export const VOLUME_GROUPS = {
  chest: { name: '胸部（合计）', muscles: chest },
  back: { name: '背部（合计）', muscles: back },
  ...Object.fromEntries(Object.entries(MUSCLES).filter(([id]) => ![...chest, ...back].includes(id)).map(([id, muscle]) => [id, { name: muscle.name, muscles: [id] }])),
};

export function dominantMuscles(movement) {
  const highest = Math.max(...Object.values(movement.primary));
  return Object.keys(movement.primary).filter((id) => movement.primary[id] === highest);
}

export function isMovementAllowedForFocus(movement, focus) {
  const allowed = FOCUSES[focus]?.muscles;
  return Boolean(movement && allowed && dominantMuscles(movement).every((id) => allowed.includes(id)));
}

export function matchesBlock(movement, block) {
  return Boolean(movement && block.patterns.includes(movement.pattern)
    && (!block.muscles || dominantMuscles(movement).some((id) => block.muscles.includes(id))));
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

// Retain the library's heuristic coefficients, capped at one set per group per set.
// They are bookkeeping approximations, not measured stimulus or growth predictions.
export function groupCoefficients(movement) {
  return Object.fromEntries(Object.entries(VOLUME_GROUPS).map(([id, group]) => [id,
    Math.min(1, group.muscles.reduce((sum, muscle) => sum + (movement.primary[muscle] ?? movement.secondary[muscle] ?? 0), 0)),
  ]).filter(([, value]) => value > 0));
}

export function directGroups(movement) {
  return Object.keys(VOLUME_GROUPS).filter((id) => VOLUME_GROUPS[id].muscles.some((muscle) => dominantMuscles(movement).includes(muscle)));
}
