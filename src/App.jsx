import React, { useEffect, useRef, useState } from 'react';
import { Activity, BookOpen, Check, ClipboardCheck, Download, Dumbbell, LayoutDashboard, Scale, Settings2, Upload, X } from 'lucide-react';
import { DEFAULT_ATTACHMENTS, DEFAULT_EQUIPMENT, DEFAULT_PROFILE } from './data/exercises.js';
import { createPlan, migrateLegacyLogs, migrateLegacyPlan, migrateLegacyProfile, setCustomData } from './engine/planner.js';

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
import EquipmentPage from './pages/EquipmentPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import PlanPage from './pages/PlanPage.jsx';
import LogsPage from './pages/LogsPage.jsx';
import LibraryPage from './pages/LibraryPage.jsx';
import RulesPage from './pages/RulesPage.jsx';

const NAV = [
  { id: 'plan', name: '本周计划', icon: LayoutDashboard },
  { id: 'equipment', name: '我的健身房', icon: Dumbbell },
  { id: 'profile', name: '训练参数', icon: Settings2 },
  { id: 'logs', name: '训练记录', icon: ClipboardCheck },
  { id: 'library', name: '动作库', icon: BookOpen },
  { id: 'rules', name: '进阶规则', icon: Scale },
];

function useStoredState(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : (typeof initialValue === 'function' ? initialValue() : initialValue);
    } catch { return typeof initialValue === 'function' ? initialValue() : initialValue; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* Storage may be unavailable in private mode. */ }
  }, [key, state]);
  return [state, setState];
}

export default function App() {
  const [active, setActive] = useState('plan');
  const [equipment, setEquipment] = useStoredState('form-equipment-v2', DEFAULT_EQUIPMENT);
  const [attachments, setAttachments] = useStoredState('form-attachments-v2', DEFAULT_ATTACHMENTS);
  const [storedProfile, setProfile] = useStoredState('form-profile-v2', DEFAULT_PROFILE);
  const profile = { ...DEFAULT_PROFILE, ...storedProfile, preferences: { ...DEFAULT_PROFILE.preferences, ...storedProfile.preferences }, weights: storedProfile.weights ?? {} };
  const [plan, setPlan] = useStoredState('form-plan-v2', () => createPlan(profile, equipment, attachments));
  const [logs, setLogs] = useStoredState('form-logs-v2', []);
  const [custom, setCustom] = useStoredState('form-custom-v1', { equipment: [], movements: [] });
  useEffect(() => { setCustomData(custom); }, [custom]);
  const [logDayId, setLogDayId] = useState(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const fileRef = useRef(null);

  const notify = (message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3600);
  };
  const navigate = (id) => { setActive(id); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const generate = () => {
    const next = createPlan(profile, equipment, attachments, plan);
    setPlan(next);
    navigate('plan');
    notify(next.generationWarnings.length ? '新计划已生成；部分锁定动作不兼容，请查看安排提示' : '新计划已生成，兼容的锁定动作已保留');
  };
  const startLog = (dayId) => { setLogDayId(dayId); navigate('logs'); };
  const exportData = () => {
    const blob = new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), equipment, attachments, profile, plan, logs, custom }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `形训备份-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify('备份文件已导出');
  };
  const importData = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.plan?.days || !data.profile?.preferences || !Array.isArray(data.equipment)) throw new Error('invalid');
      const migratedPlan = data.plan.days[0]?.exercises?.[0]?.exerciseId ? migrateLegacyPlan(data.plan) : data.plan;
      if (!migratedPlan) throw new Error('invalid');
      setEquipment(data.equipment);
      setAttachments(data.attachments ?? []);
      setProfile(migrateLegacyProfile(data.profile));
      setPlan(migratedPlan);
      setLogs(data.logs?.[0]?.exercises?.[0]?.exerciseId ? migrateLegacyLogs(data.logs) : (data.logs ?? []));
      setCustom(data.custom ?? { equipment: [], movements: [] });
      notify('备份已恢复');
    } catch { notify('无法读取备份，请选择形训导出的 JSON 文件'); }
    event.target.value = '';
  };

  const common = { plan, setPlan, equipment, attachments, profile, setProfile, onGenerate: generate };
  const page = {
    plan: <PlanPage {...common} onStartLog={startLog} />,
    equipment: <EquipmentPage equipment={equipment} setEquipment={setEquipment} attachments={attachments} setAttachments={setAttachments} onGoPlan={() => navigate('plan')} custom={custom} setCustom={setCustom} />,
    profile: <ProfilePage profile={profile} setProfile={setProfile} equipment={equipment} attachments={attachments} onGoPlan={() => navigate('plan')} />,
    logs: <LogsPage plan={plan} setPlan={setPlan} logs={logs} setLogs={setLogs} initialDayId={logDayId} notify={notify} />,
    library: <LibraryPage equipment={equipment} setEquipment={setEquipment} attachments={attachments} profile={profile} setProfile={setProfile} custom={custom} setCustom={setCustom} />,
    rules: <RulesPage />,
  }[active];

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate('plan')} aria-label="形训首页"><span className="brand-mark"><Activity size={22} /></span><strong>形训</strong></button>
      <nav>{NAV.map(({ id, name, icon: Icon }) => <button key={id} className={active === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={18} /><span>{name}</span></button>)}</nav>
      <div className="sidebar-spacer" />
      <div className="backup-actions"><button onClick={exportData}><Download size={15} />导出备份</button><button onClick={() => fileRef.current?.click()}><Upload size={15} />导入</button><input ref={fileRef} type="file" accept="application/json,.json" onChange={importData} hidden /></div>
      <div className="sidebar-footer">本地保存 · 数据不离开此设备</div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><span>形训</span><span>/</span><strong>{NAV.find((item) => item.id === active)?.name}</strong></header>
      {page}
      <footer className="app-footer">形训 FORM · 训练应当可持续，而不是每天力竭。</footer>
    </div>

    <nav className="mobile-nav">{NAV.slice(0, 5).map(({ id, name, icon: Icon }) => <button key={id} className={active === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={19} /><span>{name.replace('本周', '').replace('我的', '')}</span></button>)}</nav>
    {toast && <div className="toast" role="status"><Check size={17} /><span>{toast}</span><button onClick={() => setToast('')}><X size={15} /></button></div>}
  </div>;
}
