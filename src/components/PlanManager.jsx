import React, { useEffect, useState } from 'react';
import { ArchiveRestore, Copy, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { activeEntry, addPlan, deletePlan, isDraftChanged, renameRevision, restoreRevision, saveRevision } from '../engine/planStore.js';
import { movementById } from '../engine/planner.js';
import { groupTargets, VOLUME_GROUPS } from '../engine/training.js';

export default function PlanManager({ store, onChange, onCreate, onClose }) {
  const entry = activeEntry(store);
  const [name, setName] = useState(entry.name);
  const [versionName, setVersionName] = useState('');
  const [previewId, setPreviewId] = useState(null);
  const [editingRevision, setEditingRevision] = useState(null);
  const [revisionName, setRevisionName] = useState('');
  useEffect(() => { setName(entry.name); setPreviewId(null); setEditingRevision(null); setVersionName(''); }, [entry.id]);
  const preview = entry.revisions.find((revision) => revision.id === previewId);
  const rename = (event) => {
    event.preventDefault();
    if (name.trim()) onChange({ ...store, plans: store.plans.map((item) => item.id === entry.id ? { ...item, name: name.trim() } : item) });
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal plan-manager" role="dialog" aria-modal="true" aria-label="计划与版本管理">
      <div className="modal-header"><div><h2>计划与版本管理</h2></div><button className="icon-button" aria-label="关闭计划管理" onClick={onClose}><X size={20} /></button></div>
      <div className="manager-grid">
        <section className="program-list"><h3>我的计划</h3>
          {store.plans.filter((item) => !item.deletedAt).map((item) => <button className={`program-choice ${item.id === entry.id ? 'active' : ''}`} key={item.id} onClick={() => onChange({ ...store, activePlanId: item.id })}><strong>{item.name}</strong><small>{item.draft.days.length} 练 · {item.revisions.length} 个版本{isDraftChanged(item) ? ' · 有新编辑' : ''}</small></button>)}
          <button className="button secondary full-width" onClick={onCreate}><Plus size={15} />新建计划</button>
          <button className="button secondary full-width" onClick={() => onChange(addPlan(store, entry.draft, `${entry.name} · 副本`))}><Copy size={15} />复制当前计划</button>
          <details className="program-trash"><summary>已删除计划</summary>{store.plans.filter((item) => item.deletedAt).map((item) => <div key={item.id}><span>{item.name}</span><button onClick={() => onChange({ ...store, plans: store.plans.map((candidate) => candidate.id === item.id ? { ...candidate, deletedAt: null } : candidate) })}><ArchiveRestore size={14} />恢复</button></div>)}</details>
        </section>
        <section className="version-list">
          <form className="manager-rename" onSubmit={rename}><label htmlFor="program-name">计划名称</label><div><input id="program-name" maxLength="80" value={name} onChange={(event) => setName(event.target.value)} /><button className="button secondary" type="submit">重命名</button></div></form>

          <form className="manager-save" onSubmit={(event) => { event.preventDefault(); onChange(saveRevision(store, versionName)); setVersionName(''); }}><input aria-label="新版本备注" placeholder="版本名称或备注，例如：减少腿部组数" maxLength="100" value={versionName} onChange={(event) => setVersionName(event.target.value)} /><button className="button primary" type="submit"><Save size={15} />保存版本</button></form>
          {[...entry.revisions].reverse().map((revision) => <div className="version-item" key={revision.id}>{editingRevision === revision.id
            ? <form className="version-edit-form" onSubmit={(event) => { event.preventDefault(); if (revisionName.trim()) { onChange(renameRevision(store, revision.id, revisionName)); setEditingRevision(null); } }}><span>v{revision.number}</span><input aria-label={`v${revision.number}名称或备注`} maxLength="100" required autoFocus value={revisionName} onChange={(event) => setRevisionName(event.target.value)} /><button className="button secondary" type="submit">保存修改</button><button className="button secondary" type="button" onClick={() => setEditingRevision(null)}>取消</button></form>
            : <><div><strong>v{revision.number} · {revision.name}</strong><small>{new Date(revision.createdAt).toLocaleString()}</small></div><div className="version-row-actions"><button className="icon-button" aria-label={`修改 v${revision.number} 名称`} title="修改版本名称或备注" onClick={() => { setEditingRevision(revision.id); setRevisionName(revision.name); }}><Pencil size={15} /></button><button className="button secondary" onClick={() => setPreviewId(revision.id)}>预览</button></div></>}</div>)}
          {preview && <div className="version-preview"><h3>v{preview.number} · {preview.name}</h3><p><strong>周预算</strong><span>{Object.entries(groupTargets(preview.plan.targets)).map(([id, sets]) => `${VOLUME_GROUPS[id].name} ${Math.round(sets * 10) / 10}组`).join(' · ')}</span></p>{preview.plan.days.map((day) => <p key={day.id}><strong>{day.title}</strong><span>{day.exercises.map((item) => `${movementById(item.movementId)?.name ?? '已移除动作'} ${item.sets}组`).join('、')}</span></p>)}<button className="button primary" onClick={() => { onChange(restoreRevision(store, preview.id)); setPreviewId(null); }}><ArchiveRestore size={15} />恢复此版本</button></div>}
          <button className="danger-link delete-program" disabled={store.plans.filter((item) => !item.deletedAt).length <= 1} onClick={() => onChange(deletePlan(store, entry.id))}><Trash2 size={15} />删除当前计划</button>
        </section>
      </div>
    </div>
  </div>;
}
