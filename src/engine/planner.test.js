import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS, DEFAULT_PROFILE, MOVEMENTS } from '../data/exercises.js';
import {
  createPlan, getAvailableMovements, estimateDay, getProgressionAdvice, movementById,
  isVariantAvailable, migrateLegacyPlan, migrateLegacyLogs, migrateLegacyProfile, analyzePlan, getTargets, getPlanWarnings,
} from './planner.js';
import { FOCUSES, SPLITS, isMovementAllowedForFocus, matchesBlock } from './training.js';

const clone = (value) => structuredClone(value);

test('默认配置能生成所有训练日且不超过单次时间', () => {
  const plan = createPlan(clone(DEFAULT_PROFILE), DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS);
  assert.equal(plan.days.length, 4);
  assert.ok(plan.days.every((day) => day.exercises.length >= 3));
  assert.ok(plan.days.every((day) => estimateDay(day) <= DEFAULT_PROFILE.minutes));
  assert.ok(plan.days.flatMap((day) => day.exercises).every((item) => item.sets >= 2));
});

test('只选择当前器械可执行的动作，且版本与器械匹配', () => {
  const equipment = ['dumbbell', 'adjustableBench'];
  const attachments = [];
  const available = getAvailableMovements(equipment, attachments, []);
  const plan = createPlan(clone(DEFAULT_PROFILE), equipment, attachments);
  const ids = new Set(available.map((movement) => movement.id));
  const entries = plan.days.flatMap((day) => day.exercises);
  assert.ok(entries.every((item) => ids.has(item.movementId)));
  assert.ok(!ids.has('lat-pulldown'));
  assert.ok(entries.every((item) => {
    const movement = movementById(item.movementId);
    const variant = movement.variants.find((v) => v.id === item.variantId);
    return variant && isVariantAvailable(variant, equipment, attachments);
  }));
});

test('重点补强提高目标组数，排除动作不会进入计划', () => {
  const normal = createPlan(clone(DEFAULT_PROFILE), DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS);
  const profile = clone(DEFAULT_PROFILE);
  profile.preferences.sideDelt = 'priority';
  profile.excluded = ['flat-bench-press'];
  const adjusted = createPlan(profile, DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS);
  assert.ok(adjusted.targets.sideDelt > normal.targets.sideDelt);
  assert.ok(!adjusted.days.flatMap((day) => day.exercises).some((item) => item.movementId === 'flat-bench-press'));
});

test('锁定动作在重新生成后保留', () => {
  const first = createPlan(clone(DEFAULT_PROFILE), DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS);
  const locked = first.days[0].exercises[0];
  locked.locked = true;
  locked.sets = 4;
  const second = createPlan(clone(DEFAULT_PROFILE), DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS, first);
  assert.ok(second.days[0].exercises.some((item) => item.movementId === locked.movementId && item.sets === 4 && item.locked));
});

test('相同输入生成相同训练内容', () => {
  const a = createPlan(clone(DEFAULT_PROFILE), DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS);
  const b = createPlan(clone(DEFAULT_PROFILE), DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS);
  assert.deepEqual(a.days, b.days);
  assert.deepEqual(a.targets, b.targets);
});

test('双进阶规则只在全组达标且保留余力时建议加重', () => {
  const movement = movementById('lateral-raise');
  const up = getProgressionAdvice(movement, [{ reps: 20, rir: 2 }, { reps: 20, rir: 1 }]);
  const hold = getProgressionAdvice(movement, [{ reps: 18, rir: 2 }, { reps: 17, rir: 1 }]);
  const down = getProgressionAdvice(movement, [{ reps: 8, rir: 0 }, { reps: 9, rir: 1 }]);
  assert.equal(up.type, 'up');
  assert.equal(hold.type, 'hold');
  assert.equal(down.type, 'down');
});

test('动作库的主次肌群参数完整', () => {
  assert.ok(MOVEMENTS.length >= 34);
  for (const movement of MOVEMENTS) {
    assert.ok(Object.keys(movement.primary).length > 0, movement.id);
    assert.ok(movement.repRange[0] < movement.repRange[1], movement.id);
    assert.ok(movement.rest >= 60, movement.id);
    assert.ok(movement.variants.length >= 1, movement.id);
  }
});

test('v1 数据迁移：exerciseId 转为动作+版本', () => {
  const legacyPlan = {
    id: 'plan-old',
    profile: clone(DEFAULT_PROFILE),
    days: [{ id: 'day-1', weekday: 1, focus: 'upper', title: '上肢训练', exercises: [
      { id: 'day-1-db-bench', exerciseId: 'db-bench', sets: 3, weight: 20, locked: true },
      { id: 'day-1-hack-squat', exerciseId: 'hack-squat', sets: 3, weight: 0, locked: false },
    ] }],
  };
  const migrated = migrateLegacyPlan(legacyPlan);
  const entries = migrated.days[0].exercises;
  assert.equal(entries[0].movementId, 'flat-bench-press');
  assert.equal(entries[0].variantId, 'db-bench');
  assert.equal(entries[0].locked, true);
  assert.equal(entries[1].movementId, 'squat');
  assert.equal(entries[1].variantId, 'hack-squat');
  assert.ok(migrated.analysis.coverage.midChest.sets > 0);

  const logs = migrateLegacyLogs([{ id: 'log-1', exercises: [{ exerciseId: 'db-lateral', sets: [{ weight: 5, reps: 15, rir: 2 }] }] }]);
  assert.equal(logs[0].exercises[0].movementId, 'lateral-raise');

  const profile = migrateLegacyProfile({ ...clone(DEFAULT_PROFILE), excluded: ['db-bench', 'hack-squat', 'db-bench'] });
  assert.deepEqual(profile.excluded.sort(), ['flat-bench-press', 'squat']);
});

test('默认四分化有明确部位，每个基础动作块都获得工作组', () => {
  const plan = createPlan(clone(DEFAULT_PROFILE), DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS);
  assert.deepEqual(plan.days.map((day) => day.focus), ['chestTriceps', 'backBiceps', 'legs', 'shoulders']);
  for (const day of plan.days) {
    assert.ok(day.exercises.every((item) => isMovementAllowedForFocus(movementById(item.movementId), day.focus)), day.title);
    for (const block of FOCUSES[day.focus].blocks) {
      assert.ok(day.exercises.some((item) => item.sets >= 2 && matchesBlock(movementById(item.movementId), block)), `${day.title}: ${block.name}`);
    }
    const compounds = day.exercises.map((item) => movementById(item.movementId).compound);
    assert.ok(!compounds.some((value, index) => value && compounds.slice(0, index).includes(false)));
  }
});

test('动作是否属于分化只看主导目标，辅助参与不能放宽部位约束', () => {
  assert.equal(isMovementAllowedForFocus(movementById('pushup'), 'legs'), false);
  assert.equal(isMovementAllowedForFocus(movementById('rdl'), 'pull'), false);
  assert.equal(isMovementAllowedForFocus(movementById('plank'), 'upper'), false);
  assert.equal(isMovementAllowedForFocus(movementById('overhead-press'), 'chestTriceps'), false);
  assert.equal(isMovementAllowedForFocus(movementById('reverse-fly'), 'shoulders'), true);
});

test('216 种频次、分化、时长和器械组合满足部位、时间、版本与组数约束', () => {
  const schedules = [[6], [2, 6], [1, 3, 6], [1, 2, 4, 6], [1, 2, 3, 5, 6], [1, 2, 3, 4, 5, 6]];
  const gyms = [[DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS], [['dumbbell', 'adjustableBench'], []], [[], []]];
  for (const weekdays of schedules) for (const split of SPLITS) for (const minutes of [30, 45, 60, 120]) for (const [equipment, attachments] of gyms) {
    const profile = { ...clone(DEFAULT_PROFILE), weekdays, daysPerWeek: weekdays.length, split: split.id, minutes };
    const plan = createPlan(profile, equipment, attachments);
    const label = `${weekdays.length} / ${split.id} / ${minutes} / ${equipment.length}`;
    assert.equal(plan.days.length, weekdays.length, label);
    for (const day of plan.days) {
      assert.ok(estimateDay(day) <= minutes, label);
      assert.equal(new Set(day.exercises.map((item) => item.movementId)).size, day.exercises.length, label);
      assert.ok(day.exercises.every((item) => item.sets >= 2 && item.sets <= 4 && Number.isInteger(item.sets)), label);
      assert.ok(day.exercises.every((item) => {
        const movement = movementById(item.movementId);
        return isMovementAllowedForFocus(movement, day.focus)
          && isVariantAvailable(movement.variants.find((variant) => variant.id === item.variantId), equipment, attachments);
      }), label);
    }
  }
});

test('低频默认保留全身和上下肢选择，三练部位分化使用推拉腿', () => {
  const one = createPlan({ ...clone(DEFAULT_PROFILE), weekdays: [1], daysPerWeek: 1 }, DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS);
  const three = createPlan({ ...clone(DEFAULT_PROFILE), weekdays: [1, 3, 6], daysPerWeek: 3 }, DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS);
  const full = createPlan({ ...clone(DEFAULT_PROFILE), weekdays: [1, 3], daysPerWeek: 2, split: 'full' }, DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS);
  assert.equal(one.days[0].focus, 'full');
  assert.deepEqual(three.days.map((day) => day.focus), ['push', 'pull', 'legs']);
  assert.ok(full.days.every((day) => day.focus === 'full'));
});

test('不再用增长或恢复系数放大预算；胸背各区域合并核算且每组最多计一组', () => {
  const targets = getTargets(clone(DEFAULT_PROFILE));
  assert.ok(Object.values(targets).every((target) => target === 8));
  const analysis = analyzePlan([{ exercises: [{ movementId: 'incline-bench-press', sets: 3 }, { movementId: 'seated-row', sets: 3 }] }], targets);
  assert.equal(analysis.groupCoverage.chest.sets, 3);
  assert.equal(analysis.groupCoverage.back.sets, 3);
  assert.equal(analysis.groupCoverage.chest.target, 8);
  assert.equal(analysis.groupCoverage.chest.directSets, 3);
  assert.equal(analysis.groupCoverage.triceps.directSets, 0);
  assert.ok(analysis.groupCoverage.triceps.sets > 0);
});

test('改变分化时移除不兼容锁定动作并说明原因，不修改原计划', () => {
  const profile = { ...clone(DEFAULT_PROFILE), split: 'full' };
  const previous = createPlan(profile, DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS);
  previous.days[0].exercises = [{ id: 'locked-squat', movementId: 'squat', variantId: 'hack-squat', sets: 3, weight: 20, locked: true }];
  const snapshot = clone(previous);
  const next = createPlan(clone(DEFAULT_PROFILE), DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS, previous);
  assert.ok(!next.days[0].exercises.some((item) => item.movementId === 'squat'));
  assert.ok(next.warnings.some((warning) => warning.includes('深蹲未保留')));
  assert.deepEqual(previous, snapshot);
});

test('锁定组数保持原值；超时保留用户选择并明确提示，不继续填充', () => {
  const previous = createPlan(clone(DEFAULT_PROFILE), DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS);
  previous.days[0].exercises = [{ id: 'locked-bench', movementId: 'flat-bench-press', variantId: 'db-bench', sets: 8, weight: 20, locked: true }];
  const next = createPlan({ ...clone(DEFAULT_PROFILE), minutes: 30 }, DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS, previous);
  assert.equal(next.days[0].exercises[0].sets, 8);
  assert.equal(next.days[0].exercises.length, 1);
  assert.ok(next.warnings.some((warning) => warning.includes('超过 30 分钟预算')));
});

test('换器械后锁定动作切换到可用版本；排除后不保留', () => {
  const previous = createPlan(clone(DEFAULT_PROFILE), DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS);
  previous.days[0].exercises = [{ id: 'locked-bench', movementId: 'flat-bench-press', variantId: 'db-bench', sets: 3, locked: true }];
  const next = createPlan(clone(DEFAULT_PROFILE), ['chestPress'], [], previous);
  assert.equal(next.days[0].exercises.find((item) => item.locked).variantId, 'machine-chest');
  const excluded = createPlan({ ...clone(DEFAULT_PROFILE), excluded: ['flat-bench-press'] }, DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS, previous);
  assert.ok(excluded.days.every((day) => !day.exercises.some((item) => item.movementId === 'flat-bench-press')));
});

test('无法满足基础安排时提示缺器械，不跨部位填满；实际星期决定生成天数', () => {
  const plan = createPlan({ ...clone(DEFAULT_PROFILE), weekdays: [1, 3, 6], daysPerWeek: 6 }, [], []);
  assert.equal(plan.days.length, 3);
  assert.equal(plan.profile.daysPerWeek, 3);
  assert.ok(plan.warnings.some((warning) => warning.includes('缺少可用动作')));
  assert.equal(plan.days.find((day) => day.focus === 'pull').exercises.length, 0);
});

test('恢复提示包含周日到周一的循环；重新排序尽量避开相邻日上下肢重复', () => {
  const days = [0, 1].map((weekday) => ({ weekday, focus: 'full', title: '全身训练', exercises: [{ movementId: 'flat-bench-press', sets: 3 }] }));
  const warnings = getPlanWarnings(days, getTargets(DEFAULT_PROFILE), DEFAULT_PROFILE, DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS);
  assert.ok(warnings.some((warning) => warning.includes('间隔约 24 小时') && warning.includes('中胸')));
  const reordered = createPlan({ ...clone(DEFAULT_PROFILE), weekdays: [1, 2, 4, 5], split: 'upperLower' }, DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS);
  assert.deepEqual(reordered.days.map((day) => day.focus), ['upper', 'lower', 'upper', 'lower']);
});

test('进阶不使用缺失、非数字或不同工作重量的组记录建议加重', () => {
  const movement = movementById('lateral-raise');
  for (const sets of [[{ reps: 20, rir: '' }], [{ reps: Infinity, rir: 2 }], [{ reps: 20, rir: 2, weight: 5 }, { reps: 20, rir: 2, weight: 3 }]]) {
    assert.equal(getProgressionAdvice(movement, sets).type, 'hold');
  }
});

test('肌群占比归一化为100%且保留主辅关系', async () => {
  const { muscleShares } = await import('./planner.js');
  const shares = muscleShares(movementById('incline-bench-press'));
  assert.equal(shares.reduce((sum, item) => sum + item.percent, 0), 100);
  const upperChest = shares.find((item) => item.id === 'upperChest');
  const frontDelt = shares.find((item) => item.id === 'frontDelt');
  assert.ok(upperChest.percent > frontDelt.percent);
  assert.ok(shares.every((item) => item.percent > 0));
});

test('自定义器械与动作参与可用性筛选和查找', async () => {
  const { setCustomData, allMovements, allEquipment } = await import('./planner.js');
  try {
    setCustomData({
      equipment: [{ id: 'custom-eq-1', name: '下斜推胸机', category: '固定器械', description: '' }],
      movements: [{
        id: 'custom-mv-1', name: '下斜卧推', pattern: 'press',
        primary: { lowerChest: 1 }, secondary: { triceps: .3 },
        variants: [{ id: 'custom-v-1', name: '器械下斜卧推', requires: [['custom-eq-1']], cue: null }],
        compound: true, repRange: [8, 12], rest: 150, rir: 2, increment: 2.5, difficulty: 2, cue: '', custom: true,
      }],
    });
    assert.ok(allEquipment().some((item) => item.id === 'custom-eq-1'));
    assert.equal(movementById('custom-mv-1').name, '下斜卧推');
    const owned = [...DEFAULT_EQUIPMENT, 'custom-eq-1'];
    const withMachine = getAvailableMovements(owned, DEFAULT_ATTACHMENTS, []);
    assert.ok(withMachine.some((movement) => movement.id === 'custom-mv-1'));
    const withoutMachine = getAvailableMovements(DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS, []);
    assert.ok(!withoutMachine.some((movement) => movement.id === 'custom-mv-1'));
    assert.ok(allMovements().length > 36);
  } finally {
    setCustomData({ equipment: [], movements: [] });
  }
});

test('计划条目的次数范围覆盖动作默认值并用于初始记录', async () => {
  const { createInitialLogs } = await import('./planner.js');
  const plan = { days: [{ id: 'day-custom', exercises: [{ movementId: 'lateral-raise', variantId: 'db-lateral', sets: 2, repRange: [9, 14] }] }] };
  const entry = createInitialLogs(plan)[0].exercises[0];
  assert.deepEqual(entry.repRange, [9, 14]);
  assert.equal(entry.sets[0].reps, 9);
});

test('进阶建议使用计划条目的自定义次数范围', () => {
  const movement = movementById('lateral-raise');
  const sets = [{ reps: 14, rir: 2 }, { reps: 14, rir: 2 }];
  assert.equal(getProgressionAdvice(movement, sets, [9, 14]).type, 'up');
});

test('胸部飞鸟按拉力线严格区分下胸、中胸和上胸', () => {
  assert.equal(movementById('high-to-low-fly').primary.lowerChest, 1);
  assert.equal(movementById('chest-fly').primary.midChest, 1);
  assert.equal(movementById('pec-deck-fly').primary.midChest, 1);
  assert.equal(movementById('low-cable-fly').primary.upperChest, 1);
  const crossoverOwner = MOVEMENTS.find((movement) => movement.variants.some((variant) => variant.id === 'crossover-fly'));
  assert.equal(crossoverOwner.id, 'high-to-low-fly');
  assert.ok(!movementById('chest-fly').variants.some((variant) => variant.id === 'crossover-fly'));
});

test('旧十字机下夹数据随版本归属迁移到下胸动作', () => {
  const entry = { id: 'old-crossover', movementId: 'chest-fly', variantId: 'crossover-fly', sets: 3 };
  const plan = migrateLegacyPlan({ days: [{ id: 'day-old', exercises: [entry] }] });
  assert.equal(plan.days[0].exercises[0].movementId, 'high-to-low-fly');
  const logs = migrateLegacyLogs([{ id: 'log-old', exercises: [{ movementId: 'chest-fly', variantId: 'crossover-fly', sets: [] }] }]);
  assert.equal(logs[0].exercises[0].movementId, 'high-to-low-fly');
});

test('反向飞鸟包含蝴蝶机、哑铃、绳索和十字机版本且均由肩后束主导', () => {
  const reverseFly = movementById('reverse-fly');
  assert.deepEqual(reverseFly.primary, { rearDelt: 1, upperBack: .45 });
  const variantIds = reverseFly.variants.map((variant) => variant.id);
  for (const id of ['reverse-pec', 'db-reverse-fly', 'cable-reverse-fly', 'crossover-reverse-fly']) assert.ok(variantIds.includes(id), id);
  for (const variant of reverseFly.variants) assert.ok(isVariantAvailable(variant, DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS), variant.id);
});
