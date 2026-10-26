import React, { useState } from 'react';
import { Ban, Check, ChevronRight, Plus, Search, X } from 'lucide-react';
import { ATTACHMENTS, MUSCLES, PATTERN_NAMES, PATTERN_ORDER } from '../data/exercises.js';
import { allEquipment, allMovements, getAvailableVariants, isVariantAvailable, muscleShares } from '../engine/planner.js';
import CustomDataModal from '../components/CustomDataModal.jsx';

const itemName = (id) => allEquipment().find((item) => item.id === id)?.name ?? ATTACHMENTS.find((item) => item.id === id)?.name ?? id;
const missingFor = (variant, equipment, attachments) => {
  const owned = new Set([...equipment, ...attachments]);
  return variant.requires.flatMap((alternatives) => alternatives.some((item) => owned.has(item)) ? [] : [alternatives.map(itemName).join(' 或 ')]);
};

export default function LibraryPage({ equipment, setEquipment, attachments, profile, setProfile, custom, setCustom }) {
  const [query, setQuery] = useState('');
  const [pattern, setPattern] = useState('all');
  const [active, setActive] = useState(null);
  const [showCustom, setShowCustom] = useState(false);
  const movements = allMovements();
  const filtered = movements.filter((movement) => {
    const muscleNames = Object.keys({ ...movement.primary, ...movement.secondary }).map((id) => MUSCLES[id]?.name ?? '');
    const variantText = movement.variants.flatMap((variant) => [variant.name, variant.cue ?? '', ...variant.requires.flat().map(itemName)]);
    const matchesText = [movement.name, movement.cue, ...muscleNames, ...variantText].join(' ').includes(query);
    const matchesPattern = pattern === 'all' || movement.pattern === pattern;
    return matchesText && matchesPattern;
  });
  const availableCount = movements.filter((movement) => getAvailableVariants(movement, equipment, attachments).length).length;
  const toggleExcluded = (id) => {
    const excluded = profile.excluded.includes(id) ? profile.excluded.filter((item) => item !== id) : [...profile.excluded, id];
    setProfile({ ...profile, excluded });
  };
  const activeMovement = movements.find((movement) => movement.id === active);
  const activeVariants = activeMovement ? activeMovement.variants.map((variant) => ({ variant, available: isVariantAvailable(variant, equipment, attachments), missing: missingFor(variant, equipment, attachments) })) : [];

  return <div className="page library-page">
    <header className="page-header split-header"><div><h1>动作库</h1><p className="page-summary">{movements.length} 个动作 · 当前器械可执行 {availableCount} 个</p></div><div className="header-actions"><button className="button secondary" onClick={() => setShowCustom(true)}><Plus size={16} />自定义</button></div></header>
    <div className="library-toolbar">
      <label className="search-field"><Search size={17} /><input placeholder="搜索动作" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <select value={pattern} onChange={(e) => setPattern(e.target.value)} aria-label="按动作模式筛选"><option value="all">全部模式</option>{PATTERN_ORDER.map((id) => <option key={id} value={id}>{PATTERN_NAMES[id]}</option>)}</select>
    </div>
    {PATTERN_ORDER.map((patternId) => {
      const movements = filtered.filter((movement) => movement.pattern === patternId);
      if (!movements.length) return null;
      return <section className="library-group" key={patternId}>
        <h2 className="group-title">{PATTERN_NAMES[patternId]}</h2>
        <div className="library-list">{movements.map((movement) => {
          const variants = getAvailableVariants(movement, equipment, attachments);
          const excluded = profile.excluded.includes(movement.id);
          return <div className={`library-row ${!variants.length ? 'unavailable' : ''} ${excluded ? 'excluded' : ''}`} key={movement.id}>
            <button className="library-row-main" onClick={() => setActive(movement.id)}>
              <strong>{movement.name}</strong>
              <span className="row-muscles">{Object.keys(movement.primary).map((id) => MUSCLES[id].name).join(' · ')}</span>
              <small>{excluded ? '已排除' : variants.length ? `${variants.length} 个可用版本` : '缺器械'}</small>
              <ChevronRight size={16} />
            </button>
            <button className="exclude-button" onClick={() => toggleExcluded(movement.id)}>{excluded ? <><Check size={14} />恢复</> : <><Ban size={14} />排除</>}</button>
          </div>;
        })}</div>
      </section>;
    })}
    {!filtered.length && <div className="empty-state"><h3>没有匹配的动作</h3><p>尝试清空搜索或切换筛选条件。</p></div>}
    {activeMovement && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setActive(null); }}><div className="modal exercise-detail-modal" role="dialog" aria-modal="true" aria-label={activeMovement.name}>
      <button className="icon-button modal-close" onClick={() => setActive(null)}><X size={20} /></button>
      <h2>{activeMovement.name}</h2>
      <div className="muscle-tags">{muscleShares(activeMovement).map(({ id, percent }) => <span className={activeMovement.primary[id] ? 'primary' : ''} key={id}>{activeMovement.primary[id] ? '主 · ' : '辅 · '}{MUSCLES[id].name} {percent}%</span>)}</div>
      <p className="section-note">相对强度按动作系数归一化估算，非实测。</p>
      <p className="detail-cue">{activeMovement.cue}</p>
      <div className="detail-stats"><div><span>建议次数</span><strong>{activeMovement.repRange.join('–')}</strong></div><div><span>目标 RIR</span><strong>{activeMovement.rir === 1.5 ? '1–2' : activeMovement.rir}</strong></div><div><span>组间休息</span><strong>{activeMovement.rest} 秒</strong></div><div><span>最小加重</span><strong>{activeMovement.increment} {activeMovement.id === 'plank' ? '秒' : 'kg'}</strong></div></div>
      <h3 className="option-group-title">器械版本</h3>
      <div className="option-list variant-list">{activeVariants.map(({ variant, available, missing }) => <div className={`variant-row ${available ? '' : 'missing'}`} key={variant.id}>
        <div><strong>{variant.name}</strong>{!available && missing.length > 0 && <small>缺：{missing.join('、')}</small>}{variant.cue && available && <small>{variant.cue}</small>}</div>
        <span className={`status-pill ${available ? 'ok' : ''}`}>{available ? '可执行' : '缺器械'}</span>
      </div>)}</div>
      <button className="button secondary full-width" onClick={() => toggleExcluded(activeMovement.id)}>{profile.excluded.includes(activeMovement.id) ? '恢复此动作' : '排除此动作'}</button>
    </div></div>}
    {showCustom && <CustomDataModal custom={custom} setCustom={setCustom} equipment={equipment} setEquipment={setEquipment} onClose={() => setShowCustom(false)} initialTab="movement" />}
  </div>;
}
