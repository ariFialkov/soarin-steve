/** DOM user interface: menu (stakes, always-open boost loadout), HUD, settings, result card. */
import { BOOST_CONFIG, TIERS, TIER_CONFIG, getRtp, setRtp, type BoostKind, type Tier } from '../core/config';
import { round2, server, verifyRound, type RoundResult } from '../core/server';
import { profile, resetProfile, saveProfile } from '../core/store';
import { audio } from '../game/audio';
import type { Engine, GameState, HudInfo } from '../game/engine';
import type { FumbleKind } from '../game/flightPlan';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function money(v: number): string {
  const abs = Math.abs(v);
  const s = abs >= 1000 ? abs.toLocaleString(undefined, { maximumFractionDigits: 0 }) : abs.toFixed(2);
  return (v < 0 ? '-$' : '$') + s;
}

function fmtDist(m: number): string {
  if (m >= 10000) return (m / 1000).toFixed(1) + ' km';
  if (m >= 1000) return (m / 1000).toFixed(2) + ' km';
  return m.toFixed(1) + ' m';
}

export class UI {
  private engine!: Engine;
  private menu = $('menu');
  private hud = $('hud');
  private resultEl = $('result');
  private panel = $('panel');
  private panelBody = $('panel-body');
  private toastEl = $('toast');
  private toastTimer = 0;
  private lastHud = 0;
  private lastResult: RoundResult | null = null;
  private state: GameState = 'menu';

  bind(engine: Engine): void {
    this.engine = engine;
    this.renderTierPicker();
    this.updateWallet();
    this.buildBoostPanel();
    $('btn-settings').addEventListener('click', () => this.openSettings());
    $('panel-close').addEventListener('click', () => this.closePanel());
    this.panel.addEventListener('pointerdown', e => { if (e.target === this.panel) this.closePanel(); });
    $('btn-back').addEventListener('click', () => { if (this.state === 'aiming') void this.engine.toMenu(); });
    $('btn-again').addEventListener('click', () => { this.hideResult(); void this.engine.playAgain(); });
    $('btn-result-menu').addEventListener('click', () => { this.hideResult(); void this.engine.toMenu(); });
    for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('.boost'))) {
      b.addEventListener('click', () => this.toggleBoost(b.dataset.kind as BoostKind));
    }
    this.buildGauge();
    this.hud.classList.add('hidden');
    this.setAimingHud(true);
  }

  /** Semicircular powder gauge: a coloured arc that fills, ticks, and a needle. */
  private buildGauge(): void {
    const cx = 60, cy = 58, r = 46;
    const xy = (a: number, rr: number) => [(cx + Math.cos(a) * rr).toFixed(1), (cy - Math.sin(a) * rr).toFixed(1)];
    const pt = (a: number, rr: number) => xy(a, rr).join(',');
    const ticks = Array.from({ length: 11 }, (_, i) => {
      const a = Math.PI * (1 - i / 10), major = i % 5 === 0;
      const [x1, y1] = xy(a, r - 11), [x2, y2] = xy(a, r - (major ? 19 : 15));
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#fff6e0" stroke-width="${major ? 2.2 : 1.4}" stroke-linecap="round" opacity="${major ? 0.9 : 0.6}"/>`;
    }).join('');
    const arc = `M${pt(Math.PI, r)} A${r} ${r} 0 0 1 ${pt(0, r)}`;
    $('gauge').innerHTML = `
      <svg viewBox="0 0 120 64" aria-hidden="true">
        <defs><linearGradient id="g-heat" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="#35b866"/><stop offset="0.5" stop-color="#ffc93c"/><stop offset="0.85" stop-color="#ff8a1f"/><stop offset="1" stop-color="#e23b3b"/>
        </linearGradient></defs>
        <path d="${arc}" fill="none" stroke="#0b1430" stroke-width="11" stroke-linecap="round"/>
        <path d="${arc}" fill="none" stroke="rgba(255,246,224,0.12)" stroke-width="8" stroke-linecap="round"/>
        <path id="pull-arc" d="${arc}" fill="none" stroke="url(#g-heat)" stroke-width="8" stroke-linecap="round" pathLength="100" stroke-dasharray="100 100" stroke-dashoffset="100"/>
        ${ticks}
        <text x="${cx - r - 2}" y="${cy + 6}" font-size="7" fill="#d9cfb4" font-family="Barlow Condensed, sans-serif" font-weight="800" text-anchor="middle">MIN</text>
        <text x="${cx + r + 2}" y="${cy + 6}" font-size="7" fill="#ff6b5e" font-family="Barlow Condensed, sans-serif" font-weight="800" text-anchor="middle">MAX</text>
        <g id="pull-needle" transform="rotate(-90 ${cx} ${cy})">
          <polygon points="${cx - 2.6},${cy} ${cx + 2.6},${cy} ${cx},${cy - r + 9}" fill="#e23b3b" stroke="#6d0f18" stroke-width="0.8"/>
        </g>
        <circle cx="${cx}" cy="${cy}" r="5" fill="#ffc93c" stroke="#6d0f18" stroke-width="1.2"/>
      </svg>
      <div class="readout"><span id="pull-pct">0%</span><span class="lbl">powder</span></div>`;
  }

  // ------------------------------------------------------------ engine events
  onState(s: GameState): void {
    this.state = s;
    if (s === 'menu') {
      this.menu.classList.remove('hidden', 'away');
      this.hud.classList.add('hidden');
      $('btn-back').classList.remove('hidden-now');
      this.updateWallet();
      this.refreshBoostPanel();
    } else if (s === 'aiming') {
      this.menu.classList.add('away');
      setTimeout(() => { if (this.state !== 'menu') this.menu.classList.add('hidden'); }, 550);
      this.hud.classList.remove('hidden');
      this.setAimingHud(true);
      this.updateHudWager();
      $('hud-dist').textContent = '0';
      $('hud-cash').textContent = money(0);
      $('btn-back').classList.remove('hidden-now');
    } else if (s === 'betting') {
      $('btn-back').classList.add('hidden-now');
      $('aim-hint').classList.add('firing');
      $('aim-text').textContent = 'Fire in the hole!';
    } else if (s === 'flying') {
      $('fumble').classList.remove('show');
      this.setAimingHud(false);
      this.updateWallet();
      this.refreshBoostPanel();
      this.refreshBoostBar();
    }
  }

  onPull(p: number): void {
    if (p > 0 || this.state === 'aiming') this.showPull(p);
  }

  private showPull(p: number): void {
    $('pull-arc').setAttribute('stroke-dashoffset', String(100 - p * 100));
    $('pull-needle').setAttribute('transform', `rotate(${(-90 + 180 * p).toFixed(1)} 60 58)`);
    $('pull-pct').textContent = `${Math.round(p * 100)}%`;
    $('gauge').classList.toggle('hot', p > 0.85);
  }

  onHud(info: HudInfo): void {
    const now = performance.now();
    if (now - this.lastHud < 50 && info.progress < 1) return;
    this.lastHud = now;
    $('hud-dist').textContent = info.distance >= 1000 ? (info.distance / 1000).toFixed(2) + 'k' : info.distance.toFixed(1);
    $('hud-cash').textContent = money(info.cash);
    $('q-blower').textContent = `${info.blowerSeconds.toFixed(1)}s`;
    $('q-confetti').textContent = `×${info.confetti}`;
    $('q-rockets').textContent = `×${info.rockets}`;
    const bar = $('boost-bar');
    for (const b of Array.from(bar.querySelectorAll<HTMLButtonElement>('.boost'))) {
      const k = b.dataset.kind as BoostKind;
      const n = k === 'blower' ? info.blowerSeconds : k === 'confetti' ? info.confetti : info.rockets;
      b.disabled = n <= 0.001;
      if (b.disabled && this.engine.boostMode === k) { this.engine.setBoostMode(null); b.classList.remove('active'); this.showBoostHint(); }
    }
  }

  onResult(r: RoundResult): void {
    this.lastResult = r;
    $('r-dist').textContent = fmtDist(r.distance);
    $('r-mult').textContent = r.multiplier.toFixed(2) + '×';
    $('r-wager').textContent = money(r.totalWager);
    $('r-payout').textContent = money(r.payout);
    const stamp = $('result-stamp');
    const m = r.multiplier;
    const who = TIER_CONFIG[r.tier].character.split(' ').pop();
    stamp.textContent = this.lastFumble ? 'Misfire!' : m >= 10 ? 'Legendary!' : m >= 3 ? 'Death-defying!' : m >= 1 ? `Nice flight, ${who}!` : m >= 0.5 ? `${who} walks it off` : 'Ouch. Short hop';
    this.lastFumble = null;
    stamp.classList.toggle('big', m >= 1);
    $('r-fair').innerHTML = `
      <div>Round <code>${r.roundId}</code></div>
      <div>Server seed hash (published before the bet)<code>${r.serverSeedHash}</code></div>
      <div>Server seed (revealed)<code>${r.serverSeed}</code></div>
      <div>Client seed · nonce<code>${r.clientSeed} · ${r.nonce}</code></div>
      <div>RTP ${Math.round(r.rtp * 100)}% · multiplier = f(sha256(server:client:nonce)) <span id="verify-state">· verifying…</span></div>`;
    void verifyRound(r).then(ok => { const el = document.getElementById('verify-state'); if (el) el.textContent = ok ? '· verified ✓' : '· MISMATCH'; });
    this.resultEl.classList.remove('hidden');
    this.updateWallet();
    if (m >= 1) audio.chime(m >= 3 ? 5 : 3); else audio.tick();
  }

  onError(msg: string): void { this.toast(msg); }

  onFumble(kind: FumbleKind): void {
    const sub: Record<FumbleKind, string[]> = {
      fizzle: ['wet powder', 'that was more of a plop', 'somebody forgot the gunpowder'],
      rim: ['clipped the rim on the way out', 'helmet met barrel', 'caught the muzzle'],
      gust: ['a gust got under him', 'cross-wind on launch', 'the wind had other plans'],
      spinout: ['too much tuck', 'over-rotated', 'spun out of the barrel'],
    };
    const el = $('fumble');
    el.querySelector('.sub')!.textContent = sub[kind][Math.floor(Math.random() * sub[kind].length)];
    this.lastFumble = kind;
    clearTimeout(this.fumbleTimer);
    // a beat after release, once the tumble has started
    this.fumbleTimer = window.setTimeout(() => {
      el.classList.add('show');
      this.fumbleTimer = window.setTimeout(() => el.classList.remove('show'), 2600);
    }, 350);
  }
  private lastFumble: FumbleKind | null = null;
  private fumbleTimer = 0;

  private hideResult(): void { this.resultEl.classList.add('hidden'); }

  // ------------------------------------------------------------ HUD helpers
  private setAimingHud(aiming: boolean): void {
    $('aim-hint').classList.toggle('hidden', !aiming);
    if (aiming) {
      $('aim-hint').classList.remove('firing');
      $('aim-text').textContent = 'Drag down to pack the powder · let go to fire';
      this.showPull(0);
    }
    $('boost-bar').classList.toggle('hidden', aiming);
    $('boost-hint').textContent = '';
  }

  private updateHudWager(): void {
    const cfg = TIER_CONFIG[profile.tier];
    const cost = server.boostCost(profile.tier, profile.boosts);
    $('hud-wager').textContent = money(cfg.stake + cost);
    $('hud-plane').textContent = cfg.character;
  }

  private refreshBoostBar(): void {
    for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('.boost'))) b.classList.remove('active');
    this.showBoostHint();
  }

  private toggleBoost(kind: BoostKind): void {
    if (this.state !== 'flying') return;
    const btn = document.querySelector<HTMLButtonElement>(`.boost[data-kind=${kind}]`)!;
    if (btn.disabled) return;
    const active = this.engine.boostMode === kind;
    this.engine.setBoostMode(active ? null : kind);
    for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('.boost'))) b.classList.toggle('active', b === btn && !active);
    this.showBoostHint();
    audio.tick();
  }

  private showBoostHint(): void {
    const m = this.engine.boostMode;
    const touch = matchMedia('(pointer: coarse)').matches;
    $('boost-hint').textContent =
      m === 'blower' ? (touch ? 'hold your thumb behind him to blow him along' : 'click and hold behind him to blow him along') :
      m === 'confetti' ? (touch ? 'tap behind him to fire' : 'click behind him to fire') :
      m === 'rockets' ? (touch ? 'tap anywhere to light the next rocket' : 'click anywhere to light the next rocket') : '';
  }

  // ------------------------------------------------------------ menu widgets
  private renderTierPicker(): void {
    const el = $('tier-picker');
    el.innerHTML = '';
    for (const t of TIERS) {
      const cfg = TIER_CONFIG[t];
      const b = document.createElement('button');
      b.className = 'tier-btn' + (profile.tier === t ? ' active' : '');
      b.style.setProperty('--c', cfg.accent);
      b.innerHTML = `<span class="dot"></span><span class="tier-names"><span>${cfg.label}</span><small>${cfg.character}</small></span><span class="stake">${money(cfg.stake)}</span>`;
      b.addEventListener('click', () => { this.setTier(t); audio.tick(); });
      el.appendChild(b);
    }
  }

  private setTier(t: Tier): void {
    profile.tier = t;
    saveProfile();
    this.renderTierPicker();
    this.engine.refreshSelection();
    this.refreshBoostPanel();
  }

  private updateWallet(): void {
    $('wallet').textContent = money(server.getBalance());
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2200);
  }

  // ------------------------------------------------------------ panels
  private openPanel(html: string): void {
    this.panelBody.innerHTML = html;
    this.panel.classList.remove('hidden');
  }
  private closePanel(): void { this.panel.classList.add('hidden'); }

  // ------------------------------------------------------------ boost loadout (always open on the menu)
  private static readonly BOOST_ICON: Record<BoostKind, string> = { blower: '🍃', confetti: '🎉', rockets: '🚀' };
  private static readonly BOOST_SHORT: Record<BoostKind, string> = { blower: 'Blower', confetti: 'Confetti', rockets: 'Rockets' };

  private buildBoostPanel(): void {
    const rows = (Object.keys(BOOST_CONFIG) as BoostKind[]).map(k => `
      <div class="bp-row" data-kind="${k}" title="${BOOST_CONFIG[k].label}: ${BOOST_CONFIG[k].blurb}">
        <span class="ico">${UI.BOOST_ICON[k]}</span>
        <div class="bp-info"><div class="name">${UI.BOOST_SHORT[k]}</div><div class="price"></div></div>
        <div class="stepper"><button data-d="-1" aria-label="One less">−</button><span class="n">0</span><button data-d="1" aria-label="One more">+</button></div>
      </div>`).join('');
    $('bp-rows').innerHTML = rows;
    for (const btn of Array.from($('bp-rows').querySelectorAll<HTMLButtonElement>('.stepper button'))) {
      btn.addEventListener('click', () => {
        const k = (btn.closest('.bp-row') as HTMLElement).dataset.kind as BoostKind;
        profile.boosts[k] = Math.max(0, Math.min(BOOST_CONFIG[k].max, profile.boosts[k] + Number(btn.dataset.d)));
        saveProfile();
        audio.tick();
        this.refreshBoostPanel();
        this.engine.refreshSelection();
      });
    }
    this.refreshBoostPanel();
  }

  /** Prices follow the selected stake; counts reset to zero after every flight. */
  private refreshBoostPanel(): void {
    const cfg = TIER_CONFIG[profile.tier];
    for (const row of Array.from($('bp-rows').querySelectorAll<HTMLElement>('.bp-row'))) {
      const k = row.dataset.kind as BoostKind;
      const n = profile.boosts[k];
      const unit = k === 'blower' ? 'sec' : k === 'confetti' ? 'shot' : 'each';
      row.querySelector('.n')!.textContent = String(n);
      row.querySelector('.price')!.textContent = `${money(round2(BOOST_CONFIG[k].price * cfg.stake))} / ${unit}`;
      row.classList.toggle('loaded', n > 0);
      (row.querySelector('[data-d="-1"]') as HTMLButtonElement).disabled = n <= 0;
      (row.querySelector('[data-d="1"]') as HTMLButtonElement).disabled = n >= BOOST_CONFIG[k].max;
    }
    const cost = server.boostCost(profile.tier, profile.boosts);
    $('bp-total').textContent = money(cfg.stake + cost);
    $('bp-split').textContent = cost > 0 ? `${money(cfg.stake)} stake + ${money(cost)} boosts` : `${money(cfg.stake)} stake, no boosts`;
  }

  private openSettings(): void {
    const rtp = getRtp();
    this.openPanel(`
      <h2>Settings</h2>
      <div class="setting"><span>Sound</span><button class="switch ${profile.sound ? 'on' : ''}" id="s-sound">${profile.sound ? 'On' : 'Off'}</button></div>
      <div class="setting"><span>Graphics quality <span class="muted">(applies after reload)</span></span><button class="switch ${profile.quality === 'high' ? 'on' : ''}" id="s-quality">${profile.quality === 'high' ? 'High' : 'Low'}</button></div>
      <h3>House</h3>
      <div class="setting"><span>Return to player (RTP) <span class="muted">demo operator setting</span></span><span><input type="number" id="s-rtp" min="50" max="100" step="0.5" value="${(rtp * 100).toFixed(1)}"> %</span></div>
      <div class="setting"><span>Demo wallet</span><span><button class="switch" id="s-wallet">Reset to ${money(1000)}</button></span></div>
      <div class="setting"><span>Everything (boosts, wallet, stats)</span><span><button class="switch" id="s-reset">Reset profile</button></span></div>
      <h3>How the game decides</h3>
      <p class="muted">Every round is settled by the game server the instant the cannon fires, before Steve moves. The server publishes a hash of its seed before the bet, then reveals the seed afterwards so you can verify the result. The powder charge, the boosts and the scenery are all just the show.</p>
      <h3>Credits</h3>
      <p class="credits">Soarin' Steve is a work of fiction; no stuntmen were harmed. Built with <a href="https://threejs.org" target="_blank" rel="noopener">three.js</a>.</p>
      <p class="muted">Soarin' Steve ${APP_VERSION} · ${profile.rounds} shows flown</p>`);
    $('s-sound').addEventListener('click', () => { profile.sound = !profile.sound; saveProfile(); audio.setEnabled(profile.sound); this.openSettings(); });
    $('s-quality').addEventListener('click', () => { profile.quality = profile.quality === 'high' ? 'low' : 'high'; saveProfile(); this.openSettings(); });
    $('s-rtp').addEventListener('change', e => {
      const v = Number((e.target as HTMLInputElement).value);
      if (v >= 50 && v <= 100) { setRtp(v / 100); this.toast(`RTP set to ${v}% for new rounds`); }
    });
    $('s-wallet').addEventListener('click', async () => { await server.resetWallet(); this.updateWallet(); this.toast('Wallet topped up'); });
    $('s-reset').addEventListener('click', async () => { resetProfile(); await server.resetWallet(); location.reload(); });
  }

  get lastRound(): RoundResult | null { return this.lastResult; }
}

