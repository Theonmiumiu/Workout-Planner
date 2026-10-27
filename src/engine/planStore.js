import { migrateLegacyPlan } from './planner.js';

const clone = (value) => structuredClone(value);
export const newId = (prefix) => `${prefix}-${globalThis.crypto.randomUUID()}`;
export const planFingerprint = (plan) => JSON.stringify({ days: plan.days, targets: plan.targets, profile: plan.profile });
export const activeEntry = (store) => store.plans.find((entry) => entry.id === store.activePlanId && !entry.deletedAt);
export const isDraftChanged = (entry) => planFingerprint(entry.draft) !== planFingerprint(entry.revisions.at(-1).plan);

export function makePlanEntry(plan, name = '我的训练计划') {
  const now = new Date().toISOString();
  return { id: newId('program'), name, createdAt: now, updatedAt: now, settings: clone(plan.profile), draft: clone(plan), revisions: [
    { id: newId('revision'), number: 1, name: '初始版本', createdAt: now, plan: clone(plan) },
  ] };
}

export function createPlanStore(plan) {
  const entry = makePlanEntry(plan);
  return { schemaVersion: 1, activePlanId: entry.id, plans: [entry] };
}

export function migratePlanStore(value, fallback) {
  if (!value) return createPlanStore(fallback);
  if (!Array.isArray(value.plans) || !value.plans.length) throw new Error('无效的计划备份');
  const plans = value.plans.map((entry) => {
    if (!entry.id || !entry.name || !entry.draft?.days || !entry.draft.profile || !entry.draft.targets) throw new Error('无效的计划备份');
    const draft = migrateLegacyPlan(entry.draft);
    const revisions = (entry.revisions ?? []).map((revision, index) => {
      if (!revision.plan?.days || !revision.plan.profile || !revision.plan.targets) throw new Error('无效的版本备份');
      return { ...revision, number: index + 1, plan: migrateLegacyPlan(revision.plan) };
    });
    return { ...entry, settings: entry.settings ?? draft.profile, draft, revisions: revisions.length ? revisions : makePlanEntry(draft).revisions };
  });
  const live = plans.filter((entry) => !entry.deletedAt);
  if (!live.length) throw new Error('至少保留一个训练计划');
  return { schemaVersion: 1, plans, activePlanId: live.some((entry) => entry.id === value.activePlanId) ? value.activePlanId : live[0].id };
}

export function updateDraft(store, updater) {
  return { ...store, plans: store.plans.map((entry) => entry.id === store.activePlanId
    ? { ...entry, draft: typeof updater === 'function' ? updater(entry.draft) : clone(updater), updatedAt: new Date().toISOString() }
    : entry) };
}

export function saveRevision(store, name = '手动保存') {
  return { ...store, plans: store.plans.map((entry) => entry.id === store.activePlanId ? { ...entry, revisions: [...entry.revisions, {
    id: newId('revision'), number: entry.revisions.length + 1, name: String(name ?? '').trim().slice(0, 100) || '手动保存', createdAt: new Date().toISOString(), plan: clone(entry.draft),
  }] } : entry) };
}

export function renameRevision(store, revisionId, name) {
  const nextName = String(name ?? '').trim().slice(0, 100);
  if (!nextName) return store;
  return { ...store, plans: store.plans.map((entry) => entry.id === store.activePlanId
    ? { ...entry, revisions: entry.revisions.map((revision) => revision.id === revisionId ? { ...revision, name: nextName } : revision) }
    : entry) };
}

export function checkpointDraft(store, name) {
  return isDraftChanged(activeEntry(store)) ? saveRevision(store, name) : store;
}

export function replaceDraftWithVersion(store, plan, reason) {
  const checkpoint = checkpointDraft(store, `${reason}前的草稿`);
  const updated = updateDraft(checkpoint, plan);
  return saveRevision({ ...updated, plans: updated.plans.map((entry) => entry.id === updated.activePlanId ? { ...entry, settings: clone(plan.profile) } : entry) }, reason);
}

export function restoreRevision(store, revisionId) {
  const revision = activeEntry(store).revisions.find((item) => item.id === revisionId);
  if (!revision) return store;
  return replaceDraftWithVersion(store, revision.plan, `恢复自 v${revision.number}`);
}

export function addPlan(store, plan, name) {
  const entry = makePlanEntry(plan, name);
  return { ...store, plans: [...store.plans, entry], activePlanId: entry.id };
}

export function deletePlan(store, id) {
  const live = store.plans.filter((entry) => !entry.deletedAt);
  if (live.length <= 1 || !live.some((entry) => entry.id === id)) return store;
  return { ...store, activePlanId: store.activePlanId === id ? live.find((entry) => entry.id !== id).id : store.activePlanId,
    plans: store.plans.map((entry) => entry.id === id ? { ...entry, deletedAt: new Date().toISOString() } : entry) };
}

export function reorderExercises(exercises, sourceId, targetId) {
  const from = exercises.findIndex((item) => item.id === sourceId);
  const to = exercises.findIndex((item) => item.id === targetId);
  if (from < 0 || to < 0 || from === to) return exercises;
  const next = [...exercises];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}
