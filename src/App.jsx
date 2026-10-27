import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, ClipboardCheck, Download, Dumbbell, FileText, LayoutDashboard, Settings2, Upload, X } from 'lucide-react';
import { DEFAULT_ATTACHMENTS, DEFAULT_EQUIPMENT, DEFAULT_PROFILE } from './data/exercises.js';
import { analyzePlan, createPlan, migrateLegacyLogs, migrateLegacyPlan, migrateLegacyProfile, setCustomData, movementById } from './engine/planner.js';
import { buildLoadHistory } from './engine/workload.js';

// 加载时迁移旧动作模型，并修正历史动作与版本归属；之后删除 v1 键。
if (typeof localStorage !== 'undefined') {
  try {
    const read = (key) => { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; };
    const storedPlan = read('form-plan-v2');
    if (storedPlan) localStorage.setItem('form-plan-v2', JSON.stringify(migrateLegacyPlan(storedPlan)));
    const storedLogs = read('form-logs-v2');
    if (storedLogs) localStorage.setItem('form-logs-v2', JSON.stringify(migrateLegacyLogs(storedLogs)));
    if (!localStorage.getItem('form-plan-v2')) {
      const legacyPlan = read('form-plan-v1');
      if (legacyPlan) {
        const migrated = migrateLegacyPlan(legacyPlan);
        if (migrated) localStorage.setItem('form-plan-v2', JSON.stringify(migrated));
      }
      localStorage.setItem('form-logs-v2', JSON.stringify(migrateLegacyLogs(read('form-logs-v1') ?? [])));
    }
    if (!localStorage.getItem('form-profile-v2')) {
      const legacyProfile = read('form-profile-v1');
      if (legacyProfile) localStorage.setItem('form-profile-v2', JSON.stringify(migrateLegacyProfile(legacyProfile)));
    }
    if (!localStorage.getItem('form-equipment-v2')) {
      const legacyEquipment = read('form-equipment-v1');
      if (legacyEquipment) localStorage.setItem('form-equipment-v2', JSON.stringify(legacyEquipment));
      const legacyAttachments = read('form-attachments-v1');
      if (legacyAttachments) localStorage.setItem('form-attachments-v2', JSON.stringify(legacyAttachments));
    }
    for (const key of ['form-plan-v1', 'form-logs-v1', 'form-profile-v1', 'form-equipment-v1', 'form-attachments-v1']) localStorage.removeItem(key);
  } catch { /* 迁移失败时保留默认行为 */ }
}

// 自定义器械与动作在首次生成计划前注入引擎。
if (typeof localStorage !== 'undefined') {
  try {
    const raw = localStorage.getItem('form-custom-v1');
    if (raw) setCustomData(JSON.parse(raw));
  } catch { /* 自定义数据损坏时使用内置数据 */ }
}
import PlanManager from './components/PlanManager.jsx';
import SaveVersionDialog from './components/SaveVersionDialog.jsx';
import { activeEntry, addPlan, checkpointDraft, createPlanStore, isDraftChanged, migratePlanStore, replaceDraftWithVersion, saveRevision, updateDraft } from './engine/planStore.js';
import { VOLUME_GROUPS, weekdaysFor, customMusclesFor } from './engine/training.js';
import EquipmentPage from './pages/EquipmentPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import PlanPage from './pages/PlanPage.jsx';
import LogsPage from './pages/LogsPage.jsx';
import LibraryPage from './pages/LibraryPage.jsx';
import DocsPage from './pages/DocsPage.jsx';

const NAV = [
  { id: 'plan', name: '本周计划', icon: LayoutDashboard },
  { id: 'equipment', name: '我的健身房', icon: Dumbbell },
  { id: 'profile', name: '训练参数', icon: Settings2 },
  { id: 'logs', name: '训练记录', icon: ClipboardCheck },
  { id: 'library', name: '动作库', icon: BookOpen },
  { id: 'docs', name: 'Docs', icon: FileText },
];

function useStoredState(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : (typeof initialValue === 'function' ? initialValue() : initialValue);
    } catch { return typeof initialValue === 'function' ? initialValue() : initialValue; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch { window.dispatchEvent(new Event('form-storage-error')); }
  }, [key, state]);
  return [state, setState];
}

export default function App() {
  const [active, setActive] = useState('plan');
  const [equipment, setEquipment] = useStoredState('form-equipment-v2', DEFAULT_EQUIPMENT);
  const [attachments, setAttachments] = useStoredState('form-attachments-v2', DEFAULT_ATTACHMENTS);
  const [custom, setCustomValue] = useStoredState('form-custom-v1', { equipment: [], movements: [] });
  const setCustom = (value) => { setCustomData(value); setCustomValue(value); };
  const [store, setStore] = useStoredState('form-plans-v1', () => {
    const read = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
    const initialProfile = { ...DEFAULT_PROFILE, ...read('form-profile-v2') };
    const initialPlan = read('form-plan-v2') ?? createPlan(initialProfile, equipment, attachments);
    const initial = createPlanStore(migrateLegacyPlan(initialPlan));
    initial.plans[0].settings = initialProfile;
    return initial;
  });
  // Migrate every saved draft/version once per app mount, including revised movement ownership.
  const [migrated, setMigrated] = useState(false);
  useEffect(() => { if (!migrated) { setStore((current) => migratePlanStore(current, activeEntry(current).draft)); setMigrated(true); } }, [migrated]);
  const entry = activeEntry(store);
  const plan = entry.draft;
  const settings = entry.settings ?? plan.profile;
  const profile = { ...DEFAULT_PROFILE, ...settings, preferences: { ...DEFAULT_PROFILE.preferences, ...settings.preferences }, weights: settings.weights ?? {} };
  const setProfile = (value) => setStore((current) => ({ ...current, plans: current.plans.map((item) => item.id === current.activePlanId ? { ...item, settings: value } : item) }));
  const setPlan = (value) => setStore((current) => updateDraft(current, value));
  const [logs, setLogs] = useStoredState('form-logs-v2', []);
  const [showManager, setShowManager] = useState(false);
  const [showSaveVersion, setShowSaveVersion] = useState(false);
  const [logDayId, setLogDayId] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const fileRef = useRef(null);
  const notify = (message, action = null) => {
    setToast({ message, action });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), action ? 9000 : 5000);
  };
  useEffect(() => {
    const storageError = () => notify('本机存储写入失败，请导出备份；当前修改可能无法在刷新后保留。');
    window.addEventListener('form-storage-error', storageError);
    return () => window.removeEventListener('form-storage-error', storageError);
  }, []);
  // Keep the existing single-plan keys as a backwards-compatible active-plan mirror.
  useEffect(() => {
    try { localStorage.setItem('form-plan-v2', JSON.stringify(plan)); localStorage.setItem('form-profile-v2', JSON.stringify(profile)); }
    catch { notify('本机存储空间不足，请先导出备份；当前修改可能无法持久保存。'); }
  }, [plan, settings]);
  const navigate = (id) => { setActive(id); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const generate = () => {
    const incompleteDay = profile.split === 'custom' ? weekdaysFor(profile).find((weekday) => !customMusclesFor(profile, weekday).length) : undefined;
    if (incompleteDay !== undefined) { notify(`请先选择周${incompleteDay || '日'}的训练部位`); return; }
    const next = createPlan({ ...profile, loadHistory: buildLoadHistory(logs, movementById, { planId: entry.id }) }, equipment, attachments, plan);
    setStore((current) => replaceDraftWithVersion(current, next, '重新生成'));
    navigate('plan');
    notify(next.generationWarnings.length ? '新版本已生成；部分锁定动作不兼容，请查看提示' : '新版本已生成，原内容已保留在版本历史');
  };
  const startLog = (dayId) => { setStore((current) => checkpointDraft(current, '开始训练前自动保存')); setLogDayId(dayId); navigate('logs'); };
  const deleteMovement = (id) => {
    const movement = custom.movements.find((item) => item.id === id);
    if (!movement) return;
    setCustom({ ...custom, movements: custom.movements.map((item) => item.id === id ? { ...item, deletedAt: new Date().toISOString() } : item) });
    notify(`已删除「${movement.name}」，已有计划和记录保留`, { label: '撤销删除', run: () => {
      setCustomValue((current) => { const next = { ...current, movements: current.movements.map((item) => item.id === id ? { ...item, deletedAt: null } : item) }; setCustomData(next); return next; });
    } });
  };
  const applyBudget = (groupId, value, evidence = null) => {
    if (!VOLUME_GROUPS[groupId] || !Number.isFinite(value) || value < 2 || value > 30) return;
    const volumeOverrides = { ...plan.profile.volumeOverrides, [groupId]: value };
    const volumeReviews = evidence ? { ...plan.profile.volumeReviews, [groupId]: { through: evidence.through, value, appliedAt: new Date().toISOString() } } : plan.profile.volumeReviews;
    const targets = { ...plan.targets };
    VOLUME_GROUPS[groupId].muscles.forEach((id) => { targets[id] = value; });
    const next = { ...plan, profile: { ...plan.profile, volumeOverrides, volumeReviews }, targets, analysis: analyzePlan(plan.days, targets) };
    setStore((current) => {
      const updated = replaceDraftWithVersion(current, next, `${evidence ? '应用记录建议' : '调整周预算'}：${VOLUME_GROUPS[groupId].name} ${value}组`);
      return { ...updated, plans: updated.plans.map((item) => item.id === updated.activePlanId ? { ...item, settings: { ...profile, volumeOverrides: { ...profile.volumeOverrides, [groupId]: value }, volumeReviews } } : item) };
    });
    notify('周预算已保存为新版本；下次生成时调整动作组数，当前动作安排保留。');
  };
  const exportData = () => {
    const blob = new Blob([JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), equipment, attachments, profile, plan, logs, custom, planStore: store }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `SET-backup-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url);
    notify('全部计划、版本与训练记录已导出');
  };
  const importData = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.plan?.days || !data.profile?.preferences || !Array.isArray(data.equipment)) throw new Error('invalid');
      setCustomData(data.custom ?? { equipment: [], movements: [] });
      const migratedPlan = migrateLegacyPlan(data.plan);
      const next = data.planStore ? migratePlanStore(data.planStore, migratedPlan) : createPlanStore(migratedPlan);
      if (!data.planStore) next.plans[0].settings = migrateLegacyProfile(data.profile);
      setCustom(data.custom ?? { equipment: [], movements: [] });
      setEquipment(data.equipment); setAttachments(data.attachments ?? []); setStore(next); setLogs(migrateLegacyLogs(data.logs ?? []));
      notify('全部计划与记录已恢复');
    } catch { setCustomData(custom); notify('无法读取备份，请选择 SET 导出的 JSON 文件'); }
    event.target.value = '';
  };
  const common = { plan, setPlan, equipment, attachments, profile, setProfile, onGenerate: generate };
  const page = {
    plan: <PlanPage key={entry.id} {...common} onStartLog={startLog} planName={entry.name} versionNumber={entry.revisions.at(-1).number} versionName={entry.revisions.at(-1).name} draftChanged={isDraftChanged(entry)} onManage={() => setShowManager(true)} onSaveVersion={() => setShowSaveVersion(true)} logs={logs} planId={entry.id} onApplyBudget={applyBudget} />,
    equipment: <EquipmentPage equipment={equipment} setEquipment={setEquipment} attachments={attachments} setAttachments={setAttachments} onGoPlan={() => navigate('plan')} custom={custom} setCustom={setCustom} />,
    profile: <ProfilePage profile={profile} setProfile={setProfile} equipment={equipment} attachments={attachments} onGoPlan={() => navigate('plan')} />,
    logs: <LogsPage key={entry.id} plan={plan} setPlan={setPlan} logs={logs} setLogs={setLogs} initialDayId={logDayId} notify={notify} planId={entry.id} revisionId={entry.revisions.at(-1).id} planName={entry.name} />,
    library: <LibraryPage equipment={equipment} setEquipment={setEquipment} attachments={attachments} profile={profile} setProfile={setProfile} custom={custom} setCustom={setCustom} onDeleteMovement={deleteMovement} />,
    docs: <DocsPage profile={profile} plan={plan} />,
  }[active];
  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate('plan')} aria-label="SET首页"><img className="brand-mark" src="/set-mark.svg" alt="" width="32" height="32" /><strong>SET</strong></button>
      <nav>{NAV.map(({ id, name, icon: Icon }) => <button key={id} className={active === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={18} /><span>{name}</span></button>)}</nav>
      <div className="sidebar-spacer" />
      <div className="backup-actions"><button onClick={exportData}><Download size={15} />导出备份</button><button onClick={() => fileRef.current?.click()}><Upload size={15} />导入</button><input ref={fileRef} type="file" accept="application/json,.json" onChange={importData} hidden /></div>
    </aside>
    <div className="main-shell"><header className="topbar"><button className="topbar-brand" onClick={() => navigate('plan')} aria-label="返回 SET 计划首页"><img src="/set-mark.svg" alt="" width="18" height="18" /><span>SET</span></button><span>/</span><strong>{NAV.find((item) => item.id === active)?.name}</strong></header>{page}</div>
    <nav className="mobile-nav">{NAV.map(({ id, name, icon: Icon }) => <button key={id} className={active === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={19} /><span>{name.replace('本周', '').replace('我的', '')}</span></button>)}</nav>
    {showManager && <PlanManager key={entry.id} store={store} onChange={setStore} onCreate={() => setStore((current) => addPlan(current, createPlan(profile, equipment, attachments), `训练计划 ${current.plans.filter((item) => !item.deletedAt).length + 1}`))} onClose={() => setShowManager(false)} />}
    {showSaveVersion && <SaveVersionDialog number={entry.revisions.length + 1} onClose={() => setShowSaveVersion(false)} onSave={(name) => { setStore((current) => saveRevision(current, name)); setShowSaveVersion(false); notify('当前草稿已保存为新版本'); }} />}
    {toast && <div className="toast" role="status"><Check size={17} /><span>{toast.message}</span>{toast.action && <button className="toast-action" onClick={() => { toast.action.run(); setToast(null); }}>{toast.action.label}</button>}<button aria-label="关闭提示" onClick={() => setToast(null)}><X size={15} /></button></div>}
  </div>;
}
