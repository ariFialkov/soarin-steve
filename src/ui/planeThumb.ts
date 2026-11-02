/** SVG top-view thumbnails for the hangar cards. */
import type { PlaneDef } from '../data/planes';
import { SILHOUETTES } from '../game/silhouettes';

let uid = 0;

export function planeThumbSvg(p: PlaneDef, size = 120): string {
  const def = SILHOUETTES[p.silhouette];
  const S = size;
  const scale = S * 0.86;
  const cx = S / 2, cy = S / 2;
  const toPt = ([x, z]: [number, number]) => `${(cx + x * scale).toFixed(1)},${(cy + z * scale).toFixed(1)}`;
  const mirror = ([x, z]: [number, number]): [number, number] => [-x, z];
  const right = def.outline;
  const left = [...def.outline].reverse().map(mirror);
  const path = [...right, ...left].map(toPt).join(' ');
  const id = `pt${uid++}`;
  const A = p.accent;
  let pattern = '';
  let fillRef = p.paper;
  if (p.pattern === 'stripe') {
    pattern = `<pattern id="${id}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(90)"><rect width="10" height="10" fill="${p.paper}"/><rect width="3" height="10" fill="${A}" opacity="0.75"/></pattern>`;
    fillRef = `url(#${id})`;
  } else if (p.pattern === 'dots') {
    pattern = `<pattern id="${id}" width="9" height="9" patternUnits="userSpaceOnUse"><rect width="9" height="9" fill="${p.paper}"/><circle cx="4.5" cy="4.5" r="1.8" fill="${A}" opacity="0.8"/></pattern>`;
    fillRef = `url(#${id})`;
  } else if (p.pattern === 'chevron') {
    pattern = `<pattern id="${id}" width="12" height="8" patternUnits="userSpaceOnUse"><rect width="12" height="8" fill="${p.paper}"/><path d="M0 6 L6 1 L12 6" fill="none" stroke="${A}" stroke-width="1.6" opacity="0.8"/></pattern>`;
    fillRef = `url(#${id})`;
  }
  let canard = '';
  if (def.canard) {
    const cr = def.canard;
    const cl = [...cr].reverse().map(mirror);
    canard = `<polygon points="${[...cr, ...cl].map(toPt).join(' ')}" fill="${fillRef}" stroke="#5b544c" stroke-width="1.2" stroke-linejoin="round"/>`;
  }
  const edge = p.pattern === 'edge'
    ? `<polygon points="${path}" fill="none" stroke="${A}" stroke-width="4" stroke-linejoin="round" opacity="0.9"/>`
    : '';
  const nose = toPt([0, def.outline[0][1]]);
  const tail = toPt([0, def.outline[def.outline.length - 1][1]]);
  const ws = def.outline.find(pt => pt[1] >= def.wingStart) ?? def.outline[1];
  const tipR = def.outline.reduce((a, b) => (b[0] > a[0] ? b : a));
  const crease = `<line x1="${nose.split(',')[0]}" y1="${nose.split(',')[1]}" x2="${tail.split(',')[0]}" y2="${tail.split(',')[1]}" stroke="#6b645b" stroke-width="1.4"/>
    <line x1="${toPt(ws).split(',')[0]}" y1="${toPt(ws).split(',')[1]}" x2="${toPt(tipR).split(',')[0]}" y2="${toPt(tipR).split(',')[1]}" stroke="#8c857c" stroke-width="0.9" stroke-dasharray="3 2"/>
    <line x1="${toPt(ws).split(',')[0]}" y1="${toPt(ws).split(',')[1]}" x2="${toPt(mirror(tipR)).split(',')[0]}" y2="${toPt(mirror(tipR)).split(',')[1]}" stroke="#8c857c" stroke-width="0.9" stroke-dasharray="3 2"/>`;
  return `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>${pattern}<filter id="${id}s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#4a3f30" flood-opacity="0.25"/></filter></defs>
    <g filter="url(#${id}s)" transform="rotate(-18 ${cx} ${cy})">
      <polygon points="${path}" fill="${fillRef}" stroke="#5b544c" stroke-width="1.4" stroke-linejoin="round"/>
      ${edge}${canard}${crease}
    </g></svg>`;
}
