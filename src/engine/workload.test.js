import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVEMENTS, MUSCLE_REGIONS, MUSCLE_MODEL_VERSION, resolveMovement, DEFAULT_PROFILE, DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS } from '../data/exercises.js';
import { movementById, analyzePlan, analyzeRecords, createPlan, getTargets, pickVariant, getProgressionAdvice } from './planner.js';
import { summarizeEntry, estimatedMax, workingLoad, buildLoadHistory, loadPrescription, plannedEntryMetrics } from './workload.js';
import { reviewVolume } from './volumeReview.js';

const before = '2026-10-27T12:00:00Z';
const bench = resolveMovement(movementById('flat-bench-press'), 'db-bench');
const entry = (sets, extras = {}) => ({ movementId: bench.id, variantId: 'db-bench', repRange: [8, 12], sets, ...extras });
const set = (weight = 20, reps = 10, rir = 2, kind = 'work') => ({ weight, reps, rir, kind });
const logs = (sets = [set(), set(), set()]) => ['2026-10-06T12:00:00Z', '2026-10-13T12:00:00Z', '2026-10-20T12:00:00Z'].map((date, index) => ({ id: `dose-${index}`, date, planId: 'p', muscleModelVersion: MUSCLE_MODEL_VERSION, verified: true, recovery: 'good', budgetSnapshot: { chest: 8 }, exercises: [entry(Array.from({ length: 8 }, () => ({ ...sets[index] })))] }));

test('全部器械版本有独立参数与区域映射，旧动作和版本 id 保留', () => {
  assert.equal(Object.keys(MUSCLE_REGIONS).length, 43);
  assert.equal(MOVEMENTS.reduce((sum, movement) => sum + movement.variants.length, 0), 81);
  for (const movement of MOVEMENTS) for (const variant of movement.variants) {
    const resolved = resolveMovement(movement, variant.id);
    assert.ok(resolved.setup && resolved.loadLabel && resolved.resistance, variant.id);
    assert.ok(resolved.repRange[0] > 0 && resolved.repRange[1] >= resolved.repRange[0]);
    assert.ok(Object.keys(resolved.regions).length > 0, variant.id);
    assert.ok(Object.entries(resolved.regions).every(([id, coefficient]) => MUSCLE_REGIONS[id] && coefficient >= 0 && coefficient <= 1), variant.id);
  }
});

test('器械切换改变区域参数与处方：伸膝／屈膝小腿、哑铃／器械卧推不混用', () => {
  const calf = movementById('calf-raise');
  const standing = resolveMovement(calf, 'standing-calf');
  const seated = resolveMovement(calf, 'seated-calf');
  assert.ok(standing.regions.gastrocMedial > seated.regions.gastrocMedial);
  assert.equal(standing.regions.soleus, seated.regions.soleus);
  const targets = getTargets(DEFAULT_PROFILE);
  const analyze = (variantId) => analyzePlan([{ exercises: [{ movementId: calf.id, variantId, sets: 4 }] }], targets);
  assert.equal(analyze('standing-calf').regionCoverage.gastrocMedial.sets, 4);
  assert.equal(analyze('seated-calf').regionCoverage.gastrocMedial.sets, 1);
  assert.notDeepEqual(standing.repRange, seated.repRange);
  assert.notDeepEqual(bench.repRange, resolveMovement(movementById(bench.id), 'machine-chest').repRange);
});

test('区域偏好作用于器械选择与生成，不因臀部合计已够量漏掉臀中肌', () => {
  const preferred = pickVariant(movementById('calf-raise'), ['calfMachine', 'seatedCalfMachine'], [], {}, { gastrocMedial: 'reduced', gastrocLateral: 'reduced' });
  assert.equal(preferred.id, 'seated-calf');
  const plan = createPlan({ ...DEFAULT_PROFILE, regionPreferences: { gluteMedius: 'priority' } }, DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS);
  assert.ok(plan.days.some((day) => day.exercises.some((exercise) => exercise.movementId === 'hip-abduction')));
});

test('热身和空值不计完成；偏轻与力竭保留完成和次数达成，负荷匹配另算', () => {
  const summary = summarizeEntry(entry([set(20, 10, 2, 'warmup'), set(), set(20, 10, 5), set(20, 10, 0), set('', 10, 2)]), bench);
  assert.equal(summary.sets, 3);
  assert.equal(summary.warmupSets, 1);
  assert.equal(summary.targetSets, 3);
  assert.equal(summary.matchedSets, 1);
  assert.equal(summary.lightSets, 1);
  assert.equal(summary.failureSets, 1);
  assert.equal(summary.challengingSets, 2);
  assert.equal(summary.volumeLoad, 1200);
  assert.equal(summary.unknownSets, 1);
});

test('重量、次数与 RIR 改变记录结果，容量不会被当成肌肉贡献百分比', () => {
  const first = summarizeEntry(entry([set(20, 10, 2)]), bench);
  const second = summarizeEntry(entry([set(25, 8, 2)]), bench);
  assert.equal(first.volumeLoad, 400);
  assert.equal(second.volumeLoad, 400);
  assert.ok(second.estimatedMax > first.estimatedMax);
  assert.equal(summarizeEntry(entry([set(20, 4, 2)]), bench).targetSets, 0);
  assert.equal(summarizeEntry(entry([set(20, 10, 5)]), bench).targetSets, 1);
  assert.equal(summarizeEntry(entry([set(20, 10, 5)]), bench).matchedSets, 0);
  assert.equal(summarizeEntry(entry([set(0, 10, 2)]), bench).targetSets, 0);
});

test('高次数和时间记录不外推 1RM，自重缺体重不伪造容量', () => {
  assert.equal(estimatedMax(set(20, 20, 2), bench), null);
  assert.equal(estimatedMax(set(20, 10, 5), bench), null);
  const plank = resolveMovement(movementById('plank'), 'plank');
  const summary = summarizeEntry({ variantId: 'plank', sets: [set(0, 40, 2)] }, plank);
  assert.equal(summary.seconds, 40);
  assert.equal(summary.reps, 0);
  assert.equal(summary.volumeLoad, 0);
  assert.equal(summary.estimatedMax, null);
  assert.equal(summary.targetSets, 1);
  const pullup = resolveMovement(movementById('pullup'), 'assisted-pullup');
  assert.equal(workingLoad(set(20), pullup), null);
  assert.equal(workingLoad(set(20), pullup, 70), 50);
  assert.equal(workingLoad(set(30), pullup, 70), 40);
  assert.equal(workingLoad(set(80), pullup, 70), null);
});

test('计划负重偏离历史能力只降低预计匹配量，建议负重按器械档位反解', () => {
  const history = buildLoadHistory(logs(), movementById, { planId: 'p', before });
  const planned = { movementId: bench.id, variantId: 'db-bench', weight: 40, sets: 3, repRange: [8, 12], rir: 2 };
  const metrics = plannedEntryMetrics(planned, bench, { loadHistory: history });
  assert.equal(metrics.prescription.status, '重量偏高');
  assert.equal(metrics.prescription.suggestedWeight, 20);
  assert.equal(metrics.targetSets, 3);
  assert.equal(metrics.matchedSets, 0);
  const lighter = { ...planned, weight: 10 };
  assert.equal(loadPrescription(bench, lighter, history).status, '重量偏低');
});

test('历史校准限定同计划、同版本、已核对、非未来与近期记录', () => {
  const original = logs();
  const history = buildLoadHistory([...original, { ...original[0], id: 'old', date: '2026-01-01T12:00:00Z' }, { ...original[0], id: 'future', date: '2026-11-01T12:00:00Z' }, { ...original[0], id: 'other', planId: 'other' }, { ...original[0], id: 'unverified', verified: false }], movementById, { planId: 'p', before });
  assert.equal(history[`${bench.id}|db-bench`].length, 3);
  assert.equal(loadPrescription(resolveMovement(movementById(bench.id), 'machine-chest'), { variantId: 'machine-chest', weight: 40 }, history).referenceMax, null);
  assert.ok(original.every((log) => !log.exercises[0].movementSnapshot));
});

test('实际周量按完成工作组累计，超次数与偏轻组不丢失，匹配量独立且原日志不变', () => {
  const records = [{ bodyWeight: 70, exercises: [entry([set(), set(20, 20, 2), set(20, 10, 5), set(10, 10, 2, 'warmup')])] }];
  const original = structuredClone(records);
  const result = analyzeRecords(records, getTargets(DEFAULT_PROFILE));
  assert.equal(result.groups.chest.sets, 3);
  assert.equal(result.groups.chest.targetSets, 3);
  assert.equal(result.groups.chest.matchedSets, 1);
  assert.equal(result.groups.chest.percent, 38);
  assert.equal(result.regions.midChest.sets, 3);
  assert.equal(result.regions.midChest.targetSets, 3);
  assert.equal(result.regions.midChest.matchedSets, 1);
  assert.deepEqual(records, original);
});

test('加重且次数下降仍可识别进步，不会因次数减少误建议减量', () => {
  const plan = { ...createPlan(DEFAULT_PROFILE, DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS), days: [{ id: 'd', exercises: [{ movementId: bench.id, variantId: 'db-bench', sets: 8 }] }] };
  const records = logs([set(20, 10, 2), set(21, 9, 2), set(22, 8, 2)]);
  const review = reviewVolume(plan, records, 'p', new Date(before)).find((item) => item.id === 'chest');
  assert.equal(review.next, null);
  assert.ok(review.reason.includes('进步'));
});

test('辅助器械进阶减少辅助，热身不参与进阶判断', () => {
  const movement = resolveMovement(movementById('pullup'), 'assisted-pullup');
  const advice = getProgressionAdvice(movement, [set(50, 2, 6, 'warmup'), set(20, 10, 2)], movement.repRange, { bodyWeight: 70 });
  assert.equal(advice.type, 'up');
  assert.ok(advice.text.includes('减少辅助'));
  assert.equal(advice.delta, -1);
});

test('截图中的四组 45kg×16、RIR4 计完整完成，并建议按器械档位加重至47.5kg', () => {
  const movement = resolveMovement(movementById('hip-abduction'), 'machine-abduction');
  const sets = Array.from({ length: 4 }, () => set(45, 16, 4));
  const recorded = { movementId: movement.id, variantId: movement.variantId, repRange: [12, 20], sets };
  const summary = summarizeEntry(recorded, movement);
  assert.equal(summary.sets, 4);
  assert.equal(summary.targetSets, 4);
  assert.equal(summary.matchedSets, 0);
  assert.equal(summary.lightSets, 4);
  assert.equal(summary.volumeLoad, 2880);
  assert.equal(summary.estimatedMax, null);
  const advice = getProgressionAdvice(movement, sets, [12, 20], { plannedSets: 4 });
  assert.equal(advice.type, 'up');
  assert.equal(advice.nextWeight, 47.5);
  assert.equal(advice.delta, 2.5);
  assert.ok(advice.text.includes('余力充足'));
  const actual = analyzeRecords([{ exercises: [recorded] }], getTargets(DEFAULT_PROFILE));
  assert.equal(actual.groups.glutes.sets, 4);
  assert.equal(actual.groups.glutes.matchedSets, 0);
  assert.equal(actual.groups.glutes.percent, 50);
});

test('超过次数上限和力竭不抹去完成量；上限以上有余力才建议加重', () => {
  const sets = Array.from({ length: 4 }, () => set(20, 15, 2));
  const original = structuredClone(sets);
  const summary = summarizeEntry(entry(sets), bench);
  assert.equal(summary.sets, 4);
  assert.equal(summary.targetSets, 4);
  assert.equal(summary.matchedSets, 0);
  assert.equal(summary.lightSets, 4);
  assert.equal(getProgressionAdvice(bench, sets, [8, 12]).type, 'up');
  const failure = sets.map((row) => ({ ...row, rir: 0 }));
  assert.equal(summarizeEntry(entry(failure), bench).targetSets, 4);
  assert.equal(summarizeEntry(entry(failure), bench).failureSets, 4);
  assert.equal(getProgressionAdvice(bench, failure, [8, 12]).type, 'hold');
  assert.deepEqual(sets, original);
});

test('最后一组力竭或仅一组次数不足不触发全动作减重，过半组偏重才触发', () => {
  const movement = resolveMovement(movementById('hip-abduction'), 'machine-abduction');
  const normal = () => set(45, 16, 2);
  for (const sets of [
    [normal(), normal(), normal(), set(45, 16, 0)],
    [normal(), normal(), normal(), set(45, 10, 0)],
    [normal(), normal(), set(45, 10, 1), set(45, 10, 0)],
  ]) assert.equal(getProgressionAdvice(movement, sets).type, 'hold');
  const advice = getProgressionAdvice(movement, [normal(), set(45, 10, 1), set(45, 11, 0), set(45, 10, 1)]);
  assert.equal(advice.type, 'down');
  assert.equal(advice.nextWeight, 42.5);
  assert.equal(advice.delta, -2.5);
});

test('高余力需同时完成中点次数，混合余力、组数不足和无效数据均不误加重', () => {
  const movement = resolveMovement(movementById('hip-abduction'), 'machine-abduction');
  for (const sets of [
    Array.from({ length: 4 }, () => set(45, 12, 4)),
    Array.from({ length: 4 }, () => set(45, 8, 6)),
    [set(45, 16, 4), set(45, 16, 4), set(45, 16, 4), set(45, 16, 0)],
    [set(45, 20, 7)], [set(45, 20, -1)], [set(0, 20, 4)], [set('', 20, 4)],
  ]) assert.equal(getProgressionAdvice(movement, sets).type, 'hold');
  assert.equal(getProgressionAdvice(movement, [set(45, 16, 4)], movement.repRange, { plannedSets: 4 }).type, 'hold');
});

test('辅助进退方向正确且不出现负辅助，时间和部分自重不建议错误的kg调整', () => {
  const assisted = resolveMovement(movementById('pullup'), 'assisted-pullup');
  const up = getProgressionAdvice(assisted, [set(.5, 10, 2)], assisted.repRange, { bodyWeight: 70 });
  assert.equal(up.nextWeight, 0);
  assert.equal(up.delta, -.5);
  const noAssistance = getProgressionAdvice(assisted, [set(0, 10, 2)], assisted.repRange, { bodyWeight: 70 });
  assert.equal(noAssistance.delta, 0);
  assert.ok(noAssistance.text.includes('自重'));
  const down = getProgressionAdvice(assisted, [set(20, 2, 0)], assisted.repRange, { bodyWeight: 70 });
  assert.equal(down.nextWeight, 21);
  assert.equal(down.delta, 1);
  assert.equal(getProgressionAdvice(assisted, [set(20, 10, 2)]).type, 'hold');
  const plank = resolveMovement(movementById('plank'), 'plank');
  const timedUp = getProgressionAdvice(plank, [set(0, 60, 2)]);
  assert.equal(timedUp.delta, 5);
  assert.ok(timedUp.text.includes('秒'));
  assert.equal(getProgressionAdvice(movementById('plank'), [set(0, 60, 2)]).delta, 5);
  const timedDown = getProgressionAdvice(plank, [set(0, 10, 0)]);
  assert.equal(timedDown.delta, -5);
  assert.ok(!timedDown.text.includes('重量'));
  const pushup = resolveMovement(movementById('pushup'), 'pushup');
  assert.ok(getProgressionAdvice(pushup, [set(0, 20, 2)]).text.includes('动作难度'));
});

test('完成量不能替代多周加组所需的负荷匹配证据', () => {
  const plan = { ...createPlan(DEFAULT_PROFILE, DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS), days: [{ id: 'd', exercises: [{ movementId: bench.id, variantId: 'db-bench', sets: 8 }] }] };
  for (const sample of [set(20, 10, 4), set(20, 16, 2), set(20, 10, 0)]) {
    const records = logs([sample, sample, sample]);
    const actual = analyzeRecords(records, plan.targets);
    assert.equal(actual.groups.chest.sets, 24);
    const review = reviewVolume(plan, records, 'p', new Date(before)).find((item) => item.id === 'chest');
    assert.equal(review.next, null);
    assert.ok(review.weekly.every((week) => week.sets === 0 && week.rawSets === 8));
  }
});
