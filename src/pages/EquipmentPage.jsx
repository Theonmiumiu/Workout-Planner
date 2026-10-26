import React, { useMemo, useState } from 'react';
import { Check, ChevronRight, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { ATTACHMENTS } from '../data/exercises.js';
import { allEquipment, getAvailableMovements } from '../engine/planner.js';
import CustomDataModal from '../components/CustomDataModal.jsx';

function SelectionColumn({ title, items, selected, onToggle, emptyText }) {
  return <section className="selection-column">
    <div className="selection-heading">
      <h3>{title}</h3>
      <span className="count-badge">{items.length}</span>
    </div>
    <div className="selection-grid">
      {items.map((item) => <button className={`equipment-tile ${selected ? 'is-selected' : ''}`} key={item.id} onClick={() => onToggle(item.id)} aria-label={`${selected ? '移除' : '添加'}${item.name}`}>
        <span className="tile-copy"><strong>{item.name}</strong><small>{item.description}</small></span>
        <span className="tile-action">{selected ? <Check size={14} /> : <Plus size={14} />}</span>
      </button>)}
      {!items.length && <div className="empty-state compact"><span>{emptyText}</span></div>}
    </div>
  </section>;
}

export default function EquipmentPage({ equipment, setEquipment, attachments, setAttachments, onGoPlan, custom, setCustom }) {
  const [tab, setTab] = useState('equipment');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [showCustom, setShowCustom] = useState(false);
  const source = tab === 'equipment' ? allEquipment() : ATTACHMENTS;
  const selected = tab === 'equipment' ? equipment : attachments;
  const setSelected = tab === 'equipment' ? setEquipment : setAttachments;
  const categories = ['全部', ...new Set(source.map((item) => item.category))];
  const filtered = useMemo(() => source.filter((item) => !selected.includes(item.id) && (category === '全部' || item.category === category) && `${item.name}${item.description}`.includes(query)), [source, selected, category, query]);
  const chosen = source.filter((item) => selected.includes(item.id));
  const availableCount = getAvailableMovements(equipment, attachments).length;
  const toggle = (id) => setSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);

  return <div className="page equipment-page">
    <header className="page-header split-header">
      <div><h1>你的健身房</h1><p className="page-summary">点选器械与配件，动作库会立即按真实组合更新。</p></div>
      <div className="header-actions"><button className="button secondary" onClick={() => setShowCustom(true)}><Plus size={16} />自定义</button></div>
      <div className="header-stat"><strong>{availableCount}</strong><span>个动作可执行</span></div>
    </header>

    <div className="segmented-tabs" role="tablist">
      <button className={tab === 'equipment' ? 'active' : ''} onClick={() => { setTab('equipment'); setCategory('全部'); }}>训练器械 <span>{equipment.length}</span></button>
      <button className={tab === 'attachments' ? 'active' : ''} onClick={() => { setTab('attachments'); setCategory('全部'); }}>把手与配件 <span>{attachments.length}</span></button>
    </div>

    <div className="equipment-toolbar">
      <label className="search-field"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索名称或特征" /></label>
      <div className="category-filter"><SlidersHorizontal size={16} />{categories.map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>
    </div>

    <div className="selection-board">
      <SelectionColumn title="候选" items={filtered} selected={false} onToggle={toggle} emptyText="没有匹配的候选项" />
      <div className="board-direction"><ChevronRight size={20} /><span>点击移动</span></div>
      <SelectionColumn title="已选" items={chosen} selected onToggle={toggle} emptyText="从左侧点击添加" />
    </div>

    <div className="sticky-action-bar">
      <p>当前配置可执行 <strong>{availableCount}</strong> 个动作 · 修改将在下次生成计划时生效</p>
      <button className="button secondary" onClick={onGoPlan}>去计划页生成 <ChevronRight size={17} /></button>
    </div>
    {showCustom && <CustomDataModal custom={custom} setCustom={setCustom} equipment={equipment} setEquipment={setEquipment} onClose={() => setShowCustom(false)} initialTab="equipment" />}
  </div>;
}
