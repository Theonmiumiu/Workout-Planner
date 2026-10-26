import React, { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { MUSCLES, PATTERN_NAMES, PATTERN_ORDER } from '../data/exercises.js';
import { allEquipment } from '../engine/planner.js';

const EQUIPMENT_CATEGORIES = ['固定器械', '自由重量', '凳与支架', '综合器械'];

const emptyMovementForm = () => ({
  name: '', variantName: '', pattern: 'press', mainEquipment: '', extraEquipment: '',
  primaryMuscle: 'midChest', secondaryMuscles: [],
  repsLow: 10, repsHigh: 15, rest: 90, increment: 2.5, compound: false, cue: '',
});

export default function CustomDataModal({ custom, setCustom, equipment, setEquipment, onClose, initialTab = 'equipment' }) {
  const [tab, setTab] = useState(initialTab);
  const [equipmentForm, setEquipmentForm] = useState({ name: '', category: '固定器械', description: '', addToGym: true });
  const [movementForm, setMovementForm] = useState(emptyMovementForm);
  const [error, setError] = useState('');
  const equipmentOptions = allEquipment();

  const saveEquipment = (event) => {
    event.preventDefault();
    if (!equipmentForm.name.trim()) { setError('请填写器械名称'); return; }
    const id = `custom-eq-${Date.now()}`;
    setCustom({ ...custom, equipment: [...custom.equipment, { id, name: equipmentForm.name.trim(), category: equipmentForm.category, description: equipmentForm.description.trim() || '自定义器械' }] });
    if (equipmentForm.addToGym && !equipment.includes(id)) setEquipment([...equipment, id]);
    setEquipmentForm({ name: '', category: '固定器械', description: '', addToGym: true });
    setError('');
    setTab('manage');
  };

  const updateMovement = (key, value) => setMovementForm({ ...movementForm, [key]: value });
  const toggleSecondary = (id) => updateMovement('secondaryMuscles', movementForm.secondaryMuscles.includes(id)
    ? movementForm.secondaryMuscles.filter((item) => item !== id)
    : [...movementForm.secondaryMuscles, id]);

  const saveMovement = (event) => {
    event.preventDefault();
    if (!movementForm.name.trim()) { setError('请填写动作名称'); return; }
    if (!movementForm.mainEquipment) { setError('请选择该动作需要的器械'); return; }
    const low = Number(movementForm.repsLow); const high = Number(movementForm.repsHigh);
    if (!(low > 0 && high > low)) { setError('次数上限需要大于下限'); return; }
    const rest = Number(movementForm.rest);
    const increment = Number(movementForm.increment);
    if (!(rest >= 30)) { setError('组间休息至少 30 秒'); return; }
    if (!(increment > 0)) { setError('最小加重需要大于 0'); return; }
    const stamp = Date.now();
    const requires = movementForm.extraEquipment
      ? [[movementForm.mainEquipment], [movementForm.extraEquipment]]
      : [[movementForm.mainEquipment]];
    const movement = {
      id: `custom-mv-${stamp}`,
      name: movementForm.name.trim(),
      pattern: movementForm.pattern,
      primary: { [movementForm.primaryMuscle]: 1 },
      secondary: Object.fromEntries(movementForm.secondaryMuscles.filter((id) => id !== movementForm.primaryMuscle).map((id) => [id, .3])),
      variants: [{ id: `custom-v-${stamp}`, name: movementForm.variantName.trim() || movementForm.name.trim(), requires, cue: null }],
      compound: movementForm.compound,
      repRange: [low, high],
      rest,
      rir: movementForm.compound ? 2 : 1.5,
      increment,
      difficulty: 2,
      cue: movementForm.cue.trim() || '保持可控离心，避免借力与关节冲击。',
      custom: true,
    };
    setCustom({ ...custom, movements: [...custom.movements, movement] });
    setMovementForm(emptyMovementForm());
    setError('');
    setTab('manage');
  };

  const removeEquipment = (id) => {
    setCustom({ ...custom, equipment: custom.equipment.filter((item) => item.id !== id) });
    setEquipment(equipment.filter((item) => item !== id));
  };
  const removeMovement = (id) => setCustom({ ...custom, movements: custom.movements.filter((item) => item.id !== id) });

  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal custom-modal" role="dialog" aria-modal="true" aria-label="自定义器械与动作">
      <div className="modal-header"><div><h2>自定义器械与动作</h2><p>保存在本机，与内置数据一起参与动作筛选和计划生成。</p></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button></div>
      <div className="segmented-tabs small custom-tabs">
        <button className={tab === 'equipment' ? 'active' : ''} onClick={() => { setTab('equipment'); setError(''); }}>添加器械</button>
        <button className={tab === 'movement' ? 'active' : ''} onClick={() => { setTab('movement'); setError(''); }}>添加动作</button>
        <button className={tab === 'manage' ? 'active' : ''} onClick={() => { setTab('manage'); setError(''); }}>已添加 <span>{custom.equipment.length + custom.movements.length}</span></button>
      </div>

      {tab === 'equipment' && <form className="custom-form" onSubmit={saveEquipment}>
        <div className="form-field"><label htmlFor="custom-eq-name">器械名称（必填）</label><input id="custom-eq-name" type="text" placeholder="例如：下斜推胸机" value={equipmentForm.name} onChange={(e) => setEquipmentForm({ ...equipmentForm, name: e.target.value })} /></div>
        <div className="form-grid">
          <div className="form-field"><label htmlFor="custom-eq-category">分类</label><select id="custom-eq-category" value={equipmentForm.category} onChange={(e) => setEquipmentForm({ ...equipmentForm, category: e.target.value })}>{EQUIPMENT_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
          <div className="form-field"><label htmlFor="custom-eq-desc">一句话描述（可选）</label><input id="custom-eq-desc" type="text" placeholder="例如：可调下斜角度" value={equipmentForm.description} onChange={(e) => setEquipmentForm({ ...equipmentForm, description: e.target.value })} /></div>
        </div>
        <label className="checkbox-line"><input type="checkbox" checked={equipmentForm.addToGym} onChange={(e) => setEquipmentForm({ ...equipmentForm, addToGym: e.target.checked })} />同时加入我的健身房</label>
        <p className="section-note">添加器械后，再到「添加动作」里创建使用它的动作，它才会真正可练。</p>
        {error && <p className="form-error">{error}</p>}
        <button className="button primary full-width" type="submit"><Plus size={16} />保存器械</button>
      </form>}

      {tab === 'movement' && <form className="custom-form" onSubmit={saveMovement}>
        <div className="form-grid">
          <div className="form-field"><label htmlFor="custom-mv-name">动作名称（必填）</label><input id="custom-mv-name" type="text" placeholder="例如：下斜卧推" value={movementForm.name} onChange={(e) => updateMovement('name', e.target.value)} /></div>
          <div className="form-field"><label htmlFor="custom-mv-variant">版本名称（可选，默认同动作名）</label><input id="custom-mv-variant" type="text" placeholder="例如：器械下斜推胸" value={movementForm.variantName} onChange={(e) => updateMovement('variantName', e.target.value)} /></div>
          <div className="form-field"><label htmlFor="custom-mv-pattern">动作模式（决定分化归属）</label><select id="custom-mv-pattern" value={movementForm.pattern} onChange={(e) => updateMovement('pattern', e.target.value)}>{PATTERN_ORDER.map((id) => <option key={id} value={id}>{PATTERN_NAMES[id]}</option>)}</select></div>
          <div className="form-field"><label htmlFor="custom-mv-primary">主目标肌群（系数 1）</label><select id="custom-mv-primary" value={movementForm.primaryMuscle} onChange={(e) => updateMovement('primaryMuscle', e.target.value)}>{Object.entries(MUSCLES).map(([id, muscle]) => <option key={id} value={id}>{muscle.name}</option>)}</select></div>
          <div className="form-field"><label htmlFor="custom-mv-equipment">所需器械（必选）</label><select id="custom-mv-equipment" value={movementForm.mainEquipment} onChange={(e) => updateMovement('mainEquipment', e.target.value)}><option value="">请选择</option>{equipmentOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="form-field"><label htmlFor="custom-mv-extra">附加器械（可选，如训练凳）</label><select id="custom-mv-extra" value={movementForm.extraEquipment} onChange={(e) => updateMovement('extraEquipment', e.target.value)}><option value="">不需要</option>{equipmentOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="form-field"><label htmlFor="custom-mv-rest">组间休息（秒）</label><input id="custom-mv-rest" type="number" min="30" step="15" value={movementForm.rest} onChange={(e) => updateMovement('rest', e.target.value)} /></div>
          <div className="form-field"><label htmlFor="custom-mv-increment">最小加重（kg）</label><input id="custom-mv-increment" type="number" min="0.5" step="0.5" value={movementForm.increment} onChange={(e) => updateMovement('increment', e.target.value)} /></div>
          <div className="form-field"><label htmlFor="custom-mv-low">次数下限</label><input id="custom-mv-low" type="number" min="1" step="1" value={movementForm.repsLow} onChange={(e) => updateMovement('repsLow', e.target.value)} /></div>
          <div className="form-field"><label htmlFor="custom-mv-high">次数上限</label><input id="custom-mv-high" type="number" min="2" step="1" value={movementForm.repsHigh} onChange={(e) => updateMovement('repsHigh', e.target.value)} /></div>
        </div>
        <div className="form-field"><span className="form-label">辅助肌群（可选，每个按 0.3 系数计入）</span><div className="chip-grid">{Object.entries(MUSCLES).filter(([id]) => id !== movementForm.primaryMuscle).map(([id, muscle]) => <button type="button" key={id} className={movementForm.secondaryMuscles.includes(id) ? 'active' : ''} onClick={() => toggleSecondary(id)}>{muscle.name}</button>)}</div></div>
        <label className="checkbox-line"><input type="checkbox" checked={movementForm.compound} onChange={(e) => updateMovement('compound', e.target.checked)} />复合动作（RIR 2，计划优先安排）</label>
        <div className="form-field"><label htmlFor="custom-mv-cue">动作提示（可选）</label><textarea id="custom-mv-cue" rows="2" placeholder="例如：握距略宽，下放至下胸位置" value={movementForm.cue} onChange={(e) => updateMovement('cue', e.target.value)} /></div>
        {error && <p className="form-error">{error}</p>}
        <button className="button primary full-width" type="submit"><Plus size={16} />保存动作</button>
      </form>}

      {tab === 'manage' && <div className="manage-list">
        {!custom.equipment.length && !custom.movements.length && <div className="empty-state compact">还没有自定义内容，先到前两个标签里添加。</div>}
        {custom.equipment.length > 0 && <h3 className="option-group-title">自定义器械</h3>}
        {custom.equipment.map((item) => <div className="manage-row" key={item.id}><div><strong>{item.name}</strong><small>{item.category} · {item.description}</small></div><button className="icon-button" aria-label={`删除${item.name}`} onClick={() => removeEquipment(item.id)}><Trash2 size={16} /></button></div>)}
        {custom.movements.length > 0 && <h3 className="option-group-title">自定义动作</h3>}
        {custom.movements.map((item) => <div className="manage-row" key={item.id}><div><strong>{item.name}</strong><small>{PATTERN_NAMES[item.pattern]} · 主 {Object.keys(item.primary).map((id) => MUSCLES[id].name).join('、')}</small></div><button className="icon-button" aria-label={`删除${item.name}`} onClick={() => removeMovement(item.id)}><Trash2 size={16} /></button></div>)}
        {(custom.equipment.length > 0 || custom.movements.length > 0) && <p className="section-note">删除器械后，依赖它的自定义动作会变为「缺器械」；删除动作后，已生成的计划会在下次重新生成时移除它。</p>}
      </div>}
    </div>
  </div>;
}
