import React, { useState } from 'react';
import { Save, X } from 'lucide-react';

export default function SaveVersionDialog({ number, onSave, onClose }) {
  const [name, setName] = useState('手动保存');
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal version-name-dialog" role="dialog" aria-modal="true" aria-label="保存计划版本" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
      <div className="modal-header"><h2>保存计划版本</h2><button className="icon-button" aria-label="取消保存版本" onClick={onClose}><X size={20} /></button></div>
      <form className="version-name-form" onSubmit={(event) => { event.preventDefault(); onSave(name); }}>
        <label htmlFor="revision-name">版本名称／备注</label>
        <div className="version-name-field"><span>v{number}</span><input id="revision-name" maxLength="100" value={name} placeholder="例如：腿部休息调整" autoFocus onFocus={(event) => event.target.select()} onChange={(event) => setName(event.target.value)} /></div>
        <div className="version-name-actions"><button className="button secondary" type="button" onClick={onClose}>取消</button><button className="button primary" type="submit"><Save size={15} />确认保存</button></div>
      </form>
    </div>
  </div>;
}
