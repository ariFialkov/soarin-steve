/** Lightweight pooled particle system (instanced camera-facing quads). */
import * as THREE from 'three';

interface Particle {
  alive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  size: number; endSize: number;
  color: THREE.Color;
  drag: number; gravity: number;
  spin: number; rot: number;
  shrink: boolean;
}

export interface EmitOpts {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spread?: number;        // random velocity added in every axis
  count?: number;
  life?: number;
  size?: number;
  endSize?: number;
  colors?: (number | string)[];
  drag?: number;
  gravity?: number;
  spin?: number;
}

export class ParticleSystem {
  readonly mesh: THREE.InstancedMesh;
  private pool: Particle[] = [];
  private dummy = new THREE.Object3D();
  private quat = new THREE.Quaternion();

  constructor(max = 900) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    for (let i = 0; i < max; i++) {
      this.pool.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 0.1, endSize: 0, color: new THREE.Color(), drag: 0, gravity: 0, spin: 0, rot: 0, shrink: true });
    }
  }

  emit(o: EmitOpts): void {
    const n = o.count ?? 10;
    const spread = o.spread ?? 0.5;
    const colors = o.colors ?? [0xffffff];
    let made = 0;
    for (const p of this.pool) {
      if (p.alive) continue;
      p.alive = true;
      p.x = o.pos.x; p.y = o.pos.y; p.z = o.pos.z;
      p.vx = o.vel.x + (Math.random() - 0.5) * 2 * spread;
      p.vy = o.vel.y + (Math.random() - 0.5) * 2 * spread;
      p.vz = o.vel.z + (Math.random() - 0.5) * 2 * spread;
      p.maxLife = p.life = (o.life ?? 1) * (0.7 + Math.random() * 0.6);
      p.size = (o.size ?? 0.1) * (0.7 + Math.random() * 0.6);
      p.endSize = o.endSize ?? 0;
      p.color.set(colors[Math.floor(Math.random() * colors.length)]);
      p.drag = o.drag ?? 1.5;
      p.gravity = o.gravity ?? 0;
      p.spin = (o.spin ?? 0) * (Math.random() - 0.5) * 2;
      p.rot = Math.random() * Math.PI * 2;
      if (++made >= n) break;
    }
  }

  update(dt: number, camera: THREE.Camera): void {
    camera.getWorldQuaternion(this.quat);
    let i = 0;
    const d = this.dummy;
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy *= k; p.vz *= k;
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.spin * dt;
      const t = 1 - p.life / p.maxLife;
      const s = p.size + (p.endSize - p.size) * t;
      d.position.set(p.x, p.y, p.z);
      d.quaternion.copy(this.quat);
      d.rotateZ(p.rot);
      d.scale.setScalar(Math.max(0.0001, s));
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
      this.mesh.setColorAt(i, p.color);
      i++;
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    for (const p of this.pool) p.alive = false;
    this.mesh.count = 0;
  }
}
