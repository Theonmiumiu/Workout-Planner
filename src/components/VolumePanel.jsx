import React, { useMemo, useState } from 'react';
import { ListFilter, X } from 'lucide-react';
import { analyzePlan, analyzeRecords, movementById, getVolumeSources } from '../engine/planner.js';
import { MUSCLE_REGIONS, WEEKDAYS } from '../data/exercises.js';
import { VOLUME_GROUPS } from '../engine/training.js';
import { reviewVolume, weekKey } from '../engine/volumeReview.js';
import { buildLoadHistory, round } from '../engine/workload.js';

export default function VolumePanel({ plan, logs, planId, onApplyBudget, onClose }) {
  const [tab, setTab] = useState('budget');
  const [editing, setEditing] = useState(null);
  const [value, setValue] = useState('');
  const [sourceGroup, setSourceGroup] = useState(null);
  const records = logs.filter((log) => log.planId === planId);
  const weeks = [...new Set(records.map((log) => weekKey(log.date)).filter(Boolean))].sort().reverse();
  const [selectedWeek, setSelectedWeek] = useState(weeks[0] ?? weekKey(new Date()));
  const history = useMemo(() => buildLoadHistory(logs, movementById, { planId }), [logs, planId]);
  const analysis = analyzePlan(plan.days, plan.targets, { ...plan.profile, loadHistory: history });
  const actual = analyzeRecords(records.filter((log) => weekKey(log.date) === selectedWeek), plan.targets);
  const reviews = useMemo(() => reviewVolume(plan, logs, planId), [plan, logs, planId]);
  const [regionSource, setRegionSource] = useState('plan');
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal volume-modal" role="dialog" aria-modal="true" aria-label="估算训练量">
    <div className="modal-header"><h2>每周训练量</h2><button className="icon-button" aria-label="关闭训练量" onClick={onClose}><X size={20} /></button></div>
    <div className="segmented-tabs volume-tabs"><button className={tab === 'budget' ? 'active' : ''} onClick={() => setTab('budget')}>周目标</button><button className={tab === 'actual' ? 'active' : ''} onClick={() => setTab('actual')}>实际完成</button><button className={tab === 'regions' ? 'active' : ''} onClick={() => setTab('regions')}>区域分布</button><button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>训练记录建议</button></div>
    {(tab === 'actual' || (tab === 'regions' && regionSource === 'actual')) && <label className="week-picker">训练周<select aria-label="选择训练周" value={selectedWeek} onChange={(event) => setSelectedWeek(event.target.value)}>{weeks.length ? weeks.map((week) => <option key={week} value={week}>{week} 起</option>) : <option value={selectedWeek}>暂无记录</option>}</select></label>}
    {tab === 'budget' && <div className="volume-list">{Object.entries(analysis.groupCoverage).map(([id, data]) => <div className="volume-budget-item" key={id}><div className="volume-row">
      <div><div className="volume-muscle-heading"><span>{VOLUME_GROUPS[id].name}</span><button className="volume-source-toggle" aria-label={`查看${VOLUME_GROUPS[id].name}动作来源`} title="查看动作来源" aria-expanded={sourceGroup === id} aria-controls={`volume-source-${id}`} onClick={() => setSourceGroup(sourceGroup === id ? null : id)}><ListFilter size={15} /></button></div><span className="metric-line">计划 {data.sets} / 目标 {data.target} 组</span><span className="metric-line">预计匹配 {data.qualifiedSets} 组 · {data.frequency} 天</span></div>
      <div className="volume-track"><span style={{ width: `${Math.min(data.percent, 100)}%` }} className={data.percent > 150 ? 'over' : data.percent < 60 ? 'low' : 'good'} /></div><strong>{data.percent}%</strong>
    </div><div className="budget-source"><button onClick={() => { setEditing(editing === id ? null : id); setValue(String(data.target)); }}>调整预算</button></div>
      {sourceGroup === id && <div id={`volume-source-${id}`} className="volume-sources" aria-label={`${VOLUME_GROUPS[id].name}动作来源`}>{getVolumeSources(plan.days, id).map((source, index) => <div className="volume-source-item" key={`${source.dayId}-${source.exerciseId ?? index}`}><div><strong>{source.name}</strong><span>{WEEKDAYS.find((day) => day.id === source.weekday)?.name} · {source.variantName || source.dayTitle}</span></div><div><span className="source-role">{source.role}</span><span>{source.sets} × {source.coefficient} = <strong>{Number(source.contribution.toFixed(2))} 组</strong></span></div></div>)}{!getVolumeSources(plan.days, id).length && <div className="empty-state compact">本周没有计入该肌群训练量的动作</div>}<div className="volume-source-total">合计 {round(getVolumeSources(plan.days, id).reduce((sum, source) => sum + source.contribution, 0))} 组</div></div>}
      {editing === id && <form className="budget-editor" onSubmit={(event) => { event.preventDefault(); const next = Number(value); if (value && next >= 2 && next <= 30) { onApplyBudget(id, next); setEditing(null); } }}><input aria-label={`${VOLUME_GROUPS[id].name}周预算`} type="number" min="2" max="30" step="0.1" required value={value} onChange={(event) => setValue(event.target.value)} /><span>组／周</span><button className="button secondary" type="submit">保存预算</button></form>}
    </div>)}</div>}
    {tab === 'actual' && <div className="volume-list">{Object.entries(actual.groups).map(([id, data]) => <div className="volume-budget-item" key={id}><div className="volume-row"><div><span>{VOLUME_GROUPS[id].name}</span><span className="metric-line">完成 {data.sets} / 目标 {data.target} 组</span><span className="metric-line">次数达成 {data.targetSets} · 负荷匹配 {data.matchedSets} 组</span></div><div className="volume-track"><span style={{ width: `${Math.min(data.percent, 100)}%` }} /></div><strong>{data.percent}%</strong></div></div>)}</div>}
    {tab === 'regions' && <><div className="segmented-tabs"><button className={regionSource === 'plan' ? 'active' : ''} onClick={() => setRegionSource('plan')}>计划分布</button><button className={regionSource === 'actual' ? 'active' : ''} onClick={() => setRegionSource('actual')}>实际完成</button></div><div className="regional-volume-list">{[...new Set(Object.values(MUSCLE_REGIONS).map((region) => region.area))].map((area) => <section key={area}><h3>{area}</h3>{Object.entries(MUSCLE_REGIONS).filter(([, region]) => region.area === area).map(([id, region]) => <div className="regional-volume-row" key={id}><span>{region.name}</span><strong>{round(regionSource === 'plan' ? analysis.regionCoverage[id]?.sets ?? 0 : actual.regions[id]?.sets ?? 0)} 组</strong></div>)}</section>)}</div></>}
    {tab === 'review' && <div className="volume-reviews">{reviews.map((review) => <article className="volume-review" key={review.id}><h3>{review.name}</h3><div className="metric-line">{review.weeks} 周 · {review.records} 次记录</div><p>{review.reason}</p>{review.weekly.length > 0 && <div className="metric-line">匹配组数：{review.weekly.map((week) => `${week.week.slice(5)} 周 ${week.sets}组`).join(' · ')}</div>}{review.next != null && <button className="button primary" onClick={() => onApplyBudget(review.id, review.next, review)}>应用建议：{review.current} → {review.next} 组／周</button>}</article>)}</div>}
  </div></div>;
}
