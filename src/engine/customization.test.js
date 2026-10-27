import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE, DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS } from '../data/exercises.js';
import { createPlan, estimateDay, createInitialLogs, movementForEntry, analyzePlan, getTargets, getVolumeSources } from './planner.js';
import { seedCustomSchedule, customMusclesFor, isMovementAllowedForFocus, restForReplacement } from './training.js';
import { createPlanStore, activeEntry, updateDraft, saveRevision, restoreRevision, migratePlanStore } from './planStore.js';
import { buildDocs, docsText } from '../data/docs.js';
import { reviewVolume } from './volumeReview.js';
import { MUSCLE_MODEL_VERSION } from '../data/exercises.js';

const clone = (value) => structuredClone(value);
const generate = (patch = {}, previous) => createPlan({ ...clone(DEFAULT_PROFILE), ...patch }, DEFAULT_EQUIPMENT, DEFAULT_ATTACHMENTS, previous);

test('自定义星期严格保留指定肌群，支持胸背混合，不自动交换日期', () => {
  const customSchedule = { 1: { muscles: ['upperChest', 'midChest', 'lowerChest', 'lats', 'upperBack'] }, 2: { muscles: ['quads', 'hamstrings'] }, 0: { muscles: ['biceps', 'triceps'] } };
  const plan = generate({ split: 'custom', weekdays: [0, 2, 1], customSchedule });
  assert.deepEqual(plan.days.map((day) => day.weekday), [1, 2, 0]);
  for (const day of plan.days) {
    assert.equal(day.focus, 'custom');
    assert.deepEqual(day.muscles, customSchedule[day.weekday].muscles);
    assert.ok(day.exercises.length >= 2);
    assert.ok(day.exercises.every((entry) => isMovementAllowedForFocus(movementForEntry(entry), day)));
    assert.ok(estimateDay(day) <= plan.profile.minutes);
  }
  assert.ok(plan.days[0].title.includes('胸部') && plan.days[0].title.includes('背部'));
});

test('七练自定义包含周日，星期去重，训练日不因 48 小时参考被删除', () => {
  const weekdays = [0, 1, 2, 3, 4, 5, 6, 0];
  const customSchedule = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((weekday) => [weekday, { muscles: weekday % 2 ? ['biceps'] : ['triceps'] }]));
  const plan = generate({ split: 'custom', daysPerWeek: 1, weekdays, customSchedule });
  assert.equal(plan.days.length, 7);
  assert.equal(plan.profile.daysPerWeek, 7);
  assert.deepEqual(plan.days.map((day) => day.weekday), [1, 2, 3, 4, 5, 6, 0]);
  assert.ok(plan.days.every((day) => day.exercises.length > 0));
});

test('自定义未选择肌群时不跨部位填充，非法肌群被过滤', () => {
  const plan = generate({ split: 'custom', weekdays: [1], customSchedule: { 1: { muscles: ['not-a-muscle'] } } });
  assert.equal(plan.days[0].exercises.length, 0);
  assert.ok(plan.generationWarnings.some((warning) => warning.includes('尚未选择训练部位')));
});

test('切换自定义时按原模板填入，已有自定义设置和输入原对象保持不变', () => {
  const profile = { ...clone(DEFAULT_PROFILE), customSchedule: { 1: { muscles: ['biceps'] }, 0: { muscles: ['core'] } } };
  const original = clone(profile);
  const schedule = seedCustomSchedule(profile);
  assert.deepEqual(schedule[1].muscles, ['biceps']);
  assert.ok(schedule[2].muscles.includes('lats'));
  assert.deepEqual(schedule[0].muscles, ['core']);
  assert.deepEqual(profile, original);
  assert.deepEqual(customMusclesFor({ customSchedule: { 1: ['quads', 'quads', 'unknown'] } }, 1), ['quads']);
});

test('单条休息即时改变估时，零秒合法，不修改动作库默认参数', () => {
  const entry = { movementId: 'flat-bench-press', variantId: 'db-bench', sets: 3, rest: 60 };
  const before = movementForEntry({ ...entry, rest: undefined }).rest;
  assert.equal(estimateDay({ exercises: [{ ...entry, rest: 120 }] }) - estimateDay({ exercises: [entry] }), 3);
  assert.equal(movementForEntry({ ...entry, rest: 0 }).rest, 0);
  assert.equal(movementForEntry({ ...entry, rest: -1 }).rest, before);
  assert.equal(movementForEntry({ ...entry, rest: undefined }).rest, before);
});

test('截图中相差30秒的四组休息恰好相差两分钟，同一处方重复估时一致', () => {
  const day = { exercises: [
    { movementId: 'squat', variantId: 'hack-squat', sets: 6, rest: 180 },
    { movementId: 'hip-thrust', variantId: 'barbell-hip-thrust', sets: 4, rest: 120 },
    { movementId: 'leg-curl', variantId: 'seated-leg-curl', sets: 4, rest: 90 },
    { movementId: 'hip-abduction', variantId: 'machine-abduction', sets: 4, rest: 60 },
    { movementId: 'rdl', variantId: 'db-rdl', sets: 4, rest: 90 },
  ] };
  const original = clone(day);
  assert.equal(estimateDay(day), 73);
  const shorter = clone(day);
  shorter.exercises[4].rest = 60;
  assert.equal(estimateDay(shorter), 71);
  assert.equal(estimateDay(clone(day)), 73);
  assert.deepEqual(day, original);
});

test('默认休息用于所有新条目，并实际约束生成时长', () => {
  const short = generate({ restSeconds: 30 });
  const long = generate({ restSeconds: 300 });
  assert.ok(long.days.flatMap((day) => day.exercises).every((entry) => entry.rest === 300));
  assert.ok(long.days.every((day) => estimateDay(day) <= 60));
  const count = (plan) => plan.days.flatMap((day) => day.exercises).reduce((sum, entry) => sum + entry.sets, 0);
  assert.ok(count(long) < count(short));
});

test('锁定条目的自定义休息随重新生成、日志快照和版本备份保留', () => {
  const plan = generate();
  Object.assign(plan.days[0].exercises[0], { locked: true, rest: 185 });
  const next = generate({ restSeconds: 60 }, plan);
  const retained = next.days[0].exercises.find((entry) => entry.locked);
  assert.equal(retained.rest, 185);
  const log = createInitialLogs(next)[0].exercises.find((entry) => entry.movementId === retained.movementId);
  assert.equal(log.rest, 185);
  assert.equal(log.movementSnapshot.rest, 185);
  let store = createPlanStore(next);
  const revisionId = activeEntry(store).revisions[0].id;
  store = updateDraft(store, (draft) => ({ ...draft, days: draft.days.map((day, index) => index ? day : { ...day, exercises: day.exercises.map((entry) => ({ ...entry, rest: 20 })) }) }));
  store = saveRevision(store);
  store = restoreRevision(store, revisionId);
  const imported = migratePlanStore(JSON.parse(JSON.stringify(store)), next);
  assert.equal(activeEntry(imported).draft.days[0].exercises.find((entry) => entry.locked).rest, 185);
});

test('周目标动作来源与汇总一致，包含辅助贡献且不混入稳定参与', () => {
  const days = [{ id: 'a', weekday: 1, title: '胸部', exercises: [
    { id: 'bench', movementId: 'flat-bench-press', variantId: 'db-bench', sets: 4 },
    { id: 'fly', movementId: 'chest-fly', variantId: 'cable-fly', sets: 2 },
  ] }, { id: 'b', weekday: 4, title: '腿部', exercises: [{ id: 'squat', movementId: 'squat', variantId: 'hack-squat', sets: 3 }] }];
  const analysis = analyzePlan(days, getTargets(DEFAULT_PROFILE));
  for (const [id, coverage] of Object.entries(analysis.groupCoverage)) {
    const sources = getVolumeSources(days, id);
    assert.equal(Math.round(sources.reduce((sum, source) => sum + source.contribution, 0) * 10) / 10, coverage.sets, id);
  }
  assert.equal(getVolumeSources(days, 'triceps')[0].role, '辅助');
  assert.equal(getVolumeSources(days, 'triceps')[0].contribution, 2);
  assert.equal(getVolumeSources(days, 'core').length, 0);
  assert.equal(getVolumeSources(days, 'glutes')[0].weekday, 4);
  assert.equal(getVolumeSources(days, 'unknown').length, 0);
});

test('休息条件改变后，不将不同条件的三周表现误作停滞加量', () => {
  const plan = generate();
  plan.days = [{ id: 'a', exercises: [{ movementId: 'flat-bench-press', variantId: 'db-bench', sets: 8 }] }];
  const records = ['2026-10-06T12:00:00Z', '2026-10-13T12:00:00Z', '2026-10-20T12:00:00Z'].map((date, index) => ({ id: `${index}`, date, planId: 'p', muscleModelVersion: MUSCLE_MODEL_VERSION, verified: true, recovery: 'good', budgetSnapshot: { chest: 8 }, exercises: [{ movementId: 'flat-bench-press', variantId: 'db-bench', rest: index === 2 ? 60 : 150, sets: Array.from({ length: 8 }, () => ({ weight: 20, reps: 10, rir: 2 })) }] }));
  const chest = reviewVolume(plan, records, 'p', new Date('2026-10-27T12:00:00Z')).find((review) => review.id === 'chest');
  assert.equal(chest.next, null);
});

test('Docs 明确区分两类偏好，参数预览与已有计划目标分别显示', () => {
  const plan = generate();
  const settings = { ...clone(DEFAULT_PROFILE), preferences: { ...DEFAULT_PROFILE.preferences, biceps: 'priority' }, regionPreferences: { gluteMedius: 'priority' } };
  const sections = buildDocs(settings, plan);
  assert.ok(docsText(sections.find((section) => section.id === 'preferences')).includes('不另建一份完整的周总量配额'));
  const row = sections.find((section) => section.id === 'current').blocks.find((block) => block.columns?.[0] === '肌群').rows.find((row) => row[0] === '肱二头肌');
  assert.deepEqual(row.slice(1), ['12.8 组', '8 组']);
  assert.ok(sections.some((section) => section.id === 'rest'));
});

test('切换器械跟随默认休息，自定义与统一休息保留', () => {
  assert.deepEqual(restForReplacement({ rest: 150, restSource: 'variant' }, {}, 90), { rest: 90, restSource: 'variant' });
  assert.deepEqual(restForReplacement({ rest: 240, restSource: 'custom' }, {}, 90), { rest: 240, restSource: 'custom' });
  assert.deepEqual(restForReplacement({ rest: 120, restSource: 'profile' }, {}, 90), { rest: 120, restSource: 'profile' });
  assert.deepEqual(restForReplacement({}, { restSeconds: 0 }, 90), { rest: 0, restSource: 'profile' });
});
