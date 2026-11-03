/** SVG front-view thumbnails of Steve in a suit, for the wardrobe cards. */
import type { SuitDef } from '../data/suits';

let uid = 0;

export function suitThumbSvg(s: SuitDef, size = 120): string {
  const id = `st${uid++}`;
  const S = size;
  const emblem = (() => {
    const cx = 60, cy = 56;
    switch (s.emblem) {
      case 'star': return `<polygon points="${[...Array(10)].map((_, i) => { const r = i % 2 ? 3.2 : 7.5; const a = i * Math.PI / 5 - Math.PI / 2; return `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`; }).join(' ')}" fill="${s.accent}"/>`;
      case 'bolt': return `<polygon points="58,48 64,48 60,55 64,55 56,65 58,58 54,58" fill="${s.accent}"/>`;
      case 'stripe': return `<rect x="44" y="53" width="32" height="5" fill="${s.accent}"/>`;
      case 'chevron': return `<polygon points="49,52 60,60 71,52 71,57 60,65 49,57" fill="${s.accent}"/>`;
      case 'dots': return `<circle cx="60" cy="56" r="5" fill="${s.accent}"/><circle cx="50" cy="62" r="2.5" fill="${s.accent}"/><circle cx="70" cy="62" r="2.5" fill="${s.accent}"/>`;
      default: return '';
    }
  })();
  const cape = `<path d="M44 44 Q36 70 40 96 L80 96 Q84 70 76 44 Z" fill="${s.cape ? s.accent : s.secondary}" opacity="0.9"/>`;
  // each stake's stuntman has his own build
  const build = s.tier === 'medium' ? 'scale(1.32 0.86) translate(-14.5 13)' : s.tier === 'hard' ? 'scale(0.82 1.1) translate(13.2 -9)' : s.tier === 'expert' ? 'scale(1.15 1.02) translate(-7.8 -1.5)' : '';
  const extra = s.tier === 'medium'
    ? `<ellipse cx="60" cy="62" rx="19" ry="15" fill="${s.primary}"/><path d="M50 33 q5 4 10 0 q5 4 10 0" stroke="#4a2f1d" stroke-width="2.4" fill="none"/>`
    : s.tier === 'hard' ? `<polygon points="47,16 60,2 73,16" fill="${s.accent}"/>`
    : s.tier === 'expert' ? `<rect x="44" y="100" width="8" height="6" rx="2" fill="#9aa1ab"/><rect x="68" y="100" width="8" height="6" rx="2" fill="#9aa1ab"/><polygon points="46,106 50,106 48,113" fill="#ffb347"/><polygon points="70,106 74,106 72,113" fill="#ffb347"/><ellipse cx="60" cy="47" rx="19" ry="8" fill="${s.primary}"/>` : '';
  return `<svg viewBox="0 0 120 120" width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs><filter id="${id}" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#4a3f30" flood-opacity="0.25"/></filter></defs>
    <g filter="url(#${id})" transform="${build}">
      ${cape}
      <!-- legs -->
      <rect x="47" y="76" width="11" height="24" rx="4" fill="${s.primary}"/><rect x="62" y="76" width="11" height="24" rx="4" fill="${s.primary}"/>
      <rect x="45" y="96" width="14" height="9" rx="3" fill="${s.secondary}"/><rect x="61" y="96" width="14" height="9" rx="3" fill="${s.secondary}"/>
      <!-- trunks + belt -->
      <rect x="45" y="70" width="30" height="10" rx="4" fill="${s.secondary}"/>
      <rect x="44" y="68" width="32" height="4" rx="2" fill="${s.accent}"/>
      <!-- torso -->
      <rect x="44" y="40" width="32" height="30" rx="8" fill="${s.primary}"/>
      ${emblem}
      <!-- arms -->
      <rect x="30" y="42" width="12" height="26" rx="5" fill="${s.secondary}"/><rect x="78" y="42" width="12" height="26" rx="5" fill="${s.secondary}"/>
      <circle cx="36" cy="70" r="5" fill="${s.secondary}"/><circle cx="84" cy="70" r="5" fill="${s.secondary}"/>
      <!-- head + helmet + goggles -->
      <circle cx="60" cy="26" r="13" fill="${s.skin}"/>
      <path d="M46 25 A14 14 0 0 1 74 25 L74 28 L46 28 Z" fill="${s.accent}"/>
      <rect x="49" y="25" width="22" height="6" rx="3" fill="#2b2b2b"/><rect x="51" y="26.5" width="7" height="3" rx="1.5" fill="#9fd8ff"/><rect x="62" y="26.5" width="7" height="3" rx="1.5" fill="#9fd8ff"/>
      <rect x="56" y="34" width="8" height="1.6" rx="0.8" fill="#2b2b2b"/>
      ${extra}
    </g></svg>`;
}
