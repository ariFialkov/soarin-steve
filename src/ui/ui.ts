/** DOM user interface: menu, HUD, hangar, boost shop, settings, result card. */
import { BOOST_CONFIG, TIERS, TIER_CONFIG, getRtp, setRtp, type BoostKind, type Tier } from '../core/config';
import { round2, server, verifyRound, type RoundResult } from '../core/server';
import { profile, resetProfile, saveProfile } from '../core/store';
import { SUITS, suitById, suitsForTier, type SuitDef } from '../data/suits';
import { audio } from '../game/audio';
import type { Engine, GameState, HudInfo } from '../game/engine';
import type { FumbleKind } from '../game/flightPlan';
import { suitThumbSvg } from './suitThumb';

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
    this.updateBoostBadge();
    $('btn-hangar').addEventListener('click', () => this.openHangar());
    $('btn-boosts').addEventListener('click', () => this.openShop());
    $('btn-settings').addEventListener('click', () => this.openSettings());
    $('panel-close').addEventListener('click', () => this.closePanel());
    this.panel.addEventListener('pointerdown', e => { if (e.target === this.panel) this.closePanel(); });
    $('btn-back').addEventListener('click', () => { if (this.state === 'aiming') void this.engine.toMenu(); });
    $('btn-again').addEventListener('click', () => { this.hideResult(); void this.engine.playAgain(); });
    $('btn-result-menu').addEventListener('click', () => { this.hideResult(); void this.engine.toMenu(); });
    for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('.boost'))) {
      b.addEventListener('click', () => this.toggleBoost(b.dataset.kind as BoostKind));
    }
    this.hud.classList.add('hidden');
    this.setAimingHud(true);
  }

  // ------------------------------------------------------------ engine events
  onState(s: GameState): void {
    this.state = s;
    if (s === 'menu') {
      this.menu.classList.remove('hidden', 'away');
      this.hud.classList.add('hidden');
      $('btn-back').classList.remove('hidden-now');
      this.updateWallet();
      this.updateBoostBadge();
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
      $('aim-hint').textContent = 'fire in the hole…';
    } else if (s === 'flying') {
      $('fumble').classList.remove('show');
      this.setAimingHud(false);
      this.updateWallet();
      this.updateBoostBadge();
      this.refreshBoostBar();
    }
  }

  onPull(p: number): void {
    $('pull-fill').style.width = `${Math.round(p * 100)}%`;
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
    stamp.textContent = this.lastFumble ? 'Misfire!' : m >= 10 ? 'LEGENDARY!' : m >= 3 ? 'What a stunt!' : m >= 1 ? 'Nice flight, Steve!' : m >= 0.5 ? 'He will walk it off' : 'Ouch. Short hop';
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
    $('aim-hint').innerHTML = '<div class="pull-meter"><div class="pull-fill" id="pull-fill"></div></div><div>drag down to pack the powder, let go to fire</div>';
    $('boost-bar').classList.toggle('hidden', aiming);
    $('boost-hint').textContent = '';
  }

  private updateHudWager(): void {
    const cfg = TIER_CONFIG[profile.tier];
    const cost = server.boostCost(profile.tier, profile.boosts);
    $('hud-wager').textContent = money(cfg.stake + cost);
    $('hud-plane').textContent = suitById(profile.selected[profile.tier]).name;
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
      m === 'blower' ? (touch ? 'hold your thumb behind Steve to blow him along' : 'click and hold behind Steve to blow him along') :
      m === 'confetti' ? (touch ? 'tap behind Steve to fire' : 'click behind Steve to fire') :
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
      b.innerHTML = `<span class="dot"></span><span>${cfg.label}</span><span class="stake">${money(cfg.stake)}</span>`;
      b.addEventListener('click', () => { this.setTier(t); audio.tick(); });
      el.appendChild(b);
    }
  }

  private setTier(t: Tier): void {
    profile.tier = t;
    saveProfile();
    this.renderTierPicker();
    this.engine.refreshSelection();
    this.updateBoostBadge();
  }

  private updateWallet(): void {
    $('wallet').textContent = money(server.getBalance());
  }

  private updateBoostBadge(): void {
    const n = profile.boosts.blower + profile.boosts.confetti + profile.boosts.rockets;
    const el = $('boost-count');
    el.hidden = n === 0;
    el.textContent = String(n);
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

  private openHangar(tier: Tier = profile.tier): void {
    const tabs = TIERS.map(t => `<button class="${t === tier ? 'active' : ''}" data-tier="${t}" style="--c:${TIER_CONFIG[t].accent}">${TIER_CONFIG[t].label} · ${money(TIER_CONFIG[t].stake)}</button>`).join('');
    this.openPanel(`
      <h2>Wardrobe</h2>
      <p class="muted">Your stake is set by the suit's tier. The flashier the suit, the bigger the show on a good day.</p>
      <div class="tabs">${tabs}</div>
      <div class="grid" id="hangar-grid"></div>
      <p class="muted" style="margin-top:12px">Each suit gives Steve a different flying style: steady, swooping, rocking, twirling, fluttering, darting or drifting.</p>`);
    for (const b of Array.from(this.panelBody.querySelectorAll<HTMLButtonElement>('.tabs button'))) {
      b.addEventListener('click', () => this.openHangar(b.dataset.tier as Tier));
    }
    this.renderHangarGrid(tier);
  }

  private renderHangarGrid(tier: Tier): void {
    const grid = $('hangar-grid');
    grid.innerHTML = '';
    for (const p of suitsForTier(tier)) grid.appendChild(this.suitCard(p));
  }

  private suitCard(p: SuitDef): HTMLElement {
    const owned = profile.owned.includes(p.id);
    const selected = profile.selected[p.tier] === p.id && profile.tier === p.tier;
    const card = document.createElement('div');
    card.className = 'card' + (selected ? ' selected' : '') + (owned ? '' : ' locked');
    card.innerHTML = `${suitThumbSvg(p, 96)}
      <div class="name">${p.name}</div>
      <div class="tags">${p.tags.map(t => `<span>${t}</span>`).join('')}</div>
      <div class="blurb">${p.blurb}</div>
      <div class="price ${owned ? 'owned' : ''}">${owned ? (selected ? 'Selected ✓' : 'Owned') : money(p.price)}</div>`;
    card.addEventListener('click', () => {
      if (profile.owned.includes(p.id)) {
        profile.selected[p.tier] = p.id;
        this.setTier(p.tier);
        this.renderHangarGrid(p.tier);
        this.toast(`Steve is wearing ${p.name}`);
      } else {
        if (card.querySelector('.confirm')) return;
        const c = document.createElement('div');
        c.className = 'confirm';
        const can = server.getBalance() >= p.price;
        c.innerHTML = `<div>Buy ${p.name}?</div><div class="price">${money(p.price)}</div>
          <div class="row" style="margin-top:4px"><button class="tag small primary" ${can ? '' : 'disabled'}>Buy</button><button class="tag small ghost">Cancel</button></div>${can ? '' : '<div class="muted">Not enough in your wallet</div>'}`;
        const [buy, cancel] = Array.from(c.querySelectorAll('button'));
        buy.addEventListener('click', async e => {
          e.stopPropagation();
          try {
            await server.purchase(p.price);
            profile.owned.push(p.id);
            profile.selected[p.tier] = p.id;
            this.setTier(p.tier);
            this.updateWallet();
            audio.chime(3);
            this.toast(`${p.name} is yours!`);
            this.renderHangarGrid(p.tier);
          } catch (err) { this.toast((err as Error).message); c.remove(); }
        });
        cancel.addEventListener('click', e => { e.stopPropagation(); c.remove(); });
        card.appendChild(c);
      }
    });
    return card;
  }

  private openShop(): void {
    const cfg = TIER_CONFIG[profile.tier];
    const rows = (Object.keys(BOOST_CONFIG) as BoostKind[]).map(k => {
      const b = BOOST_CONFIG[k];
      const ico = k === 'blower' ? '🍃' : k === 'confetti' ? '🎉' : '🚀';
      return `<div class="shop-row" data-kind="${k}">
        <div class="ico">${ico}</div>
        <div><div class="name">${b.label} <span class="muted">· ${money(round2(b.price * cfg.stake))} per ${b.unit}</span></div><div class="blurb">${b.blurb}</div></div>
        <div class="stepper"><button data-d="-1">−</button><span class="n">0</span><button data-d="1">+</button><span class="cost"></span></div>
      </div>`;
    }).join('');
    this.openPanel(`
      <h2>Boosts</h2>
      <p class="muted">Carry boosts into Steve's next flight and use them whenever you like. Their cost joins your ${money(cfg.stake)} stake as part of the wager when you fire, and unused boosts are not refunded.</p>
      ${rows}
      <div class="total"><span>Wager next round</span><span id="shop-total"></span></div>
      <div class="muted" style="margin-top:4px">Boosts only push a Steve who is already moving: once he is down, he is down.</div>`);
    const refresh = () => {
      for (const row of Array.from(this.panelBody.querySelectorAll<HTMLElement>('.shop-row'))) {
        const k = row.dataset.kind as BoostKind;
        const n = profile.boosts[k];
        row.querySelector('.n')!.textContent = String(n);
        row.querySelector('.cost')!.textContent = n ? money(round2(n * BOOST_CONFIG[k].price * cfg.stake)) : '';
        (row.querySelector('[data-d="-1"]') as HTMLButtonElement).disabled = n <= 0;
        (row.querySelector('[data-d="1"]') as HTMLButtonElement).disabled = n >= BOOST_CONFIG[k].max;
      }
      const cost = server.boostCost(profile.tier, profile.boosts);
      $('shop-total').textContent = `${money(cfg.stake)} + ${money(cost)} = ${money(cfg.stake + cost)}`;
      this.updateBoostBadge();
      this.engine.refreshSelection();
    };
    for (const btn of Array.from(this.panelBody.querySelectorAll<HTMLButtonElement>('.stepper button'))) {
      btn.addEventListener('click', () => {
        const k = (btn.closest('.shop-row') as HTMLElement).dataset.kind as BoostKind;
        profile.boosts[k] = Math.max(0, Math.min(BOOST_CONFIG[k].max, profile.boosts[k] + Number(btn.dataset.d)));
        saveProfile();
        audio.tick();
        refresh();
      });
    }
    refresh();
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
      <div class="setting"><span>Everything (planes, boosts, wallet)</span><span><button class="switch" id="s-reset">Reset profile</button></span></div>
      <h3>How the game decides</h3>
      <p class="muted">Every round is settled by the game server the instant the cannon fires, before Steve moves. The server publishes a hash of its seed before the bet, then reveals the seed afterwards so you can verify the result. The powder charge, the boosts and the scenery are all just the show.</p>
      <h3>Credits</h3>
      <p class="credits">Soarin' Steve is a work of fiction; no stuntmen were harmed. Built with <a href="https://threejs.org" target="_blank" rel="noopener">three.js</a>.</p>
      <p class="muted">Soarin' Steve ${APP_VERSION} · ${SUITS.length} suits in the wardrobe · ${profile.rounds} shows flown</p>`);
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

