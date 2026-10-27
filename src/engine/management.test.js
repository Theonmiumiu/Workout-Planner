import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE, DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS, MUSCLE_MODEL_VERSION } from '../data/exercises.js';
import { allMovements, analyzePlan, createInitialLogs, createPlan, getAvailableMovements, getTargets, movementById, setCustomData } from './planner.js';
import { activeEntry, addPlan, createPlanStore, deletePlan, isDraftChanged, migratePlanStore, renameRevision, reorderExercises, replaceDraftWithVersion, restoreRevision, saveRevision, updateDraft } from './planStore.js';
import { groupTargets } from './training.js';
import { reviewVolume, weekKey } from './volumeReview.js';

const clone = (value) => structuredClone(value);
const makePlan = () => createPlan(clone(DEFAULT_PROFILE), DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS);

test('计划草稿独立保存，版本快照不随编辑改变；恢复会先保留草稿', () => {
  let store = createPlanStore(makePlan());
  const original = clone(activeEntry(store).draft);
  const revisionId = activeEntry(store).revisions[0].id;
  store = updateDraft(store, (plan) => ({ ...plan, days: plan.days.map((day, index) => index ? day : { ...day, exercises: [...day.exercises].reverse() }) }));
  assert.equal(isDraftChanged(activeEntry(store)), true);
  assert.deepEqual(activeEntry(store).revisions[0].plan, original);
  const edited = clone(activeEntry(store).draft);
  store = restoreRevision(store, revisionId);
  assert.deepEqual(activeEntry(store).draft, original);
  assert.deepEqual(activeEntry(store).revisions[1].plan, edited);
  assert.equal(activeEntry(store).revisions.at(-1).name, '恢复自 v1');
  assert.equal(isDraftChanged(activeEntry(store)), false);
});

test('多个计划可复制、切换、删除和恢复，不允许删除最后一个；原始对象不变', () => {
  const first = createPlanStore(makePlan());
  const snapshot = clone(first);
  let store = addPlan(first, activeEntry(first).draft, '出差计划');
  const secondId = store.activePlanId;
  store = updateDraft(store, (plan) => ({ ...plan, targets: { ...plan.targets, sideDelt: 12 } }));
  assert.equal(first.plans[0].draft.targets.sideDelt, 8);
  store = deletePlan(store, secondId);
  assert.equal(store.activePlanId, first.activePlanId);
  assert.ok(store.plans.find((entry) => entry.id === secondId).deletedAt);
  assert.deepEqual(deletePlan(store, first.activePlanId), store);
  assert.deepEqual(first, snapshot);
});

test('版本名称可自定义并修改，修改只影响名称，编号、快照和备份可追溯性不变', () => {
  let store = saveRevision(createPlanStore(makePlan()), '  腿部休息调整  ');
  assert.equal(activeEntry(store).revisions.at(-1).name, '腿部休息调整');
  const original = clone(store);
  const revision = activeEntry(store).revisions.at(-1);
  store = renameRevision(store, revision.id, '  七十五分钟版本  ');
  const renamed = activeEntry(store).revisions.at(-1);
  assert.deepEqual({ ...renamed, name: revision.name }, revision);
  assert.equal(renamed.name, '七十五分钟版本');
  assert.equal(activeEntry(store).revisions.length, 2);
  assert.equal(isDraftChanged(activeEntry(store)), false);
  assert.equal(activeEntry(original).revisions.at(-1).name, '腿部休息调整');
  assert.equal(renameRevision(store, revision.id, '  '), store);
  const restored = migratePlanStore(JSON.parse(JSON.stringify(store)), makePlan());
  assert.deepEqual(restored, store);
  assert.equal(activeEntry(saveRevision(store, '   ')).revisions.at(-1).name, '手动保存');
});

test('生成结果另存版本，完整导出结构可往返迁移，保留草稿及多计划', () => {
  let store = createPlanStore(makePlan());
  store = updateDraft(store, (plan) => ({ ...plan, profile: { ...plan.profile, minutes: 90 } }));
  store = replaceDraftWithVersion(store, makePlan(), '重新生成');
  assert.equal(activeEntry(store).revisions.length, 3);
  store = addPlan(store, makePlan(), '第二计划');
  store = saveRevision(store, '训练前');
  const imported = migratePlanStore(JSON.parse(JSON.stringify(store)), makePlan());
  assert.deepEqual(imported, store);
});

test('拖拽重排按动作 id 移动，锁定、次数等参数不变，取消或无效目标不改原数组', () => {
  const entries = [{ id: 'a', sets: 3, locked: true, repRange: [8, 12] }, { id: 'b', sets: 2 }, { id: 'c', sets: 4 }];
  const moved = reorderExercises(entries, 'a', 'c');
  assert.deepEqual(moved.map((entry) => entry.id), ['b', 'c', 'a']);
  assert.deepEqual(moved.at(-1), entries[0]);
  assert.deepEqual(entries.map((entry) => entry.id), ['a', 'b', 'c']);
  assert.equal(reorderExercises(entries, 'a', 'missing'), entries);
  assert.equal(reorderExercises(entries, 'a', 'a'), entries);
});

test('删除自定义动作后不可再选入，但旧版本与记录依然可读取，恢复后重新可用', () => {
  const custom = { ...clone(movementById('flat-bench-press')), id: 'custom-test', name: '测试动作', custom: true };
  try {
    setCustomData({ equipment: [], movements: [custom] });
    const plan = makePlan();
    plan.days[0].exercises = [{ id: 'test', movementId: custom.id, variantId: 'db-bench', sets: 3 }];
    const before = analyzePlan(plan.days, plan.targets);
    setCustomData({ equipment: [], movements: [{ ...custom, deletedAt: new Date().toISOString() }] });
    assert.equal(allMovements().some((movement) => movement.id === custom.id), false);
    assert.equal(getAvailableMovements(DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS).some((movement) => movement.id === custom.id), false);
    assert.equal(movementById(custom.id).name, custom.name);
    assert.deepEqual(analyzePlan(plan.days, plan.targets), before);
    const record = createInitialLogs(plan)[0].exercises[0];
    assert.equal(record.movementSnapshot.name, custom.name);
    setCustomData({ equipment: [], movements: [custom] });
    assert.equal(allMovements().some((movement) => movement.id === custom.id), true);
  } finally { setCustomData({ equipment: [], movements: [] }); }
});

test('100% 表示组数预算而非上限；自定义预算影响生成目标并被版本快照保留', () => {
  const targets = getTargets({ ...DEFAULT_PROFILE, volumeOverrides: { chest: 12 } });
  assert.equal(groupTargets(targets).chest, 12);
  assert.equal(targets.upperChest, 12);
  const analysis = analyzePlan([{ exercises: [{ movementId: 'flat-bench-press', sets: 12 }] }], getTargets(DEFAULT_PROFILE));
  assert.equal(analysis.groupCoverage.chest.percent, 150);
});

const now = new Date('2026-10-26T12:00:00Z');
const reviewPlan = () => ({ ...makePlan(), days: [{ id: 'day-1', exercises: [{ id: 'a', movementId: 'flat-bench-press', variantId: 'db-bench', sets: 8 }] }] });
const records = (reps = [10, 10, 10], recovery = ['good', 'good', 'good']) => ['2026-10-06T12:00:00Z', '2026-10-13T12:00:00Z', '2026-10-20T12:00:00Z'].map((date, index) => ({
  id: `record-${index}`, date, planId: 'program-test', muscleModelVersion: MUSCLE_MODEL_VERSION, budgetSnapshot: groupTargets(getTargets(DEFAULT_PROFILE)), verified: true, recovery: recovery[index],
  exercises: [{ movementId: 'flat-bench-press', variantId: 'db-bench', sets: Array.from({ length: 8 }, () => ({ weight: 20, reps: reps[index], rir: 2 })) }],
}));
const chestReview = (plan, logs) => reviewVolume(plan, logs, 'program-test', now).find((review) => review.id === 'chest');

test('记录不足、不属此计划、未核对、当前周、旧预算、无恢复反馈均不建议加量', () => {
  const base = records();
  for (const logs of [[], base.slice(0, 2), base.map((log) => ({ ...log, planId: 'other' })), base.map((log) => ({ ...log, verified: false })), base.map((log) => ({ ...log, date: now.toISOString() })), base.map((log) => ({ ...log, budgetSnapshot: { chest: 10 } })), base.map((log) => ({ ...log, recovery: 'unknown' }))]) {
    assert.equal(chestReview(reviewPlan(), logs).next, null);
  }
});

test('有三周真实完成量、恢复良好且同条件停滞时仅建议加一组，不直接修改计划', () => {
  const plan = reviewPlan();
  const before = clone(plan);
  const result = chestReview(plan, records());
  assert.equal(result.type, 'increase');
  assert.equal(result.next, 9);
  assert.deepEqual(plan, before);
  assert.equal(chestReview(plan, [...records(), ...records()]).records, 3);
});

test('表现仍进步时维持；多周疲劳并下降时建议减一组，不适时暂停建议', () => {
  assert.equal(chestReview(reviewPlan(), records([10, 11, 12])).next, null);
  assert.equal(chestReview(reviewPlan(), records([12, 11, 10], ['tired', 'tired', 'tired'])).next, 7);
  assert.equal(chestReview(reviewPlan(), records([10, 10, 10], ['good', 'pain', 'good'])).next, null);
});

test('RIR 平均值不能掩盖力竭组或过轻的组，不因此建议加量', () => {
  for (const rir of [0, 5]) {
    const logs = records();
    logs.forEach((log) => { log.exercises[0].sets[0].rir = rir; });
    assert.equal(chestReview(reviewPlan(), logs).next, null);
  }
});

test('不同器械、工作重量、组数和目标区间不混作停滞；已应用证据不可重复使用', () => {
  for (const field of ['variantId', 'weight', 'sets', 'repRange']) {
    const logs = records();
    if (field === 'variantId') logs[2].exercises[0].variantId = 'machine-chest';
    if (field === 'weight') logs[2].exercises[0].sets.forEach((set) => { set.weight = 22.5; });
    if (field === 'sets') logs[2].exercises[0].sets.pop();
    if (field === 'repRange') logs[2].exercises[0].repRange = [12, 20];
    assert.equal(chestReview(reviewPlan(), logs).next, null, field);
  }
  const plan = reviewPlan();
  plan.profile.volumeReviews = { chest: { through: records().at(-1).date, value: 9 } };
  assert.equal(chestReview(plan, records()).next, null);
  assert.equal(weekKey('2026-10-25T12:00:00Z'), '2026-10-19');
});
