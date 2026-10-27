import React from 'react';
import { MUSCLES, MUSCLE_REGIONS, resolveMovement } from '../data/exercises.js';
import { muscleContributions } from '../engine/planner.js';

const labels = { primary: '主练', secondary: '辅助', stabilizer: '稳定' };
const chestMuscles = new Set(['upperChest', 'midChest', 'lowerChest']);

export default function MuscleRoles({ movement, variantId }) {
  const resolved = resolveMovement(movement, variantId ?? movement.variantId);
  const regions = Object.entries(resolved.regions ?? {}).filter(([id]) => MUSCLE_REGIONS[id]);
  const tags = [];
  const seen = new Set();
  for (const { id, role } of muscleContributions(resolved)) {
    const groupId = chestMuscles.has(id) ? 'chest' : id;
    if (seen.has(groupId)) continue;
    seen.add(groupId);
    tags.push({ id: groupId, name: groupId === 'chest' ? '胸部' : MUSCLES[id].name, role });
  }

  return <div className="muscle-roles">
    <div className="muscle-tags">{tags.map(({ id, name, role }) => <span className={role === 'primary' ? 'primary' : role === 'stabilizer' ? 'stabilizer' : ''} key={id}>{labels[role]} · {name}</span>)}</div>
    {regions.length > 0 && <div className="region-table" aria-label="细分肌群参与"><div className="region-table-head"><span>区域肌群</span><span>每组折算</span></div>{regions.map(([id, coefficient]) => <div key={id}><strong>{MUSCLE_REGIONS[id].name}</strong><span>{coefficient} 组</span></div>)}</div>}
  </div>;
}
