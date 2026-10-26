import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Clock3, Dumbbell, RotateCcw } from 'lucide-react';
import { MUSCLES, LEVELS, PREFERENCES, WEEKDAYS, DEFAULT_PROFILE } from '../data/exercises.js';
import { getAvailableMovements, getAvailableVariants } from '../engine/planner.js';
import { FOCUSES, SPLITS, focusesFor } from '../engine/training.js';

const DAY_PRESETS = { 1: [6], 2: [2, 6], 3: [1, 3, 6], 4: [1, 2, 4, 6], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6] };

export default function ProfilePage({ profile, setProfile, equipment, attachments, onGoPlan }) {
  const [showWeights, setShowWeights] = useState(false);
  const available = useMemo(() => getAvailableMovements(equipment, attachments, profile.excluded)
    .map((movement) => ({ movement, variants: getAvailableVariants(movement, equipment, attachments) }))
    .filter((entry) => entry.variants.length), [equipment, attachments, profile.excluded]);
  const update = (key, value) => setProfile({ ...profile, [key]: value });
  const setDays = (count) => setProfile({ ...profile, daysPerWeek: count, weekdays: DAY_PRESETS[count] });
  const toggleWeekday = (id) => {
    const exists = profile.weekdays.includes(id);
    if (exists && profile.daysPerWeek === 1) return;
    if (!exists && profile.daysPerWeek >= 6) return;
    const weekdays = exists ? profile.weekdays.filter((day) => day !== id) : [...profile.weekdays, id];
    setProfile({ ...profile, weekdays, daysPerWeek: weekdays.length });
  };
  const resetPreferences = () => update('preferences', { ...DEFAULT_PROFILE.preferences });

  return <div className="page profile-page">
    <header className="page-header"><h1>训练参数</h1><p className="page-summary">这些信息会直接改变训练量、动作分配和恢复间隔。</p></header>

    <section className="form-section">
      <div className="section-content"><div className="section-title"><h2>每周安排</h2><Clock3 size={20} /></div>
        <div className="schedule-controls">
          <div className="field-block"><label>每周训练频率</label><div className="stepper-buttons">{[1, 2, 3, 4, 5, 6].map((count) => <button key={count} className={profile.daysPerWeek === count ? 'active' : ''} onClick={() => setDays(count)}>{count}<small>练</small></button>)}</div></div>
          <div className="field-block duration-field"><div className="field-label-row"><label>单次训练时长</label><strong>{profile.minutes}<small> 分钟</small></strong></div><input type="range" min="30" max="120" step="15" value={profile.minutes} onChange={(e) => update('minutes', Number(e.target.value))} /><div className="range-labels"><span>30 分钟</span><span>120 分钟</span></div></div>
        </div>
        <div className="field-block"><label>可训练的星期</label><div className="weekday-picker">{WEEKDAYS.map((day) => <button key={day.id} className={profile.weekdays.includes(day.id) ? 'active' : ''} onClick={() => toggleWeekday(day.id)}><small>周</small>{day.short}</button>)}</div></div>
        <div className="field-block split-picker"><label htmlFor="training-split">训练分化</label><select id="training-split" value={profile.split ?? 'focused'} onChange={(e) => update('split', e.target.value)}>{SPLITS.map((split) => <option key={split.id} value={split.id}>{split.name}</option>)}</select>
          <p className="section-note">{SPLITS.find((split) => split.id === (profile.split ?? 'focused'))?.description}</p>
          <p className="section-note">部位安排：{focusesFor(profile.daysPerWeek, profile.split).map((focus) => FOCUSES[focus].title.replace('训练', '')).join(' → ')}。生成时会结合星期调整顺序。部位分化在每周 1 练时使用全身，2 练时使用上下肢。</p>
        </div>
      </div>
    </section>

    <section className="form-section">
      <div className="section-content"><div className="section-title"><h2>当前水平</h2><Dumbbell size={20} /></div>
        <div className="level-cards">{Object.entries(LEVELS).map(([id, level]) => <button key={id} className={profile.level === id ? 'active' : ''} onClick={() => update('level', id)}><strong>{level.name}</strong><p>{level.description}</p></button>)}</div>
        <button className="text-button weights-toggle" onClick={() => setShowWeights(!showWeights)}>填写各版本的当前重量（可选）<ChevronDown size={16} className={showWeights ? 'rotated' : ''} /></button>
        {showWeights && <div className="weights-panel"><p>留空表示首次尝试；填写的是你能在目标次数范围内、保留 1–3 次余力完成的重量。按动作与器械版本记录，生成计划时会优先选用你填过的版本。哑铃按单只重量记录。</p><div className="weight-input-grid">{available.map(({ movement, variants }) => variants.map((variant) => <label key={variant.id}><span>{movement.name} · {variant.name}</span><div><input type="number" min="0" step="0.5" value={profile.weights?.[variant.id] ?? ''} placeholder="—" onChange={(e) => update('weights', { ...profile.weights, [variant.id]: e.target.value === '' ? 0 : Number(e.target.value) })} /><small>{movement.id === 'plank' ? '秒' : 'kg'}</small></div></label>))}</div></div>}
      </div>
    </section>

    <section className="form-section">
      <div className="section-content"><div className="section-title"><h2>肌群训练偏好</h2><button className="icon-text-button" onClick={resetPreferences}><RotateCcw size={15} />全部标准</button></div>
        <div className="preference-legend"><span>肌群</span><div>{PREFERENCES.map((item) => <span key={item.id}>{item.name}</span>)}</div></div>
        <div className="preference-list">{Object.entries(MUSCLES).map(([id, muscle]) => <div className="preference-row" key={id}>
          <div className="muscle-name"><strong>{muscle.name}</strong><small>{muscle.group === 'upper' ? '上肢部位' : muscle.group === 'lower' ? '下肢部位' : '核心部位'}</small></div>
          <div className="preference-options">{PREFERENCES.map((item) => <button key={item.id} className={profile.preferences[id] === item.id ? 'active' : ''} onClick={() => update('preferences', { ...profile.preferences, [id]: item.id })} aria-label={`${muscle.name}${item.name}`}><span />{item.name}</button>)}</div>
        </div>)}</div>
      </div>
    </section>

    <div className="sticky-action-bar"><p>{profile.daysPerWeek} 练 · 每次 {profile.minutes} 分钟 · {LEVELS[profile.level].name} · 修改将在下次生成计划时生效</p><button className="button secondary" onClick={onGoPlan}>去计划页生成 <ChevronRight size={17} /></button></div>
  </div>;
}
