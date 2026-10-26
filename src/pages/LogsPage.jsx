import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, ClipboardCheck, History, Plus, Trash2, TrendingUp } from 'lucide-react';
import { WEEKDAYS } from '../data/exercises.js';
import { analyzePlan, createInitialLogs, getProgressionAdvice, movementById } from '../engine/planner.js';

const entryName = (entry) => {
  const movement = movementById(entry.movementId);
  const variant = entry.variantId ? movement?.variants.find((item) => item.id === entry.variantId) : null;
  return variant && variant.name !== movement?.name ? `${movement?.name ?? ''} · ${variant.name}` : (movement?.name ?? '未知动作');
};

function TrendChart({ points }) {
  if (!points.length) return <div className="empty-state compact"><TrendingUp size={26} /><p>完成一次训练后，这里会显示重量趋势。</p></div>;
  const width = 660; const height = 220; const pad = 32;
  const values = points.map((point) => point.weight);
  const max = Math.max(...values, 1); const min = Math.min(...values, 0);
  const range = max - min || 1;
  const coords = points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? width / 2 : pad + index * (width - pad * 2) / (points.length - 1),
    y: height - pad - (point.weight - min) / range * (height - pad * 2),
  }));
  const path = coords.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  return <div className="trend-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="历次训练最佳工作组重量趋势">
    {[0, 1, 2, 3].map((line) => <line key={line} x1={pad} x2={width - pad} y1={pad + line * (height - pad * 2) / 3} y2={pad + line * (height - pad * 2) / 3} stroke="#e5e8e2" strokeDasharray="4 5" />)}
    {coords.length > 1 && <path d={path} fill="none" stroke="#617c38" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
    {coords.map((point, index) => <g key={`${point.date}-${index}`}><circle cx={point.x} cy={point.y} r="5" fill="#c8ed72" stroke="#41552d" strokeWidth="2"><title>{point.label}：{point.weight} kg</title></circle><text x={point.x} y={point.y - 13} textAnchor="middle" fontSize="11" fill="#465248">{point.weight}kg</text><text x={point.x} y={height - 7} textAnchor="middle" fontSize="10" fill="#8a928b">{point.label}</text></g>)}
  </svg></div>;
}

export default function LogsPage({ plan, setPlan, logs, setLogs, initialDayId, notify }) {
  const [mode, setMode] = useState('log');
  const [dayId, setDayId] = useState(initialDayId ?? plan.days[0]?.id);
  const [draft, setDraft] = useState([]);
  const [selectedEntry, setSelectedEntry] = useState('');
  const day = plan.days.find((item) => item.id === dayId) ?? plan.days[0];
  const initialLogs = useMemo(() => createInitialLogs(plan), [plan]);

  useEffect(() => { if (initialDayId) setDayId(initialDayId); }, [initialDayId]);
  useEffect(() => {
    setDraft(structuredClone(initialLogs.find((item) => item.dayId === day?.id)?.exercises ?? []));
  }, [day?.id, initialLogs]);

  const historyEntries = useMemo(() => [...new Set(logs.flatMap((log) => log.exercises.map((item) => `${item.movementId}|${item.variantId ?? ''}`)))], [logs]);
  useEffect(() => { if (!selectedEntry && historyEntries.length) setSelectedEntry(historyEntries[0]); }, [historyEntries, selectedEntry]);
  const [selectedMovementId, selectedVariantId] = selectedEntry.split('|');
  const points = logs.filter((log) => log.exercises.some((item) => item.movementId === selectedMovementId && (item.variantId ?? '') === selectedVariantId)).slice(-12).map((log) => {
    const sets = log.exercises.find((item) => item.movementId === selectedMovementId && (item.variantId ?? '') === selectedVariantId)?.sets ?? [];
    const date = new Date(log.date);
    return { date: log.date, weight: Math.max(0, ...sets.map((set) => Number(set.weight) || 0)), label: `${date.getMonth() + 1}/${date.getDate()}` };
  });
  const totalVolume = Math.round(logs.flatMap((log) => log.exercises).flatMap((exercise) => exercise.sets).reduce((sum, set) => sum + (Number(set.weight) || 0) * (Number(set.reps) || 0), 0));

  const updateSet = (key, index, field, value) => setDraft(draft.map((item) => item.movementId + '|' + (item.variantId ?? '') === key ? { ...item, sets: item.sets.map((set, i) => i === index ? { ...set, [field]: Number(value) } : set) } : item));
  const entryKey = (entry) => entry.movementId + '|' + (entry.variantId ?? '');
  const addSet = (key) => setDraft(draft.map((item) => {
    if (entryKey(item) !== key) return item;
    const movement = movementById(item.movementId);
    const previous = item.sets[item.sets.length - 1] ?? { weight: 0, reps: movement?.repRange[0] ?? 10, rir: 2 };
    return { ...item, sets: [...item.sets, { ...previous }] };
  }));
  const removeSet = (key, index) => setDraft(draft.map((item) => entryKey(item) !== key ? item : { ...item, sets: item.sets.filter((_, i) => i !== index) }));
  const fillPlan = () => setDraft(structuredClone(initialLogs.find((item) => item.dayId === day.id)?.exercises ?? []));
  const finish = () => {
    if (!draft.length || !draft.some((item) => item.sets.length)) { notify('请至少保留一组训练记录'); return; }
    const record = { id: `log-${Date.now()}`, date: new Date().toISOString(), dayId: day.id, dayTitle: day.title, exercises: structuredClone(draft) };
    setLogs([record, ...logs]);
    const days = plan.days.map((item) => item.id === day.id ? { ...item, exercises: item.exercises.map((planned) => {
      const actual = draft.find((entry) => entry.movementId === planned.movementId && entry.variantId === planned.variantId);
      const lastSet = actual?.sets?.[actual.sets.length - 1];
      return lastSet ? { ...planned, weight: Number(lastSet.weight) || 0, sets: actual.sets.length } : planned;
    }) } : item);
    setPlan({ ...plan, days, analysis: analyzePlan(days, plan.targets) });
    notify('训练已保存，重量趋势与下次建议已更新');
    setMode('history');
  };

  return <div className="page logs-page">
    <header className="page-header split-header"><div><h1>训练记录</h1><p className="page-summary">记录实际完成，而不是为了填满表格牺牲动作质量。</p></div><div className="segmented-tabs small"><button className={mode === 'log' ? 'active' : ''} onClick={() => setMode('log')}><ClipboardCheck size={16} />本次训练</button><button className={mode === 'history' ? 'active' : ''} onClick={() => setMode('history')}><History size={16} />历史趋势</button></div></header>

    {mode === 'log' ? <>
      <div className="log-day-bar"><div>{plan.days.map((item, index) => <button key={item.id} className={item.id === day.id ? 'active' : ''} onClick={() => setDayId(item.id)}><span>DAY {index + 1}</span><strong>{WEEKDAYS.find((w) => w.id === item.weekday).name} · {item.title}</strong></button>)}</div><button className="button secondary" onClick={fillPlan}>按计划填入</button></div>
      <div className="log-exercises">{draft.map((item, exerciseIndex) => {
        const key = entryKey(item);
        const movement = movementById(item.movementId);
        if (!movement) return null;
        const repRange = item.repRange ?? movement.repRange;
        const advice = getProgressionAdvice(movement, item.sets, repRange);
        return <section className="log-card" key={key}>
          <div className="log-card-header"><div className="exercise-index">{String(exerciseIndex + 1).padStart(2, '0')}</div><div><h2>{entryName(item)}</h2><p>目标 {repRange[0]}–{repRange[1]} {movement.id === 'plank' ? '秒' : '次'} · 组间 {movement.rest} 秒</p></div><span className={`advice-badge ${advice.type}`}>{advice.text}</span></div>
          <div className="set-table"><div className="set-row set-head"><span>组别</span><span>重量（kg）</span><span>{movement.id === 'plank' ? '时间（秒）' : '实际次数'}</span><span>RIR</span><span /></div>
            {item.sets.map((set, index) => <div className="set-row" key={index}><span className="set-number">{index + 1}</span><input aria-label={`${entryName(item)}第${index + 1}组重量`} type="number" min="0" step="0.5" value={set.weight} onFocus={(e) => e.target.select()} onChange={(e) => updateSet(key, index, 'weight', e.target.value)} /><input aria-label={`${entryName(item)}第${index + 1}组次数`} type="number" min="0" step="1" value={set.reps} onFocus={(e) => e.target.select()} onChange={(e) => updateSet(key, index, 'reps', e.target.value)} /><input aria-label={`${entryName(item)}第${index + 1}组RIR`} type="number" min="0" max="6" step="0.5" value={set.rir} onFocus={(e) => e.target.select()} onChange={(e) => updateSet(key, index, 'rir', e.target.value)} /><button className="icon-button" onClick={() => removeSet(key, index)} aria-label="删除这一组"><Trash2 size={15} /></button></div>)}
          </div><button className="add-set-button" onClick={() => addSet(key)}><Plus size={15} />增加一组</button>
        </section>;
      })}</div>
      <div className="sticky-action-bar"><p>{draft.reduce((sum, item) => sum + item.sets.length, 0)} 组已填入 · 保存后自动更新当前重量</p><button className="button primary" onClick={finish}><Check size={17} />完成并保存训练</button></div>
    </> : <>
      <div className="history-stats"><div><span>累计训练</span><strong>{logs.length}<small> 次</small></strong></div><div><span>累计训练容量</span><strong>{totalVolume.toLocaleString()}<small> kg</small></strong></div><div><span>有记录动作</span><strong>{historyEntries.length}<small> 个</small></strong></div></div>
      <section className="history-chart-card"><div className="history-chart-header"><div><h2>最佳工作组重量</h2><p>只比较同一动作同一版本；不同动作的重量和容量不可直接比较。</p></div><select value={selectedEntry} onChange={(e) => setSelectedEntry(e.target.value)} aria-label="选择动作">{historyEntries.map((key) => { const [movementId, variantId] = key.split('|'); const movement = movementById(movementId); const variant = movement?.variants.find((item) => item.id === variantId); const label = variant && variant.name !== movement?.name ? `${movement?.name} · ${variant.name}` : movement?.name; return <option key={key} value={key}>{label}</option>; })}{!historyEntries.length && <option>暂无记录</option>}</select></div><TrendChart points={points} /></section>
      <section className="history-list"><h2>最近训练</h2>{logs.slice(0, 12).map((log) => <details key={log.id}><summary><div><strong>{log.dayTitle}</strong><span>{new Date(log.date).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</span></div><span>{log.exercises.reduce((sum, item) => sum + item.sets.length, 0)} 组 <ChevronRight size={16} /></span></summary><div>{log.exercises.map((item) => <p key={entryKey(item)}><strong>{entryName(item)}</strong><span>{item.sets.map((set) => `${set.weight}kg×${set.reps}`).join(' · ')}</span></p>)}</div></details>)}{!logs.length && <div className="empty-state"><History size={28} /><h3>还没有训练历史</h3><p>完成并保存一次训练后，记录会出现在这里。</p></div>}</section>
    </>}
  </div>;
}
