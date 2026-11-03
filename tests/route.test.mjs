// The flight line must be perfectly straight: Steve and the camera never turn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
const load = (rel, extra = {}) => { let js = ts.transpileModule(readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText; for (const [a, b] of Object.entries(extra)) js = js.replaceAll(a, b); return js; };
const dir = mkdtempSync(join(tmpdir(), 'pp-'));
writeFileSync(join(dir, 'rng.js'), load('core/rng.ts'));
writeFileSync(join(dir, 'route.js'), load('game/route.ts', { "'../core/rng'": "'./rng.js'" }));
const { Route } = await import(join(dir, 'route.js'));

test('the flight route never turns, however far it goes', () => {
  for (const seed of ['a', 'b', 'qa3', 'xyz']) {
    const r = new Route(seed);
    r.ensure(4000);
    for (let s = 0; s < 4000; s += 0.5) {
      const p = r.at(s);
      assert.ok(Math.abs(p.heading) < 1e-9, `heading ${p.heading} at s=${s}`);
      assert.ok(Math.abs(p.x) < 1e-9, `x ${p.x} at s=${s}`);
      assert.ok(Math.abs(p.z + s) < 1e-6, `z ${p.z} at s=${s}`);
    }
  }
});
