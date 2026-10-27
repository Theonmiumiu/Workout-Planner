import React, { useEffect, useState } from 'react';

export default function NumericInput({ value, onCommit, onPreview, min, max, step = 1, allowEmpty = false, ...props }) {
  const [draft, setDraft] = useState(String(value ?? ''));
  useEffect(() => { setDraft(String(value ?? '')); }, [value]);

  const commit = (event) => {
    const raw = event.currentTarget.value;
    let next = raw.trim() === '' ? (allowEmpty ? '' : value) : Number(raw);
    if (next !== '' && Number.isFinite(Number(next))) {
      next = Number(next);
      if (Number(step) === 1) next = Math.round(next);
      if (min != null) next = Math.max(Number(min), next);
      if (max != null) next = Math.min(Number(max), next);
    } else if (next !== '') next = value;
    setDraft(String(next ?? ''));
    onPreview?.(null);
    if (next !== value) onCommit(next);
  };

  return <input {...props} type="number" min={min} max={max} step={step} value={draft}
    onChange={(event) => { setDraft(event.target.value); onPreview?.(event.target.value); }} onBlur={commit}
    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} />;
}
