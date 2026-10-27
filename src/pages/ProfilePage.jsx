import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Clock3, Dumbbell, RotateCcw } from 'lucide-react';
import { MUSCLES, MUSCLE_REGIONS, resolveMovement, LEVELS, PREFERENCES, WEEKDAYS, DEFAULT_PROFILE } from '../data/exercises.js';
import { getAvailableMovements, getAvailableVariants } from '../engine/planner.js';
import { FOCUSES, SPLITS, focusesFor, weekdaysFor, customMusclesFor, seedCustomSchedule } from '../engine/training.js';
import NumericInput from '../components/NumericInput.jsx';

const DAY_PRESETS = { 1: [6], 2: [2, 6], 3: [1, 3, 6], 4: [1, 2, 4, 6], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6], 7: [1, 2, 3, 4, 5, 6, 0] };

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
    if (!exists && profile.daysPerWeek >= 7) return;
    const weekdays = exists ? profile.weekdays.filter((day) => day !== id) : [...profile.weekdays, id];
    setProfile({ ...profile, weekdays, daysPerWeek: weekdays.length });
  };
  const resetPreferences = () => setProfile({ ...profile, preferences: { ...DEFAULT_PROFILE.preferences }, regionPreferences: {} });
  const setCustomMuscles = (weekday, muscles) => update('customSchedule', { ...profile.customSchedule, [weekday]: { muscles } });
  const changeSplit = (split) => setProfile({ ...profile, split, ...(split === 'custom' ? { customSchedule: seedCustomSchedule(profile) } : {}) });

  return <div className="page profile-page">
    <header className="page-header"><h1>训练参数</h1></header>

    <section className="form-section">
      <div className="section-content"><div className="section-title"><h2>每周安排</h2><Clock3 size={20} /></div>
        <div className="schedule-controls">
          <div className="field-block"><label>每周训练频率</label><div className="stepper-buttons">{[1, 2, 3, 4, 5, 6, 7].map((count) => <button key={count} className={profile.daysPerWeek === count ? 'active' : ''} onClick={() => setDays(count)}>{count}<small>练</small></button>)}</div></div>
          <div className="field-block duration-field"><div className="field-label-row"><label>单次训练时长</label><strong>{profile.minutes}<small> 分钟</small></strong></div><input type="range" min="30" max="120" step="15" value={profile.minutes} onChange={(e) => update('minutes', Number(e.target.value))} /><div className="range-labels"><span>30 分钟</span><span>120 分钟</span></div></div>
        </div>
        <div className="field-block"><label>可训练的星期</label><div className="weekday-picker">{WEEKDAYS.map((day) => <button key={day.id} className={profile.weekdays.includes(day.id) ? 'active' : ''} onClick={() => toggleWeekday(day.id)}><small>周</small>{day.short}</button>)}</div></div>
        <div className="field-block split-picker"><label htmlFor="training-split">训练分化</label><select id="training-split" value={profile.split ?? 'focused'} onChange={(e) => changeSplit(e.target.value)}>{SPLITS.map((split) => <option key={split.id} value={split.id}>{split.name}</option>)}</select>
          {profile.split !== 'custom' && <div className="split-sequence">{focusesFor(profile.daysPerWeek, profile.split).map((focus) => FOCUSES[focus].title.replace('训练', '')).join(' → ')}</div>}
        </div>
        {profile.split === 'custom' && <div className="custom-schedule">{weekdaysFor(profile).map((weekday) => {
          const name = WEEKDAYS.find((day) => day.id === weekday).name;
          const selected = customMusclesFor(profile, weekday);
          return <section className="custom-day" key={weekday} aria-label={`${name}训练部位`}><div className="custom-day-heading"><h3>{name}</h3><select aria-label={`${name}套用部位`} value="" onChange={(event) => { if (event.target.value) setCustomMuscles(weekday, [...FOCUSES[event.target.value].muscles]); }}><option value="">套用常用部位</option>{Object.entries(FOCUSES).map(([id, focus]) => <option key={id} value={id}>{focus.title}</option>)}</select><button className="text-button" onClick={() => setCustomMuscles(weekday, [])}>清空</button></div><div className="chip-grid">{Object.entries(MUSCLES).map(([id, muscle]) => <button key={id} type="button" aria-pressed={selected.includes(id)} className={selected.includes(id) ? 'active' : ''} onClick={() => setCustomMuscles(weekday, selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id])}>{muscle.name}</button>)}</div>{!selected.length && <div className="form-error">请选择训练部位</div>}</section>;
        })}</div>}
        <div className="rest-default-controls"><label htmlFor="default-rest-mode">默认组间休息</label><select id="default-rest-mode" value={typeof profile.restSeconds === 'number' ? 'custom' : 'variant'} onChange={(event) => update('restSeconds', event.target.value === 'custom' ? 90 : null)}><option value="variant">使用器械版本默认值</option><option value="custom">自定义秒数</option></select>{typeof profile.restSeconds === 'number' && <label><NumericInput aria-label="默认休息秒数" min="0" max="900" value={profile.restSeconds} onCommit={(rest) => update('restSeconds', rest)} /> 秒</label>}</div>
      </div>
    </section>

    <section className="form-section">
      <div className="section-content"><div className="section-title"><h2>当前水平</h2><Dumbbell size={20} /></div>
        <div className="level-cards">{Object.entries(LEVELS).map(([id, level]) => <button key={id} className={profile.level === id ? 'active' : ''} onClick={() => update('level', id)}><strong>{level.name}</strong><p>{level.description}</p></button>)}</div>
        <label className="bodyweight-field">体重（kg）<input aria-label="体重（kg）" type="number" min="20" max="300" step="0.1" value={profile.bodyWeight ?? ''} onChange={(event) => update('bodyWeight', event.target.value === '' ? '' : Number(event.target.value))} /></label>
        <button className="text-button weights-toggle" onClick={() => setShowWeights(!showWeights)}>填写各版本的当前重量（可选）<ChevronDown size={16} className={showWeights ? 'rotated' : ''} /></button>
        {showWeights && <div className="weights-panel"><div className="weight-input-grid">{available.map(({ movement, variants }) => variants.map((variant) => <label key={variant.id}><span>{variant.name} · {resolveMovement(movement, variant.id).loadLabel}</span><div><input type="number" min="0" step="0.5" value={profile.weights?.[variant.id] ?? ''} placeholder="—" onChange={(e) => update('weights', { ...profile.weights, [variant.id]: e.target.value === '' ? '' : Number(e.target.value) })} /></div></label>))}</div></div>}
      </div>
    </section>

    <section className="form-section">
      <div className="section-content"><div className="section-title"><h2>肌群训练偏好</h2><button className="icon-text-button" onClick={resetPreferences}><RotateCcw size={15} />全部标准</button></div>
        <div className="preference-legend"><span>肌群</span><div>{PREFERENCES.map((item) => <span key={item.id}>{item.name}</span>)}</div></div>
        <div className="preference-list">{Object.entries(MUSCLES).map(([id, muscle]) => <div className="preference-row" key={id}>
          <div className="muscle-name"><strong>{muscle.name}</strong></div>
          <div className="preference-options">{PREFERENCES.map((item) => <button key={item.id} className={profile.preferences[id] === item.id ? 'active' : ''} onClick={() => update('preferences', { ...profile.preferences, [id]: item.id })} aria-label={`${muscle.name}${item.name}`}><span />{item.name}</button>)}</div>
        </div>)}</div>
        <details className="region-preferences"><summary>区域形体偏好</summary><div className="region-preference-grid">{Object.entries(MUSCLE_REGIONS).filter(([id]) => !MUSCLES[id] && available.some(({ variants }) => variants.some((variant) => (variant.parameters?.regions?.[id] ?? 0) >= .75))).map(([id, region]) => <label key={id}><span>{region.name}</span><select aria-label={`${region.name}区域偏好`} value={profile.regionPreferences?.[id] ?? 'standard'} onChange={(event) => update('regionPreferences', { ...profile.regionPreferences, [id]: event.target.value })}>{PREFERENCES.map((preference) => <option key={preference.id} value={preference.id}>{preference.name}</option>)}</select></label>)}</div></details>
      </div>
    </section>

    <div className="sticky-action-bar"><p>{profile.daysPerWeek} 练 · 每次 {profile.minutes} 分钟 · {LEVELS[profile.level].name}</p><button className="button secondary" onClick={onGoPlan}>去计划页生成 <ChevronRight size={17} /></button></div>
  </div>;
}
