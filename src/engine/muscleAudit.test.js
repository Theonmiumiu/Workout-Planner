import test from 'node:test';
import assert from 'node:assert/strict';
import { MUSCLES, MOVEMENTS, DEFAULT_PROFILE, DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS, MUSCLE_MODEL_VERSION } from '../data/exercises.js';
import { MUSCLE_AUDIT, MUSCLE_SOURCES } from '../data/muscleAudit.js';
import { analyzePlan, createPlan, getTargets, movementById, muscleContributions, isVariantAvailable } from './planner.js';
import { directGroups, groupCoefficients, isMovementAllowedForFocus } from './training.js';
import { reviewVolume } from './volumeReview.js';

test('每个内置动作都有肌群校核说明，角色不重叠且采用粗粒度记账系数', () => {
  assert.equal(MOVEMENTS.length, 40);
  assert.equal(Object.keys(MUSCLE_AUDIT).length, MOVEMENTS.length);
  for (const movement of MOVEMENTS) {
    assert.ok(movement.anatomyReviewed && movement.anatomyNote.length > 10, movement.id);
    assert.ok(movement.sourceIds.length && movement.sourceIds.every((id) => MUSCLE_SOURCES[id]?.url.startsWith('https://pubmed.ncbi.nlm.nih.gov/')), movement.id);
    const ids = [...Object.keys(movement.primary), ...Object.keys(movement.secondary), ...movement.stabilizers];
    assert.equal(new Set(ids).size, ids.length, movement.id);
    assert.ok(ids.every((id) => MUSCLES[id]), movement.id);
    assert.ok([...Object.values(movement.primary), ...Object.values(movement.secondary)].every((value) => [1, .75, .5, .25].includes(value)), movement.id);
    assert.ok(Object.values(groupCoefficients(movement)).every((value) => value > 0 && value <= 1), movement.id);
  }
});

test('稳定／少量参与保留在说明中，但不充当前臂、腹部和腿后侧的增肌组数', () => {
  for (const [id, muscles] of [
    ['pushup', ['core']], ['pullup', ['core', 'forearms']], ['seated-row', ['core', 'forearms']],
    ['rdl', ['core', 'forearms']], ['squat', ['hamstrings', 'calves', 'core']],
    ['leg-press', ['hamstrings', 'calves']], ['hip-thrust', ['hamstrings', 'core']], ['pushdown', ['forearms']],
  ]) {
    const movement = movementById(id);
    const coefficients = groupCoefficients(movement);
    for (const muscle of muscles) {
      assert.equal(coefficients[muscle] ?? 0, 0, `${id}/${muscle}`);
      assert.equal(muscleContributions(movement).find((item) => item.id === muscle)?.role, 'stabilizer', `${id}/${muscle}`);
    }
  }
  const result = analyzePlan([{ exercises: [{ movementId: 'squat', sets: 4 }, { movementId: 'rdl', sets: 4 }, { movementId: 'pushup', sets: 4 }] }], getTargets(DEFAULT_PROFILE));
  assert.equal(result.groupCoverage.core.sets, 0);
  assert.equal(result.groupCoverage.forearms.sets, 0);
  assert.equal(result.groupCoverage.hamstrings.sets, 4);
});

test('复合动作的多个主要目标均计直接组数，而分化筛选仍依据主导任务', () => {
  assert.deepEqual(directGroups(movementById('squat')).sort(), ['glutes', 'quads']);
  assert.deepEqual(directGroups(movementById('rdl')).sort(), ['glutes', 'hamstrings']);
  assert.ok(directGroups(movementById('dips')).includes('triceps'));
  assert.ok(directGroups(movementById('hammer-curl')).includes('forearms'));
  assert.equal(isMovementAllowedForFocus(movementById('rdl'), 'pull'), false);
  assert.equal(isMovementAllowedForFocus(movementById('reverse-fly'), 'shoulders'), true);
  const result = analyzePlan([{ exercises: [{ movementId: 'squat', sets: 3 }, { movementId: 'rdl', sets: 3 }] }], getTargets(DEFAULT_PROFILE));
  assert.equal(result.groupCoverage.glutes.directSets, 6);
  assert.equal(result.groupCoverage.glutes.frequency, 1);
});

test('肩部、手臂与核心区分任务，不把反向飞鸟当胸、不把支撑当推肩', () => {
  assert.deepEqual(directGroups(movementById('reverse-fly')), ['rearDelt']);
  assert.equal(movementById('reverse-fly').secondary.upperBack, .5);
  assert.equal(groupCoefficients(movementById('plank')).frontDelt ?? 0, 0);
  assert.equal(groupCoefficients(movementById('plank')).core, 1);
  assert.equal(groupCoefficients(movementById('overhead-triceps')).core ?? 0, 0);
  assert.ok(movementById('face-pull').anatomyNote.includes('冈下肌'));
  assert.ok(movementById('hip-abduction').anatomyNote.includes('不能替代臀推'));
  assert.ok(movementById('back-extension').anatomyNote.includes('不按腹部直接训练'));
});

test('伸膝与屈膝提踵使用不同器械版本，原有版本 id 保持不变', () => {
  const movement = movementById('calf-raise');
  const standing = movement.variants.find((variant) => variant.id === 'standing-calf');
  const seated = movement.variants.find((variant) => variant.id === 'seated-calf');
  assert.ok(isVariantAvailable(standing, ['calfMachine'], []));
  assert.equal(isVariantAvailable(seated, ['calfMachine'], []), false);
  assert.ok(isVariantAvailable(seated, ['seatedCalfMachine'], []));
  assert.equal(isVariantAvailable(standing, ['seatedCalfMachine'], []), false);
});

test('组数记账规则变化后，不混用旧规则记录来建议加量', () => {
  const plan = createPlan(structuredClone(DEFAULT_PROFILE), DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS);
  const old = ['2026-10-06T12:00:00Z', '2026-10-13T12:00:00Z', '2026-10-20T12:00:00Z'].map((date, index) => ({
    id: `old-${index}`, planId: 'test', date, verified: true, recovery: 'good', muscleModelVersion: MUSCLE_MODEL_VERSION - 1,
    budgetSnapshot: { chest: 8 }, exercises: [{ movementId: 'flat-bench-press', variantId: 'db-bench', sets: Array.from({ length: 8 }, () => ({ weight: 20, reps: 10, rir: 2 })) }],
  }));
  const original = structuredClone(old);
  const chest = reviewVolume(plan, old, 'test', new Date('2026-10-27T12:00:00Z')).find((review) => review.id === 'chest');
  assert.equal(chest.records, 0);
  assert.equal(chest.next, null);
  assert.deepEqual(old, original);
  assert.equal(plan.muscleModelVersion, MUSCLE_MODEL_VERSION);
});
