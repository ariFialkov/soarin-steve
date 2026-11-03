import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { Engine } from './game/engine';
import { UI } from './ui/ui';
import { profile } from './core/store';
import { server } from './core/server';
import { buildFlightPlan } from './game/flightPlan';
import { audio } from './game/audio';

audio.setEnabled(profile.sound);

const ui = new UI();
const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, {
  onState: s => ui.onState(s),
  onHud: i => ui.onHud(i),
  onResult: r => ui.onResult(r),
  onError: m => ui.onError(m),
  onPull: p => ui.onPull(p),
  onFumble: k => ui.onFumble(k),
});
ui.bind(engine);

// PWA: auto-update in the background, offline after first visit.
registerSW({ immediate: true });

// Expose for debugging in the console.
(window as unknown as { pp: unknown }).pp = { engine, ui, profile, server, buildFlightPlan };
