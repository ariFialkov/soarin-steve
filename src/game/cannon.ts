/** The circus cannon on the roof terrace. */
import * as THREE from 'three';

export interface Cannon {
  group: THREE.Group;
  barrel: THREE.Group;
  /** 0..1 charge from the pull; raises the barrel and shakes it */
  setCharge(p: number): void;
  /** world position of the muzzle and the launch direction */
  muzzle(out: THREE.Vector3, dir: THREE.Vector3): void;
  fire(): void;
  update(dt: number, t: number): void;
  dispose(): void;
}

export function buildCannon(): Cannon {
  const group = new THREE.Group();
  const mats = {
    red: new THREE.MeshLambertMaterial({ color: '#c0392b' }),
    gold: new THREE.MeshLambertMaterial({ color: '#f2c14e' }),
    dark: new THREE.MeshLambertMaterial({ color: '#2f2f33' }),
    wood: new THREE.MeshLambertMaterial({ color: '#8a5a3c' }),
    white: new THREE.MeshLambertMaterial({ color: '#f8f1e4' }),
    flash: new THREE.MeshBasicMaterial({ color: '#fff1a8', transparent: true, opacity: 0, depthWrite: false }),
  };
  const geos: THREE.BufferGeometry[] = [];
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => { geos.push(g); return new THREE.Mesh(g, m); };

  // carriage: a sturdy wooden/steel base with two big spoked wheels
  const base = mesh(new THREE.BoxGeometry(2.2, 0.5, 3.2), mats.wood); base.position.set(0, 0.55, 0.3); group.add(base);
  const trail = mesh(new THREE.BoxGeometry(0.6, 0.35, 1.6), mats.wood); trail.position.set(0, 0.4, 2.3); group.add(trail);
  for (const sx of [-1, 1]) {
    const wheel = mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.25, 16), mats.gold); wheel.rotation.z = Math.PI / 2; wheel.position.set(sx * 1.3, 0.9, 0.3); group.add(wheel);
    const tyre = mesh(new THREE.TorusGeometry(0.9, 0.09, 8, 20), mats.dark); tyre.rotation.y = Math.PI / 2; tyre.position.set(sx * 1.3, 0.9, 0.3); group.add(tyre);
    for (let i = 0; i < 4; i++) { const sp = mesh(new THREE.BoxGeometry(0.1, 1.7, 0.1), mats.red); sp.rotation.x = i * Math.PI / 4; sp.position.set(sx * 1.3, 0.9, 0.3); group.add(sp); }
    const bracket = mesh(new THREE.BoxGeometry(0.25, 2.0, 0.6), mats.dark); bracket.position.set(sx * 0.95, 1.7, 0); group.add(bracket);
  }
  // barrel pivots on the trunnion
  const barrel = new THREE.Group();
  barrel.position.set(0, 2.6, 0);
  const tube = mesh(new THREE.CylinderGeometry(0.62, 0.72, 4.2, 18), mats.red); tube.rotation.x = Math.PI / 2; tube.position.z = -1.2; barrel.add(tube);
  // the breech is its own part: packing the powder pushes it back
  const breech = new THREE.Group();
  const breechBall = mesh(new THREE.SphereGeometry(0.76, 14, 10), mats.red); breech.add(breechBall);
  const knob = mesh(new THREE.SphereGeometry(0.22, 8, 6), mats.gold); knob.position.z = 0.8; breech.add(knob);
  const collar = mesh(new THREE.TorusGeometry(0.72, 0.08, 8, 20), mats.gold); collar.position.z = -0.35; breech.add(collar);
  breech.position.z = 0.9;
  barrel.add(breech);
  const mouth = mesh(new THREE.TorusGeometry(0.64, 0.1, 8, 20), mats.gold); mouth.position.z = -3.3; barrel.add(mouth);
  const bore = mesh(new THREE.CircleGeometry(0.58, 18), mats.dark); bore.position.z = -3.31; bore.rotation.y = Math.PI; barrel.add(bore);
  for (const z of [-2.2, -0.6, 0.5]) { const band = mesh(new THREE.TorusGeometry(0.7, 0.07, 8, 20), mats.gold); band.position.z = z; barrel.add(band); }
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Shape(); for (let k = 0; k < 10; k++) { const r = k % 2 ? 0.1 : 0.24; const a = k * Math.PI / 5 - Math.PI / 2; k ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); } s.closePath();
    const star = mesh(new THREE.ShapeGeometry(s), mats.white); star.position.set(0, 0.66, -1.5 + i * 0.7); star.rotation.x = -Math.PI / 2; barrel.add(star);
  }
  const flash = mesh(new THREE.SphereGeometry(1.2, 10, 8), mats.flash); flash.position.z = -3.6; barrel.add(flash);
  group.add(barrel);

  let charge = 0, recoil = 0, flashT = 0;
  const baseElev = 0.42;
  const dir = new THREE.Vector3();

  const cannon: Cannon = {
    group, barrel,
    setCharge(p) { charge = p; },
    muzzle(out, d) {
      out.set(0, 0, -3.4).applyMatrix4(barrel.matrixWorld);
      d.set(0, 0, -1).transformDirection(barrel.matrixWorld);
    },
    fire() { recoil = 1; flashT = 1; },
    update(dt, t) {
      recoil = Math.max(0, recoil - dt * 2.2);
      flashT = Math.max(0, flashT - dt * 5);
      void t;
      barrel.rotation.x = baseElev + charge * 0.22 + recoil * 0.1;
      barrel.position.z = recoil * 0.5;
      breech.position.z = 0.9 + charge * 0.5;
      group.position.z = 0.6 + recoil * 0.25;
      (mats.flash as THREE.MeshBasicMaterial).opacity = flashT * 0.9;
      flash.scale.setScalar(0.6 + (1 - flashT) * 1.4);
      barrel.updateMatrixWorld(true);
      void dir;
    },
    dispose() { for (const g of geos) g.dispose(); for (const m of Object.values(mats)) m.dispose(); },
  };
  group.position.set(0, 0, 0.6);
  cannon.update(0, 0);
  return cannon;
}
