import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, ClipboardCheck, History, Plus, Trash2, TrendingUp } from 'lucide-react';
import { WEEKDAYS, MUSCLE_MODEL_VERSION } from '../data/exercises.js';
import { analyzePlan, createInitialLogs, getProgressionAdvice, movementById, movementForEntry } from '../engine/planner.js';
import { groupTargets } from '../engine/training.js';
import { summarizeEntry, numeric, DOSE_MODEL_VERSION } from '../engine/workload.js';

const entryName = (entry) => {
  const movement = entry.movementSnapshot ?? movementById(entry.movementId);
  const variant = movement?.variants.find((item) => item.id === entry.variantId);
  return variant && variant.name !== movement?.name ? `${movement?.name ?? ''} · ${variant.name}` : (movement?.name ?? '未知动作');
};
const entryKey = (entry) => `${entry.movementId}|${entry.variantId ?? ''}`;

function TrendChart({ points, unit }) {
  if (!points.length) return <div className="empty-state compact"><TrendingUp size={26} /><p>暂无可用数据</p></div>;
  const width = 660; const height = 220; const pad = 32;
  const max = Math.max(...points.map((point) => point.value), 1);
  const coords = points.map((point, index) => ({ ...point, x: points.length === 1 ? width / 2 : pad + index * (width - pad * 2) / (points.length - 1), y: height - pad - point.value / max * (height - pad * 2) }));
  const path = coords.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  return <div className="trend-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="同器械版本的训练表现趋势">
    {[0, 1, 2, 3].map((line) => <line key={line} x1={pad} x2={width - pad} y1={pad + line * (height - pad * 2) / 3} y2={pad + line * (height - pad * 2) / 3} stroke="#e5e8e2" strokeDasharray="4 5" />)}
    {coords.length > 1 && <path d={path} fill="none" stroke="#617c38" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
    {coords.map((point, index) => <g key={`${point.date}-${index}`}><circle cx={point.x} cy={point.y} r="5" fill="#c8ed72" stroke="#41552d" strokeWidth="2"><title>{point.label}：{point.value} {unit}</title></circle><text x={point.x} y={point.y - 13} textAnchor="middle" fontSize="11" fill="#465248">{point.value}{unit}</text><text x={point.x} y={height - 7} textAnchor="middle" fontSize="10" fill="#8a928b">{point.label}</text></g>)}
  </svg></div>;
}

export default function LogsPage({ plan, setPlan, logs, setLogs, initialDayId, notify, planId, revisionId, planName }) {
  const [mode, setMode] = useState('log');
  const [dayId, setDayId] = useState(initialDayId ?? plan.days[0]?.id);
  const [draft, setDraft] = useState([]);
  const [selectedEntry, setSelectedEntry] = useState('');
  const [metric, setMetric] = useState('weight');
  const [recovery, setRecovery] = useState('');
  const [bodyWeight, setBodyWeight] = useState(plan.profile.bodyWeight ?? '');
  const [verified, setVerified] = useState(false);
  const day = plan.days.find((item) => item.id === dayId) ?? plan.days[0];
  const initialLogs = useMemo(() => createInitialLogs(plan), [plan]);
  const ownLogs = useMemo(() => logs.filter((log) => log.planId === planId || !log.planId), [logs, planId]);
  useEffect(() => { if (initialDayId) setDayId(initialDayId); }, [initialDayId]);
  useEffect(() => { setDraft(structuredClone(initialLogs.find((item) => item.dayId === day?.id)?.exercises ?? [])); setRecovery(''); setVerified(false); }, [day?.id, initialLogs]);
  const historyEntries = useMemo(() => [...new Set(ownLogs.flatMap((log) => log.exercises.map(entryKey)))], [ownLogs]);
  useEffect(() => { if (!selectedEntry && historyEntries.length) setSelectedEntry(historyEntries[0]); }, [historyEntries, selectedEntry]);
  const metricNames = { weight: '最佳工作组重量', volumeLoad: '训练容量', estimatedMax: '估算 1RM', reps: '完成次数', seconds: '支撑时间' };
  const unit = metric === 'volumeLoad' ? 'kg·次' : metric === 'reps' ? '次' : metric === 'seconds' ? '秒' : 'kg';
  const points = [...ownLogs].sort((a, b) => a.date.localeCompare(b.date)).flatMap((log) => {
    const entry = log.exercises.find((item) => entryKey(item) === selectedEntry);
    if (!entry) return [];
    const movement = movementForEntry(entry);
    if (!movement) return [];
    const summary = summarizeEntry(entry, movement, { bodyWeight: log.bodyWeight });
    const workSets = entry.sets.filter((set) => set.kind !== 'warmup' && numeric(set.weight) && numeric(set.reps) && Number(set.reps) > 0);
    const value = metric === 'weight' ? workSets.length ? Math.max(...workSets.map((set) => Number(set.weight))) : null : metric === 'volumeLoad' && !summary.loadedSets ? null : summary[metric];
    if (value == null || (movement.loadMode === 'timed' && ['volumeLoad', 'estimatedMax', 'reps'].includes(metric))) return [];
    const date = new Date(log.date);
    return [{ date: log.date, value, label: `${date.getMonth() + 1}/${date.getDate()}` }];
  }).slice(-12);
  const completedSets = ownLogs.reduce((sum, log) => sum + log.exercises.reduce((total, entry) => { const movement = movementForEntry(entry); return total + (movement ? summarizeEntry(entry, movement, { bodyWeight: log.bodyWeight }).sets : 0); }, 0), 0);
  const updateSet = (key, index, field, value) => setDraft(draft.map((item) => entryKey(item) === key ? { ...item, sets: item.sets.map((set, i) => i === index ? { ...set, [field]: field === 'kind' || value === '' ? value : Number(value) } : set) } : item));
  const addSet = (key) => setDraft(draft.map((item) => entryKey(item) !== key ? item : { ...item, sets: [...item.sets, { ...(item.sets.at(-1) ?? { weight: '', reps: movementForEntry(item)?.repRange[0] ?? 10, rir: 2 }), kind: 'work' }] }));
  const removeSet = (key, index) => setDraft(draft.map((item) => entryKey(item) !== key ? item : { ...item, sets: item.sets.filter((_, i) => i !== index) }));
  const fillPlan = () => { setDraft(structuredClone(initialLogs.find((item) => item.dayId === day.id)?.exercises ?? [])); setVerified(false); };
  const finish = () => {
    if (!draft.some((item) => item.sets.length)) { notify('请至少保留一组训练记录'); return; }
    if (bodyWeight !== '' && (!numeric(bodyWeight) || Number(bodyWeight) < 20 || Number(bodyWeight) > 300)) { notify('请填写有效体重'); return; }
    const valid = draft.every((item) => item.sets.every((set) => ['weight', 'reps', 'rir'].every((field) => numeric(set[field]) && Number(set[field]) >= 0) && Number(set.reps) > 0 && Number(set.rir) <= 6));
    if (!valid) { notify('请填写有效重量、次数和 RIR'); return; }
    if (draft.some((item) => movementForEntry(item)?.loadMode === 'assisted' && numeric(bodyWeight) && item.sets.some((set) => Number(set.weight) >= Number(bodyWeight)))) { notify('辅助重量需要小于体重'); return; }
    const record = { id: `log-${crypto.randomUUID()}`, date: new Date().toISOString(), planId, planName, revisionId, muscleModelVersion: MUSCLE_MODEL_VERSION, doseModelVersion: DOSE_MODEL_VERSION, bodyWeight: bodyWeight === '' ? null : Number(bodyWeight), budgetSnapshot: groupTargets(plan.targets), verified, recovery: recovery || 'unknown', dayId: day.id, dayTitle: day.title, exercises: structuredClone(draft) };
    setLogs([record, ...logs]);
    const days = plan.days.map((item) => item.id === day.id ? { ...item, exercises: item.exercises.map((planned) => {
      const actual = draft.find((entry) => entryKey(entry) === entryKey(planned));
      const lastSet = actual?.sets?.filter((set) => set.kind !== 'warmup').at(-1);
      return lastSet ? { ...planned, weight: Number(lastSet.weight) } : planned;
    }) } : item);
    setPlan({ ...plan, days, profile: { ...plan.profile, bodyWeight: record.bodyWeight ?? plan.profile.bodyWeight }, analysis: analyzePlan(days, plan.targets, plan.profile) });
    notify('训练已保存'); setMode('history');
  };
  return <div className="page logs-page">
    <header className="page-header split-header"><div><h1>训练记录</h1><p className="page-summary">{planName}</p></div><div className="segmented-tabs"><button className={mode === 'log' ? 'active' : ''} onClick={() => setMode('log')}><ClipboardCheck size={16} />本次训练</button><button className={mode === 'history' ? 'active' : ''} onClick={() => setMode('history')}><History size={16} />历史趋势</button></div></header>
    {mode === 'log' ? <>
      <div className="log-day-bar"><div>{plan.days.map((item, index) => <button key={item.id} className={item.id === day.id ? 'active' : ''} onClick={() => setDayId(item.id)}><span>DAY {index + 1}</span><strong>{WEEKDAYS.find((w) => w.id === item.weekday).name} · {item.title}</strong></button>)}</div><button className="button secondary" onClick={fillPlan}>按计划填入</button></div>
      <label className="bodyweight-field">本次体重（kg）<input aria-label="本次体重（kg）" type="number" min="20" max="300" step="0.1" value={bodyWeight} onChange={(event) => setBodyWeight(event.target.value)} /></label>
      <div className="log-exercises">{draft.map((item, exerciseIndex) => {
        const key = entryKey(item); const movement = movementForEntry(item);
        if (!movement) return null;
        const repRange = item.repRange ?? movement.repRange;
        const workSets = item.sets.filter((set) => set.kind !== 'warmup');
        const advice = getProgressionAdvice(movement, workSets, repRange, { bodyWeight, plannedSets: item.plannedSets });
        const summary = summarizeEntry(item, movement, { bodyWeight });
        return <section className="log-card" key={key}>
          <div className="log-card-header"><div className="exercise-index">{String(exerciseIndex + 1).padStart(2, '0')}</div><div><h2>{entryName(item)}</h2><p>目标 {repRange[0]}–{repRange[1]} {movement.loadMode === 'timed' ? '秒' : '次'} · 组间 {movement.rest} 秒</p></div><span className={`advice-badge ${advice.type}`}>{advice.text}</span></div>
          <div className="set-table"><div className="set-row set-head"><span>组别</span><span>类型</span><span>{movement.loadLabel}</span><span>{movement.loadMode === 'timed' ? '时间（秒）' : movement.laterality === 'unilateral' ? '每侧次数' : '实际次数'}</span><span>RIR</span><span /></div>
            {item.sets.map((set, index) => <div className="set-row" key={index}><span className="set-number">{index + 1}</span><select aria-label={`${entryName(item)}第${index + 1}组类型`} value={set.kind ?? 'work'} onChange={(event) => updateSet(key, index, 'kind', event.target.value)}><option value="work">工作</option><option value="warmup">热身</option></select><input aria-label={`${entryName(item)}第${index + 1}组重量`} type="number" min="0" step="0.5" value={set.weight} onFocus={(event) => event.target.select()} onChange={(event) => updateSet(key, index, 'weight', event.target.value)} /><input aria-label={`${entryName(item)}第${index + 1}组次数`} type="number" min="0" step="1" value={set.reps} onFocus={(event) => event.target.select()} onChange={(event) => updateSet(key, index, 'reps', event.target.value)} /><input aria-label={`${entryName(item)}第${index + 1}组RIR`} type="number" min="0" max="6" step="0.5" value={set.rir} onFocus={(event) => event.target.select()} onChange={(event) => updateSet(key, index, 'rir', event.target.value)} /><button className="icon-button" onClick={() => removeSet(key, index)} aria-label="删除这一组"><Trash2 size={15} /></button></div>)}
          </div><div className="session-metrics"><span>完成 {summary.sets} / {item.plannedSets ?? workSets.length} 组</span><span>次数达成 {summary.targetSets} 组</span><span>负荷匹配 {summary.matchedSets} 组</span>{summary.lightSets > 0 && <span>偏轻 {summary.lightSets} 组</span>}{summary.heavySets > 0 && <span>偏重 {summary.heavySets} 组</span>}{summary.failureSets > 0 && <span>力竭 {summary.failureSets} 组</span>}{summary.unknownSets > 0 && <span>待补全 {summary.unknownSets} 组</span>}{summary.loadedSets > 0 && <span>{movement.capacityLabel ?? '容量'} {summary.volumeLoad} kg·次</span>}{summary.estimatedMax != null && <span>估算 1RM {summary.estimatedMax} kg</span>}{summary.warmupSets > 0 && <span>热身 {summary.warmupSets} 组</span>}</div><button className="add-set-button" onClick={() => addSet(key)}><Plus size={15} />增加一组</button>
        </section>;
      })}</div>
      <section className="training-feedback"><h2>本次完成与恢复</h2><label htmlFor="session-recovery">训练前恢复</label><select id="session-recovery" value={recovery} onChange={(event) => setRecovery(event.target.value)}><option value="">尚未填写</option><option value="good">恢复良好，可以正常训练</option><option value="tired">仍有疲劳，影响本次表现</option><option value="pain">有疼痛或明显不适</option></select><label className="checkbox-line"><input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} />我已核对，以上是实际完成数据</label></section>
      <div className="sticky-action-bar"><p>{draft.reduce((sum, item) => sum + item.sets.length, 0)} 组</p><button className="button primary" onClick={finish}><Check size={17} />完成并保存训练</button></div>
    </> : <>
      <div className="history-stats"><div><span>累计训练</span><strong>{ownLogs.length} 次</strong></div><div><span>已完成工作组</span><strong>{completedSets} 组</strong></div><div><span>有记录动作</span><strong>{historyEntries.length} 个</strong></div></div>
      <section className="history-chart-card"><div className="history-chart-header"><h2>{metricNames[metric]}</h2><select value={selectedEntry} onChange={(event) => setSelectedEntry(event.target.value)} aria-label="选择动作">{historyEntries.map((key) => { const entry = ownLogs.flatMap((log) => log.exercises).find((item) => entryKey(item) === key); return <option key={key} value={key}>{entryName(entry)}</option>; })}{!historyEntries.length && <option>暂无记录</option>}</select></div><div className="segmented-tabs metric-tabs">{Object.entries(metricNames).map(([id, name]) => <button key={id} className={metric === id ? 'active' : ''} onClick={() => setMetric(id)}>{name}</button>)}</div><TrendChart points={points} unit={unit} /></section>
      <section className="history-list"><h2>最近训练</h2>{ownLogs.slice(0, 12).map((log) => <details key={log.id}><summary><div><strong>{log.dayTitle}</strong><span>{log.planName ?? '旧记录'} · {new Date(log.date).toLocaleDateString('zh-CN')} · {log.verified ? '已核对' : '未核对'}</span></div><span>{log.exercises.reduce((sum, item) => sum + item.sets.filter((set) => set.kind !== 'warmup').length, 0)} 工作组 <ChevronRight size={16} /></span></summary><div>{log.exercises.map((item) => <p key={entryKey(item)}><strong>{entryName(item)}</strong><span>{item.sets.map((set) => `${set.kind === 'warmup' ? '热身 ' : ''}${set.weight}kg×${set.reps}${movementForEntry(item)?.loadMode === 'timed' ? '秒' : '次'} · RIR ${set.rir}`).join(' / ')}</span></p>)}</div></details>)}{!ownLogs.length && <div className="empty-state"><History size={28} /><h3>还没有训练历史</h3></div>}</section>
    </>}
  </div>;
}
