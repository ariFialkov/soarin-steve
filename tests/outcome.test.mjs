// Quick statistical sanity checks on the outcome maths and flight plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

// Transpile the pure modules on the fly so the tests do not need a build step.
function load(rel, extra = {}) {
  const src = readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');
  let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [from, to] of Object.entries(extra)) js = js.replaceAll(from, to);
  return js;
}
const dir = mkdtempSync(join(tmpdir(), 'pp-'));
writeFileSync(join(dir, 'config.js'), load('core/config.ts').replace(/location\.search/g, '""').replace(/localStorage/g, 'undefined'));
writeFileSync(join(dir, 'rng.js'), load('core/rng.ts'));
writeFileSync(join(dir, 'outcome.js'), load('core/outcome.ts', { "'./config'": "'./config.js'" }));
writeFileSync(join(dir, 'constants.js'), load('game/constants.ts'));
writeFileSync(join(dir, 'flightPlan.js'), load('game/flightPlan.ts', { "'../core/rng'": "'./rng.js'", "'./constants'": "'./constants.js'" }));

const { TIERS, TIER_CONFIG } = await import(join(dir, 'config.js'));
const { multiplierFor } = await import(join(dir, 'outcome.js'));
const { buildFlightPlan } = await import(join(dir, 'flightPlan.js'));
const { Rng } = await import(join(dir, 'rng.js'));

test('expected multiplier equals RTP for every tier', () => {
  for (const tier of TIERS) {
    for (const rtp of [0.9, 0.96, 0.99]) {
      // exact expectation via fine quadrature of the inverse CDF
      const N = 200000;
      let sum = 0;
      for (let i = 0; i < N; i++) sum += multiplierFor(tier, (i + 0.5) / N, rtp);
      const ev = sum / N;
      assert.ok(Math.abs(ev - rtp) < 0.002, `${tier} rtp=${rtp} ev=${ev}`);
      assert.ok(multiplierFor(tier, 0.999999, rtp) <= TIER_CONFIG[tier].maxMultiplier * 2);
    }
  }
});

test('flight plans end exactly at the resolved distance', () => {
  const rng = new Rng('tests');
  for (let i = 0; i < 300; i++) {
    const metres = Math.exp(rng.range(Math.log(2), Math.log(90000)));
    const plan = buildFlightPlan({ seed: 'seed' + i, distanceMetres: metres, power: rng.next(), angle: rng.next(), style: 'steady' });
    assert.ok(Math.abs(plan.s[plan.s.length - 1] - plan.L) < 1e-3);
    assert.equal(plan.v[plan.v.length - 1], 0);
    for (let j = 1; j < plan.s.length; j++) assert.ok(plan.s[j] >= plan.s[j - 1] - 1e-6, 'monotonic');
    for (const e of plan.events) assert.ok(e.s >= 0 && e.s <= plan.L);
  }
});
