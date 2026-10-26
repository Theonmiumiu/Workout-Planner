import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, BarChart3, Check, ChevronDown, ChevronRight, Lock, LockOpen, Plus, RefreshCw, Repeat2, Search, Trash2, X } from 'lucide-react';
import { MUSCLES, WEEKDAYS } from '../data/exercises.js';
import { analyzePlan, estimateDay, getAvailableMovements, getAvailableVariants, getPlanWarnings, movementById, muscleShares, pickVariant } from '../engine/planner.js';
import { ALGORITHM_VERSION, FOCUSES, VOLUME_GROUPS, isMovementAllowedForFocus } from '../engine/training.js';

function MuscleTags({ movement }) {
  return <div className="muscle-tags">{muscleShares(movement).map(({ id, percent }) => <span className={movement.primary[id] ? 'primary' : ''} key={id}>{MUSCLES[id].name} {percent}%</span>)}</div>;
}

export default function PlanPage({ plan, setPlan, equipment, attachments, profile, onGenerate, onStartLog }) {
  const [activeDay, setActiveDay] = useState(plan.days[0]?.id);
  const [expanded, setExpanded] = useState(null);
  const [picker, setPicker] = useState(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [showVolume, setShowVolume] = useState(false);
  const day = plan.days.find((item) => item.id === activeDay) ?? plan.days[0];
  const availableMovements = getAvailableMovements(equipment, attachments, profile.excluded);
  const totalSets = plan.days.reduce((sum, item) => sum + item.exercises.reduce((s, ex) => s + ex.sets, 0), 0);
  const analysis = analyzePlan(plan.days, plan.targets);
  const averageCoverage = Math.round(Object.values(analysis.groupCoverage).reduce((sum, item) => sum + Math.min(item.percent, 100), 0) / Object.keys(VOLUME_GROUPS).length);
  const warnings = [...new Set([...(plan.generationWarnings ?? []), ...getPlanWarnings(plan.days, plan.targets, plan.profile, equipment, attachments)])];
  const pickerOptions = useMemo(() => {
    if (!picker) return { variants: [], movements: [] };
    const original = picker.item ? movementById(picker.item.movementId) : null;
    const variants = original ? getAvailableVariants(original, equipment, attachments).filter((variant) => variant.id !== picker.item.variantId) : [];
    const movements = availableMovements
      .filter((item) => item.id !== original?.id && isMovementAllowedForFocus(item, day?.focus))
      .map((item) => ({ movement: item, alreadyInDay: day.exercises.some((entry) => entry.movementId === item.id) }))
      .filter(({ movement }) => !pickerQuery || `${movement.name}${movement.cue}`.includes(pickerQuery));
    return { variants, movements };
  }, [picker, pickerQuery, availableMovements, equipment, attachments, day]);
  if (!day) return null;

  const updateDay = (updater) => {
    const days = plan.days.map((item) => item.id === day.id ? updater(item) : item);
    setPlan({ ...plan, days, analysis: analyzePlan(days, plan.targets) });
  };
  const updateExercise = (id, patch) => updateDay((current) => ({ ...current, exercises: current.exercises.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  const move = (index, direction) => updateDay((current) => {
    const exercises = [...current.exercises];
    const target = index + direction;
    if (target < 0 || target >= exercises.length) return current;
    [exercises[index], exercises[target]] = [exercises[target], exercises[index]];
    return { ...current, exercises };
  });
  const remove = (id) => updateDay((current) => ({ ...current, exercises: current.exercises.filter((item) => item.id !== id) }));
  const openPicker = (next) => { setPicker(next); setPickerQuery(''); };
  const closePicker = () => setPicker(null);
  const replaceVariant = (variantId) => { updateExercise(picker.item.id, { variantId, locked: false }); closePicker(); };
  const replaceMovement = (movement) => {
    const variant = pickVariant(movement, equipment, attachments, profile.weights);
    updateExercise(picker.item.id, { movementId: movement.id, variantId: variant?.id, weight: profile.weights?.[variant?.id] ?? 0, locked: false });
    closePicker();
  };
  const addMovement = (movement) => {
    const variant = pickVariant(movement, equipment, attachments, profile.weights);
    updateDay((current) => ({ ...current, exercises: [...current.exercises, {
      id: `${current.id}-${movement.id}`,
      movementId: movement.id,
      variantId: variant?.id ?? movement.variants[0].id,
      sets: movement.compound ? 3 : 2,
      weight: profile.weights?.[variant?.id] ?? 0,
      locked: false,
    }] }));
    closePicker();
  };

  return <div className="page plan-page">
    <header className="page-header split-header">
      <div><h1>本周训练计划</h1><p className="page-summary">{plan.days.length} 练 · {totalSets} 组 · 估算预算覆盖 {averageCoverage}% · RIR 1–3</p></div>
      <div className="header-actions">
        <button className="button secondary" onClick={() => setShowVolume(true)}><BarChart3 size={16} />训练量</button>
        <button className="button secondary" onClick={onGenerate}><RefreshCw size={16} />重新生成</button>
        <button className="button primary" onClick={() => onStartLog(day.id)}>开始训练 <ChevronRight size={17} /></button>
      </div>
    </header>

    <div className="day-tabs">{plan.days.map((item, index) => {
      const weekday = WEEKDAYS.find((w) => w.id === item.weekday);
      return <button key={item.id} className={item.id === day.id ? 'active' : ''} onClick={() => setActiveDay(item.id)}><span>DAY {String(index + 1).padStart(2, '0')}</span><strong>{weekday.name} · {item.title}</strong><small>{item.exercises.length} 个动作 · 约 {estimateDay(item)} 分钟</small></button>;
    })}</div>

    {plan.algorithmVersion !== ALGORITHM_VERSION && <div className="method-note legacy-plan-note"><h3>当前是旧规则生成的计划</h3><p>点击「重新生成」应用新的部位分化。原计划和训练记录会保留到你重新生成；与新分化冲突的锁定动作会说明原因。</p></div>}
    <div className="focus-summary"><strong>今日重点：{FOCUSES[day.focus]?.title.replace('训练', '') ?? day.title}</strong><p>只安排这些部位的主导目标动作；复合动作仍会有辅助肌群参与。保留余力，训练量需结合实际表现调整。</p></div>
    {warnings.length > 0 && <details className="plan-notice"><summary><span>{warnings.length} 条安排与训练量提示</span><ChevronRight size={16} /></summary><ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}

    <main className="workout-sheet">
      <div className="sheet-heading"><h2>{day.exercises.length} 个动作 · {day.exercises.reduce((sum, item) => sum + item.sets, 0)} 个工作组</h2><span>预计 {estimateDay(day)} / {plan.profile.minutes} 分钟</span></div>
      <div className="exercise-list">{day.exercises.map((item, index) => {
        const movement = movementById(item.movementId);
        if (!movement) return null;
        const variants = getAvailableVariants(movement, equipment, attachments);
        const currentVariant = movement.variants.find((variant) => variant.id === item.variantId);
        const repRange = item.repRange ?? movement.repRange;
        const open = expanded === item.id;
        return <article className={`plan-exercise ${open ? 'open' : ''}`} key={item.id}>
          <div className="exercise-row">
            <span className="exercise-index">{String(index + 1).padStart(2, '0')}</span>
            <div className="exercise-name">
              <strong>{movement.name}</strong>
              {variants.length > 1
                ? <select className="variant-select" value={item.variantId} onChange={(e) => updateExercise(item.id, { variantId: e.target.value })} aria-label={`${movement.name}的器械版本`}>
                    {currentVariant && !variants.some((variant) => variant.id === currentVariant.id) && <option value={currentVariant.id}>{currentVariant.name}（缺器械）</option>}
                    {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name}</option>)}
                  </select>
                : <small className="variant-name">{currentVariant?.name}</small>}
            </div>
            <label className="sets-stepper"><span>组</span><div className="mini-stepper"><button onClick={() => updateExercise(item.id, { sets: Math.max(1, item.sets - 1) })}>−</button><strong>{item.sets}</strong><button onClick={() => updateExercise(item.id, { sets: Math.min(6, item.sets + 1) })}>＋</button></div></label>
            <label className="weight-field"><span>kg</span><input type="number" min="0" step="0.5" value={item.weight || ''} placeholder="—" onChange={(e) => updateExercise(item.id, { weight: Number(e.target.value) })} /></label>
            <button className={`icon-button ${item.locked ? 'locked' : ''}`} title={item.locked ? '解锁动作' : '锁定动作，重新生成时保留'} onClick={() => updateExercise(item.id, { locked: !item.locked })}>{item.locked ? <Lock size={16} /> : <LockOpen size={16} />}</button>
            <button className="icon-button" title="展开详情" onClick={() => setExpanded(open ? null : item.id)}><ChevronDown size={17} className={open ? 'rotated' : ''} /></button>
          </div>
          {open && <div className="exercise-detail">
            <p className="exercise-cue">{currentVariant?.cue ?? movement.cue}</p>
            <span className="detail-label">肌群相对强度（按动作系数归一化估算）</span>
            <MuscleTags movement={movement} />
            <div className="prescription-line"><label className="rep-range-field"><span>目标</span><input aria-label={`${movement.name}目标下限`} type="number" min="1" max={repRange[1] - 1} step="1" value={repRange[0]} onChange={(e) => { const low = Math.max(1, Math.min(repRange[1] - 1, Number(e.target.value) || 1)); updateExercise(item.id, { repRange: [low, repRange[1]] }); }} /><span>–</span><input aria-label={`${movement.name}目标上限`} type="number" min={repRange[0] + 1} step="1" value={repRange[1]} onChange={(e) => { const high = Math.max(repRange[0] + 1, Number(e.target.value) || repRange[0] + 1); updateExercise(item.id, { repRange: [repRange[0], high] }); }} /><span>{movement.id === 'plank' ? '秒' : '次'}</span></label><span>RIR {movement.rir === 1.5 ? '1–2' : movement.rir}</span><span>休息 {movement.rest} 秒</span></div>
            <div className="exercise-tools"><button onClick={() => move(index, -1)} disabled={index === 0}><ArrowUp size={14} />上移</button><button onClick={() => move(index, 1)} disabled={index === day.exercises.length - 1}><ArrowDown size={14} />下移</button><button onClick={() => openPicker({ mode: 'replace', item })}><Repeat2 size={14} />替换</button><button className="danger-link" onClick={() => remove(item.id)}><Trash2 size={14} />移除</button></div>
          </div>}
        </article>;
      })}</div>
      {!day.exercises.length && <div className="empty-state"><h3>这一天还没有动作</h3><p>点击下方添加动作，或重新生成计划。</p></div>}
      <div className="sheet-footer"><button className="button secondary" onClick={() => openPicker({ mode: 'add' })}><Plus size={16} />添加动作</button></div>
    </main>

    {showVolume && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowVolume(false); }}><div className="modal volume-modal" role="dialog" aria-modal="true" aria-label="估算训练量">
      <div className="modal-header"><div><h2>估算训练量</h2><p>胸部、背部分别合并计量；同一组对同一肌群最多计 1 组。动作系数是估算，100% 只表示达到起始预算，不能证明刺激充分或预测增肌。</p></div><button className="icon-button" onClick={() => setShowVolume(false)}><X size={20} /></button></div>
      <div className="volume-list">{Object.entries(analysis.groupCoverage).map(([id, data]) => <div className="volume-row" key={id}>
        <div><span>{VOLUME_GROUPS[id].name}</span><small>折算 {data.sets} / {data.target} 组</small><small>主导 {data.directSets} 组 · {data.frequency} 天</small></div>
        <div className="volume-track"><span style={{ width: `${Math.min(data.percent, 100)}%` }} className={data.percent < 60 ? 'low' : data.percent >= 90 ? 'good' : ''} /></div>
        <strong>{data.percent}%</strong>
      </div>)}</div>
      <div className="method-note"><span>做组逻辑</span><h3>稳定重量，先加次数，再加重量</h3><p>大多数组保留 1–3 次余力。所有组达到次数上限后，下次小幅加重；次数暂时下降是正常过程。</p></div>
    </div></div>}

    {picker && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closePicker(); }}><div className="modal replacement-modal" role="dialog" aria-modal="true" aria-label={picker.mode === 'add' ? '添加动作' : '替换动作'}>
      <div className="modal-header"><div><h2>{picker.mode === 'add' ? `添加动作到${day.title}` : `替换 ${movementById(picker.item.movementId)?.name}`}</h2><p>列出当前器械可执行、符合今日分化的全部动作；已安排的动作不可重复选择。</p></div><button className="icon-button" onClick={closePicker}><X size={20} /></button></div>
      <label className="search-field picker-search"><Search size={16} /><input placeholder="搜索动作名称或提示" value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} /></label>
      {pickerOptions.variants.length > 0 && <h3 className="option-group-title">同动作的其他版本</h3>}
      <div className="option-list">{pickerOptions.variants.map((variant) => <button key={variant.id} onClick={() => replaceVariant(variant.id)}><strong>{variant.name}</strong><span className="replace-check"><Check size={15} />选择</span></button>)}</div>
      {pickerOptions.variants.length > 0 && <h3 className="option-group-title">其他动作</h3>}
      <div className="option-list picker-list">{pickerOptions.movements.map(({ movement, alreadyInDay }) => <button key={movement.id} disabled={alreadyInDay} onClick={() => picker.mode === 'add' ? addMovement(movement) : replaceMovement(movement)}><div><strong>{movement.name}</strong><small>{Object.keys(movement.primary).map((id) => MUSCLES[id].name).join(' · ')}</small></div><span className="replace-check">{alreadyInDay ? '已安排' : <><Check size={15} />选择</>}</span></button>)}</div>
      {!pickerOptions.variants.length && !pickerOptions.movements.length && <div className="empty-state compact">没有匹配的动作，换个关键词或检查器械配置。</div>}
    </div></div>}
  </div>;
}
