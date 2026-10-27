import React, { useState } from 'react';
import { Ban, Check, ChevronRight, Plus, Search, Trash2, X } from 'lucide-react';
import { ATTACHMENTS, MUSCLES, MUSCLE_REGIONS, resolveMovement, PATTERN_NAMES, PATTERN_ORDER } from '../data/exercises.js';
import { allEquipment, allMovements, getAvailableVariants, isVariantAvailable, muscleContributions } from '../engine/planner.js';
import CustomDataModal from '../components/CustomDataModal.jsx';
import MuscleRoles from '../components/MuscleRoles.jsx';

const itemName = (id) => allEquipment().find((item) => item.id === id)?.name ?? ATTACHMENTS.find((item) => item.id === id)?.name ?? id;
const missingFor = (variant, equipment, attachments) => {
  const owned = new Set([...equipment, ...attachments]);
  return variant.requires.flatMap((alternatives) => alternatives.some((item) => owned.has(item)) ? [] : [alternatives.map(itemName).join(' 或 ')]);
};

export default function LibraryPage({ equipment, setEquipment, attachments, profile, setProfile, custom, setCustom, onDeleteMovement }) {
  const [query, setQuery] = useState('');
  const [pattern, setPattern] = useState('all');
  const [active, setActive] = useState(null);
  const [variantId, setVariantId] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const movements = allMovements();
  const filtered = movements.filter((movement) => {
    const muscleNames = muscleContributions(movement).map(({ id }) => MUSCLES[id]?.name ?? '');
    const variantText = movement.variants.flatMap((variant) => [variant.name, variant.parameters?.setup ?? '', ...Object.keys(variant.parameters?.regions ?? {}).map((id) => MUSCLE_REGIONS[id]?.name ?? ''), ...variant.requires.flat().map(itemName)]);
    const matchesText = [movement.name, movement.cue, movement.anatomyNote ?? '', ...muscleNames, ...variantText].join(' ').includes(query);
    const matchesPattern = pattern === 'all' || movement.pattern === pattern;
    return matchesText && matchesPattern;
  });
  const availableCount = movements.filter((movement) => getAvailableVariants(movement, equipment, attachments).length).length;
  const toggleExcluded = (id) => {
    const excluded = profile.excluded.includes(id) ? profile.excluded.filter((item) => item !== id) : [...profile.excluded, id];
    setProfile({ ...profile, excluded });
  };
  const activeMovement = movements.find((movement) => movement.id === active);
  const selectedVariant = activeMovement?.variants.find((variant) => variant.id === variantId) ?? activeMovement?.variants[0];
  const resolved = activeMovement ? resolveMovement(activeMovement, selectedVariant?.id) : null;
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
            <button className="library-row-main" onClick={() => { setActive(movement.id); setVariantId(movement.variants[0].id); }}>
              <strong>{movement.name}</strong>
              <span className="row-muscles">{Object.keys(movement.primary).map((id) => MUSCLES[id].name).join(' · ')}</span>
              <small>{excluded ? '已排除' : variants.length ? `${variants.length} 个可用版本` : '缺器械'}</small>
              <ChevronRight size={16} />
            </button>
            <button className="exclude-button" onClick={() => toggleExcluded(movement.id)}>{excluded ? <><Check size={14} />恢复</> : <><Ban size={14} />排除</>}</button>
            {movement.custom && <button className="icon-button delete-movement" aria-label={`删除动作${movement.name}`} title="从动作库删除，已有计划和记录保留" onClick={() => onDeleteMovement(movement.id)}><Trash2 size={16} /></button>}
          </div>;
        })}</div>
      </section>;
    })}
    {!filtered.length && <div className="empty-state"><h3>没有匹配的动作</h3><p>尝试清空搜索或切换筛选条件。</p></div>}
    {activeMovement && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setActive(null); }}><div className="modal exercise-detail-modal" role="dialog" aria-modal="true" aria-label={activeMovement.name}>
      <button className="icon-button modal-close" onClick={() => setActive(null)}><X size={20} /></button>
      <h2>{activeMovement.name}</h2>
      <label className="variant-parameter-picker">器械版本<select aria-label="查看器械参数" value={selectedVariant?.id} onChange={(event) => setVariantId(event.target.value)}>{activeMovement.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name}</option>)}</select></label>
      <div className="variant-specs"><span>{resolved.setup}</span><span>{resolved.resistance}</span>{resolved.lengthBias && <span>{resolved.lengthBias}</span>}<span>{resolved.loadLabel}</span></div>
      <MuscleRoles movement={activeMovement} variantId={selectedVariant?.id} />
      <div className="detail-stats"><div><span>建议次数</span><strong>{resolved.repRange.join('–')}</strong></div><div><span>目标 RIR</span><strong>{resolved.rir === 1.5 ? '1–2' : resolved.rir}</strong></div><div><span>组间休息</span><strong>{resolved.rest} 秒</strong></div><div><span>最小加重</span><strong>{resolved.increment} {resolved.id === 'plank' ? '秒' : 'kg'}</strong></div></div>
      <h3 className="option-group-title">器械版本</h3>
      <div className="option-list variant-list">{activeVariants.map(({ variant, available, missing }) => <div className={`variant-row ${available ? '' : 'missing'}`} key={variant.id}>
        <div><button className="text-button" onClick={() => setVariantId(variant.id)}>{variant.name}</button>{!available && missing.length > 0 && <span>缺：{missing.join('、')}</span>}</div>
        <span className={`status-pill ${available ? 'ok' : ''}`}>{available ? '可执行' : '缺器械'}</span>
      </div>)}</div>
      <button className="button secondary full-width" onClick={() => toggleExcluded(activeMovement.id)}>{profile.excluded.includes(activeMovement.id) ? '恢复此动作' : '排除此动作'}</button>
      {activeMovement.custom && <button className="button secondary full-width danger-link" onClick={() => { onDeleteMovement(activeMovement.id); setActive(null); }}><Trash2 size={15} />删除此自定义动作</button>}
    </div></div>}
    {showCustom && <CustomDataModal custom={custom} setCustom={setCustom} equipment={equipment} setEquipment={setEquipment} onDeleteMovement={onDeleteMovement} onClose={() => setShowCustom(false)} initialTab="movement" />}
  </div>;
}
