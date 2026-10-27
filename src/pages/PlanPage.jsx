import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, GripVertical, Save, BarChart3, Check, ChevronDown, ChevronRight, Plus, RefreshCw, Repeat2, Search, Trash2, X } from 'lucide-react';
import { MUSCLES, WEEKDAYS, resolveMovement } from '../data/exercises.js';
import { analyzePlan, estimateDay, getAvailableMovements, getAvailableVariants, getPlanWarnings, movementById, movementForEntry, pickVariant } from '../engine/planner.js';
import { buildLoadHistory, loadPrescription } from '../engine/workload.js';
import { focusDefinition, isMovementAllowedForFocus, resolveRest, restForReplacement } from '../engine/training.js';

import VolumePanel from '../components/VolumePanel.jsx';
import MuscleRoles from '../components/MuscleRoles.jsx';
import NumericInput from '../components/NumericInput.jsx';
import { newId, reorderExercises } from '../engine/planStore.js';

export default function PlanPage({ plan, setPlan, equipment, attachments, profile, onGenerate, onStartLog, planName, versionNumber, versionName, draftChanged, onManage, onSaveVersion, logs, planId, onApplyBudget }) {
  const [activeDay, setActiveDay] = useState(plan.days[0]?.id);
  const [expanded, setExpanded] = useState(null);
  const [picker, setPicker] = useState(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [showVolume, setShowVolume] = useState(false);
  const [drag, setDrag] = useState(null);
  const [dragAnnouncement, setDragAnnouncement] = useState('');
  const [restPreviews, setRestPreviews] = useState({});
  const dragRef = useRef(null);
  const listRef = useRef(null);
  const loadHistory = useMemo(() => buildLoadHistory(logs, movementById, { planId }), [logs, planId]);
  const context = { ...plan.profile, bodyWeight: profile.bodyWeight ?? plan.profile.bodyWeight, loadHistory };
  useEffect(() => { dragRef.current = null; setDrag(null); setRestPreviews({}); }, [activeDay]);
  const previewDays = useMemo(() => plan.days.map((day) => ({ ...day, exercises: day.exercises.map((item) => (
    restPreviews[item.id] == null ? item : { ...item, rest: restPreviews[item.id] }
  )) })), [plan.days, restPreviews]);
  const estimatedMinutes = new Map(previewDays.map((day) => [day.id, estimateDay(day)]));
  const day = plan.days.find((item) => item.id === activeDay) ?? plan.days[0];
  const availableMovements = getAvailableMovements(equipment, attachments, profile.excluded);
  const totalSets = plan.days.reduce((sum, item) => sum + item.exercises.reduce((s, ex) => s + ex.sets, 0), 0);
  const warnings = [...new Set([...(plan.generationWarnings ?? []).filter((warning) => !/超过 .*分钟/.test(warning)), ...getPlanWarnings(previewDays, plan.targets, plan.profile, equipment, attachments)])].filter((warning) => /超过 .*分钟|缺少可用动作|分化范围之外|未保留|删除/.test(warning)).map((warning) => warning.split('；')[0]);
  const pickerOptions = useMemo(() => {
    if (!picker) return { variants: [], movements: [] };
    const original = picker.item ? movementById(picker.item.movementId) : null;
    const variants = original ? getAvailableVariants(original, equipment, attachments).filter((variant) => variant.id !== picker.item.variantId) : [];
    const movements = availableMovements
      .filter((item) => item.id !== original?.id && isMovementAllowedForFocus(item, day))
      .map((item) => ({ movement: item, alreadyInDay: day.exercises.some((entry) => entry.movementId === item.id) }))
      .filter(({ movement }) => !pickerQuery || `${movement.name}${movement.cue}`.includes(pickerQuery));
    return { variants, movements };
  }, [picker, pickerQuery, availableMovements, equipment, attachments, day]);
  if (!day) return null;

  const updateDay = (updater) => {
    const days = plan.days.map((item) => item.id === day.id ? updater(item) : item);
    setPlan({ ...plan, days, analysis: analyzePlan(days, plan.targets, context) });
  };
  const updateExercise = (id, patch) => updateDay((current) => ({ ...current, exercises: current.exercises.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  const previewRest = (id, raw) => {
    const value = raw == null || raw.trim() === '' ? null : Number(raw);
    setRestPreviews((current) => {
      const next = { ...current };
      if (Number.isInteger(value) && value >= 0 && value <= 900) next[id] = value;
      else delete next[id];
      return next;
    });
  };
  const cancelDrag = () => { dragRef.current = null; setDrag(null); };
  const startDrag = (event, item) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { sourceId: item.id, targetId: item.id, startY: event.clientY, active: false };
  };
  const moveDrag = (event) => {
    const current = dragRef.current;
    if (!current || current.keyboard) return;
    if (!current.active && Math.abs(event.clientY - current.startY) < 6) return;
    current.active = true;
    const element = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-exercise-id]');
    if (element && listRef.current?.contains(element)) current.targetId = element.dataset.exerciseId;
    setDrag({ ...current });
    if (event.clientY < 90) window.scrollBy(0, -18);
    if (event.clientY > window.innerHeight - 100) window.scrollBy(0, 18);
  };
  const finishDrag = () => {
    const current = dragRef.current;
    if (current?.active) {
      updateDay((value) => ({ ...value, exercises: reorderExercises(value.exercises, current.sourceId, current.targetId) }));
      setDragAnnouncement('动作顺序已保存');
    }
    cancelDrag();
  };
  const keyboardDrag = (event, item) => {
    if (event.key === 'Escape') { cancelDrag(); return; }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (dragRef.current?.keyboard) { finishDrag(); return; }
      dragRef.current = { sourceId: item.id, targetId: item.id, active: true, keyboard: true };
      setDrag({ ...dragRef.current });
      setDragAnnouncement(`已选中${movementById(item.movementId).name}，用方向键选择位置，回车保存，Escape 取消`);
    } else if (dragRef.current?.keyboard && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const index = day.exercises.findIndex((entry) => entry.id === dragRef.current.targetId);
      const target = day.exercises[index + (event.key === 'ArrowDown' ? 1 : -1)];
      if (target) { dragRef.current.targetId = target.id; setDrag({ ...dragRef.current }); setDragAnnouncement(`目标位置 ${day.exercises.indexOf(target) + 1}`); }
    }
  };
  const remove = (id) => updateDay((current) => ({ ...current, exercises: current.exercises.filter((item) => item.id !== id) }));
  const openPicker = (next) => { setPicker(next); setPickerQuery(''); };
  const closePicker = () => setPicker(null);
  const switchVariant = (item, variantId) => {
    const movement = resolveMovement(movementById(item.movementId), variantId);
    const next = { ...item, variantId, ...restForReplacement(item, profile, movement.rest), repRange: [...movement.repRange], rir: movement.rir, weight: profile.weights?.[variantId] ?? 0 };
    const prescription = loadPrescription(movement, next, loadHistory, context.bodyWeight);
    if (!(next.weight > 0) && prescription.suggestedWeight != null) next.weight = prescription.suggestedWeight;
    updateExercise(item.id, next);
  };
  const replaceVariant = (variantId) => { switchVariant(picker.item, variantId); closePicker(); };
  const replaceMovement = (movement) => {
    const variant = pickVariant(movement, equipment, attachments, profile.weights);
    const resolved = resolveMovement(movement, variant?.id);
    updateExercise(picker.item.id, { movementId: movement.id, movementSnapshot: structuredClone(movement), variantId: variant?.id, ...restForReplacement(picker.item, profile, resolved.rest), repRange: resolved.repRange, rir: resolved.rir, weight: profile.weights?.[variant?.id] ?? 0, locked: false });
    closePicker();
  };
  const addMovement = (movement) => {
    const variant = pickVariant(movement, equipment, attachments, profile.weights);
    updateDay((current) => ({ ...current, exercises: [...current.exercises, {
      id: newId('exercise'),
      movementId: movement.id,
      variantId: variant?.id ?? movement.variants[0].id,
      repRange: resolveMovement(movement, variant?.id).repRange,
      rest: resolveRest(profile.restSeconds, resolveMovement(movement, variant?.id).rest),
      restSource: resolveRest(profile.restSeconds, null) == null ? 'variant' : 'profile',
      sets: movement.compound ? 3 : 2,
      weight: profile.weights?.[variant?.id] ?? 0,
      locked: false,
    }] }));
    closePicker();
  };

  return <div className="page plan-page">
    <div className="active-program-bar"><div><strong>{planName}</strong><small>v{versionNumber} · {versionName}{draftChanged ? ' · 草稿已自动保存' : ' · 已保存版本'}</small></div><div><button className="button secondary" onClick={onSaveVersion}><Save size={15} />保存版本</button><button className="button secondary" onClick={onManage}><FolderOpen size={15} />计划管理</button></div></div>
    <header className="page-header split-header">
      <div><h1>本周训练计划</h1><p className="page-summary">{plan.days.length} 练 · {totalSets} 组 · RIR 1–3</p></div>
      <div className="header-actions">
        <button className="button secondary" onClick={() => setShowVolume(true)}><BarChart3 size={16} />训练量</button>
        <button className="button secondary" onClick={onGenerate}><RefreshCw size={16} />重新生成</button>
        <button className="button primary" onClick={() => onStartLog(day.id)}>开始训练 <ChevronRight size={17} /></button>
      </div>
    </header>

    <div className="day-tabs">{plan.days.map((item, index) => {
      const weekday = WEEKDAYS.find((w) => w.id === item.weekday);
      return <button key={item.id} className={item.id === day.id ? 'active' : ''} onClick={() => setActiveDay(item.id)}><span>DAY {String(index + 1).padStart(2, '0')}</span><strong>{weekday.name} · {item.title}</strong><small>{item.exercises.length} 个动作 · 约 {estimatedMinutes.get(item.id)} 分钟</small></button>;
    })}</div>

    <div className="focus-summary"><strong>今日重点：{focusDefinition(day)?.title.replace('训练', '') ?? day.title}</strong></div>
    {warnings.length > 0 && <details className="plan-notice"><summary><span>{warnings.length} 条安排与训练量提示</span><ChevronRight size={16} /></summary><ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}

    <main className="workout-sheet">
      <div className="sheet-heading"><h2>{day.exercises.length} 个动作 · {day.exercises.reduce((sum, item) => sum + item.sets, 0)} 个工作组</h2><span>预计 {estimatedMinutes.get(day.id)} / {plan.profile.minutes} 分钟</span></div>
      <div className="sr-only" role="status" aria-live="polite">{dragAnnouncement}</div>
      <div className="exercise-list" ref={listRef}>{day.exercises.map((item, index) => {
        const movement = movementForEntry(item);
        if (!movement) return null;
        const variants = getAvailableVariants(movement, equipment, attachments);
        const currentVariant = movement.variants.find((variant) => variant.id === item.variantId);
        const repRange = item.repRange ?? movement.repRange;
        const prescription = loadPrescription(movement, item, loadHistory, context.bodyWeight);
        const open = expanded === item.id;
        return <article data-exercise-id={item.id} className={`plan-exercise ${open ? 'open' : ''} ${drag?.sourceId === item.id ? 'dragging' : ''} ${drag?.targetId === item.id && drag.sourceId !== item.id ? 'drop-target' : ''}`} key={item.id}>
          <div className="exercise-row-scroll"><div className="exercise-row">
            <button className="drag-handle" aria-label={`拖拽排序${movement.name}`} aria-pressed={drag?.sourceId === item.id} title="拖拽排序；也可按空格选中、方向键选择位置、回车保存" onPointerDown={(event) => startDrag(event, item)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={cancelDrag} onLostPointerCapture={() => { if (dragRef.current && !dragRef.current.keyboard) cancelDrag(); }} onKeyDown={(event) => keyboardDrag(event, item)}><GripVertical size={18} /></button>
            <span className="exercise-index">{String(index + 1).padStart(2, '0')}</span>
            <div className="exercise-name">
              <strong>{movement.name}{movement.deletedAt && <small>（已移出动作库）</small>}</strong>
              {variants.length > 1
                ? <select className="variant-select" value={item.variantId} onChange={(e) => switchVariant(item, e.target.value)} aria-label={`${movement.name}的器械版本`}>
                    {currentVariant && !variants.some((variant) => variant.id === currentVariant.id) && <option value={currentVariant.id}>{currentVariant.name}（缺器械）</option>}
                    {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name}</option>)}
                  </select>
                : <small className="variant-name">{currentVariant?.name}</small>}
            </div>
            <div className="sets-stepper"><div className="mini-stepper"><button aria-label={`${movement.name}减少组数`} onClick={() => updateExercise(item.id, { sets: Math.max(1, item.sets - 1) })}>−</button><strong>{item.sets}</strong><button aria-label={`${movement.name}增加组数`} onClick={() => updateExercise(item.id, { sets: Math.min(6, item.sets + 1) })}>＋</button></div><span>组</span></div>
            <label className="weight-field"><NumericInput aria-label={`${movement.name}计划重量`} min="0" step="0.5" value={item.weight ?? ''} allowEmpty placeholder="—" onCommit={(weight) => updateExercise(item.id, { weight })} /><span>{movement.loadMode === 'assisted' ? '辅助 kg' : 'kg'}</span></label>
            <label className="rep-range-field"><NumericInput aria-label={`${movement.name}目标下限`} min="1" max={repRange[1] - 1} value={repRange[0]} onCommit={(low) => updateExercise(item.id, { repRange: [low, repRange[1]] })} /><span>–</span><NumericInput aria-label={`${movement.name}目标上限`} min={repRange[0] + 1} value={repRange[1]} onCommit={(high) => updateExercise(item.id, { repRange: [repRange[0], high] })} /><span>{movement.id === 'plank' ? '秒' : '次'}</span></label>
            <label className="exercise-rest-field"><span>休息</span><NumericInput aria-label={`${movement.name}组间休息`} min="0" max="900" value={movement.rest} onPreview={(raw) => previewRest(item.id, raw)} onCommit={(rest) => updateExercise(item.id, { rest, restSource: 'custom' })} /><span>秒</span></label>
            <div className="exercise-row-actions">
              <button className="icon-button" aria-label="替换动作" title="替换动作" onClick={() => openPicker({ mode: 'replace', item })}><Repeat2 size={16} /></button>
              <button className="icon-button" aria-label="删除动作" title="删除动作" onClick={() => remove(item.id)}><Trash2 size={16} /></button>
              <button className="icon-button" aria-label="展开详情" title="展开详情" aria-expanded={open} onClick={() => setExpanded(open ? null : item.id)}><ChevronDown size={17} className={open ? 'rotated' : ''} /></button>
            </div>
          </div></div>
          {open && <div className="exercise-detail">
            <div className="variant-specs"><span>{movement.setup}</span><span>{movement.resistance}</span><span>{movement.loadLabel}</span><span>RIR {movement.rir === 1.5 ? '1–2' : movement.rir}</span><span>{prescription.status}</span>{prescription.suggestedWeight != null && prescription.status !== '重量匹配' && <button className="button secondary" onClick={() => updateExercise(item.id, { weight: prescription.suggestedWeight })}>采用建议 {prescription.suggestedWeight} kg</button>}</div>
            <span className="detail-label">肌群参与</span>
            <MuscleRoles movement={movement} />
          </div>}
        </article>;
      })}</div>
      {!day.exercises.length && <div className="empty-state"><h3>这一天还没有动作</h3><p>点击下方添加动作，或重新生成计划。</p></div>}
      <div className="sheet-footer"><button className="button secondary" onClick={() => openPicker({ mode: 'add' })}><Plus size={16} />添加动作</button></div>
    </main>

    {showVolume && <VolumePanel plan={plan} logs={logs} planId={planId} onApplyBudget={onApplyBudget} onClose={() => setShowVolume(false)} />}

    {picker && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closePicker(); }}><div className="modal replacement-modal" role="dialog" aria-modal="true" aria-label={picker.mode === 'add' ? '添加动作' : '替换动作'}>
      <div className="modal-header"><div><h2>{picker.mode === 'add' ? `添加动作到${day.title}` : `替换 ${movementById(picker.item.movementId)?.name}`}</h2></div><button className="icon-button" onClick={closePicker}><X size={20} /></button></div>
      <label className="search-field picker-search"><Search size={16} /><input placeholder="搜索动作名称或提示" value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} /></label>
      {pickerOptions.variants.length > 0 && <h3 className="option-group-title">同动作的其他版本</h3>}
      <div className="option-list">{pickerOptions.variants.map((variant) => <button key={variant.id} onClick={() => replaceVariant(variant.id)}><strong>{variant.name}</strong><span className="replace-check"><Check size={15} />选择</span></button>)}</div>
      {pickerOptions.variants.length > 0 && <h3 className="option-group-title">其他动作</h3>}
      <div className="option-list picker-list">{pickerOptions.movements.map(({ movement, alreadyInDay }) => <button key={movement.id} disabled={alreadyInDay} onClick={() => picker.mode === 'add' ? addMovement(movement) : replaceMovement(movement)}><div><strong>{movement.name}</strong><small>{Object.keys(movement.primary).map((id) => MUSCLES[id].name).join(' · ')}</small></div><span className="replace-check">{alreadyInDay ? '已安排' : <><Check size={15} />选择</>}</span></button>)}</div>
      {!pickerOptions.variants.length && !pickerOptions.movements.length && <div className="empty-state compact">没有匹配的动作，换个关键词或检查器械配置。</div>}
    </div></div>}
  </div>;
}
