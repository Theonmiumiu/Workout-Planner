import React, { useMemo, useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import { buildDocs, docsText } from '../data/docs.js';

function DocBlock({ block }) {
  if (block.type === 'paragraph') return <p>{block.text}</p>;
  if (block.type === 'formula') return <pre className="docs-formula">{block.text}</pre>;
  if (block.type === 'list') return <ol>{block.items.map((item) => <li key={item}>{item}</li>)}</ol>;
  if (block.type === 'links') return <ul className="docs-references">{block.items.map((item) => <li key={item.url}><a href={item.url} target="_blank" rel="noreferrer">{item.label}</a></li>)}</ul>;
  if (block.type === 'table') return <div className="docs-table-wrap"><table><thead><tr>{block.columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{block.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody></table></div>;
  return null;
}

export default function DocsPage({ profile, plan }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState('overview');
  const sections = useMemo(() => buildDocs(profile, plan), [profile, plan]);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = sections.filter((section) => terms.every((term) => docsText(section).toLowerCase().includes(term)));
  const selected = filtered.find((section) => section.id === active) ?? filtered[0];
  return <div className="page docs-page">
    <header className="page-header"><h1>Docs</h1><p>使用说明、指标作用与算法细节</p></header>
    <label className="search-field docs-search"><Search size={18} /><input aria-label="搜索 Docs" placeholder="搜索指标、偏好、公式或操作" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <div className="docs-layout"><nav className="docs-toc" aria-label="Docs 目录">{filtered.map((section) => <button key={section.id} className={selected?.id === section.id ? 'active' : ''} aria-current={selected?.id === section.id ? 'page' : undefined} onClick={() => setActive(section.id)}>{section.title}</button>)}</nav>
      {selected ? <article className="docs-article" key={selected.id}><header><BookOpen size={21} /><h2>{selected.title}</h2></header><p className="docs-summary">{selected.summary}</p>{selected.blocks.map((block, index) => <DocBlock key={index} block={block} />)}</article> : <div className="empty-state"><h2>没有匹配的文档</h2><button className="button secondary" onClick={() => setQuery('')}>清空搜索</button></div>}
    </div>
  </div>;
}
