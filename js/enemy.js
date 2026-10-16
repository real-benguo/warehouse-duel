// ============================================================
//  敌人 AI：感知 → 交战 → 走位找掩体 → 换弹
// ============================================================

import * as THREE from 'three';
import { CFG, BOT_WEAPONS, clamp, lerp, damp, rand, randInt, D2R } from './config.js';
import { rayAABB } from './world.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

// 局部空间的命中盒（模型朝 -Z，站在 y=0）
const HITBOXES = [
  { part: 'head', min: [-0.14, 1.50, -0.16], max: [0.14, 1.79, 0.16], mul: 1.0 },
  { part: 'body', min: [-0.26, 0.95, -0.20], max: [0.26, 1.50, 0.22], mul: 1.0 },
  { part: 'legs', min: [-0.22, 0.00, -0.16], max: [0.22, 0.95, 0.18], mul: 0.78 },
];

export class Enemy {
  constructor(world, quality) {
    this.world = world;
    this.quality = quality;
    this.gltf = world.enemyGltf;

    this.root = this.gltf.scene.clone(true);
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = !!quality.shadows;
        o.receiveShadow = false;
        o.frustumCulled = false;
      }
    });
    this.nodes = {};
    for (const n of ['upper', 'leg_u_L', 'leg_u_R', 'leg_l_L', 'leg_l_R',
                     'foot_L', 'foot_R', 'head', 'enemy_rifle']) {
      this.nodes[n] = this.root.getObjectByName(n) || null;
    }

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.hp = CFG.bot.hp;
    this.alive = false;
    this.onGround = true;

    this.phase = 0;
    this.moveAmt = 0;
    this.state = 'idle';
    this.aimErr = 0;
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.seeTimer = 0;
    this.lostTimer = 0;
    this.fireCd = 0;
    this.burstLeft = 0;
    this.burstCd = 0;
    this.strafe = 1;
    this.strafeCd = 0;
    this.reloadT = 0;
    this.mag = 0;
    this.deadT = 0;
    this.fall = 0;
    this.lastSeen = new THREE.Vector3();
    this.hasSeen = false;
    this.stuckT = 0;
    this.wanderT = 0;

    this.weaponId = CFG.bot.weapon;
    this.weapon = BOT_WEAPONS[this.weaponId];

    this.world.scene.add(this.root);
    this.root.visible = false;
  }

  setWeapon(id) {
    if (!BOT_WEAPONS[id]) return;
    this.weaponId = id;
    this.weapon = BOT_WEAPONS[id];
    this.mag = this.weapon.mag;
  }

  spawn(pos, yaw, weaponId) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.hp = CFG.bot.hp;
    this.alive = true;
    this.root.visible = true;
    this.root.position.copy(pos);
    this.root.rotation.set(0, yaw, 0);
    this.nodes.upper && this.nodes.upper.rotation.set(0, 0, 0);
    this.deadT = 0;
    this.fall = 0;
    this.phase = 0;
    this.moveAmt = 0;
    this.state = 'idle';
    this.fireCd = 0.6;
    this.burstLeft = 0;
    this.burstCd = 0.4;
    this.seeTimer = 0;
    this.lostTimer = 0;
    this.hasSeen = false;
    this.stuckT = 0;
    this.wanderT = 0;
    this.aimYaw = yaw;
    this.aimPitch = 0;
    if (weaponId) this.setWeapon(weaponId);
    this.mag = this.weapon.mag;
    this.reloadT = 0;
  }

  die() {
    this.alive = false;
    this.deadT = 0;
    this.state = 'dead';
  }

  /** 眼睛位置 */
  eye(out) {
    return out.set(this.pos.x, this.pos.y + 1.60, this.pos.z);
  }

  chest(out) {
    return out.set(this.pos.x, this.pos.y + 1.22, this.pos.z);
  }

  // ---------------------------------------------------------- 感知
  canSee(targetEye) {
    const eye = this.eye(_v);
    const to = _v2.copy(targetEye).sub(eye);
    const dist = to.length();
    if (dist > CFG.bot.sight) return false;
    to.multiplyScalar(1 / dist);
    // 视野角（背对时看不到）
    const fwd = _v3.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const dot = fwd.x * to.x + fwd.z * to.z;
    const half = Math.cos((CFG.bot.fov * 0.5) * D2R);
    if (dot < half && dist > 4.0) return false;
    return this.world.hasLineOfSight(eye, targetEye);
  }

  // ---------------------------------------------------------- 每帧
  update(dt, ctx) {
    if (!this.alive) {
      this.deadT += dt;
      this.fall = Math.min(1, this.fall + dt * 3.4);
      const f = this.fall * this.fall * (3 - 2 * this.fall);
      this.root.rotation.set(-Math.PI * 0.5 * f, this.yaw, 0, 'YXZ');
      this.root.position.set(this.pos.x, this.pos.y + 0.10 * (1 - f) - 0.10 * f,
                             this.pos.z);
      this.root.visible = this.deadT < 6.0;
      return;
    }

    const w = this.weapon;
    const playerEye = ctx.playerEye;
    const dist = this.pos.distanceTo(ctx.playerPos);
    const visible = this.canSee(playerEye);

    if (visible) {
      this.lastSeen.copy(ctx.playerPos);
      this.hasSeen = true;
      this.lostTimer = 0;
      this.seeTimer += dt;
    } else {
      this.seeTimer = 0;
      this.lostTimer += dt;
    }

    // ---- 状态机 ----
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.mag = w.mag;
      this.state = 'reload';
    } else if (visible && dist < CFG.bot.sight * 0.95) {
      this.state = dist > 13 ? 'engage' : (dist < 4.5 ? 'retreat' : 'engage');
    } else if (this.hasSeen && this.lostTimer < 3.2) {
      this.state = 'hunt';
    } else {
      this.state = 'patrol';
    }

    // ---- 瞄准 ----
    const wantYaw = Math.atan2(-(playerEye.x - this.pos.x), -(playerEye.z - this.pos.z));
    const dy = playerEye.y - (this.pos.y + 1.60);
    const dxz = Math.hypot(playerEye.x - this.pos.x, playerEye.z - this.pos.z);
    const wantPitch = Math.atan2(dy, dxz);

    const aimSpeed = (this.state === 'engage' || this.state === 'retreat')
      ? 9.5 / Math.max(0.15, CFG.bot.aimTime) * 0.30 : 2.6;
    this.aimYaw = dampAngle(this.aimYaw, wantYaw, aimSpeed, dt);
    this.aimPitch = damp(this.aimPitch, wantPitch, aimSpeed, dt);

    this.yaw = this.aimYaw;

    // ---- 移动 ----
    let mx = 0, mz = 0;
    const seen = this.hasSeen;
    if (this.state === 'engage') {
      this.strafeCd -= dt;
      if (this.strafeCd <= 0) {
        this.strafe = Math.random() < 0.5 ? -1 : 1;
        this.strafeCd = rand(0.8, 1.9);
      }
      // 保持中距离
      const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
      const toward = dist > 11 ? 1 : dist < 5.5 ? -1 : 0;
      const rightX = Math.cos(this.yaw), rightZ = -Math.sin(this.yaw);
      mx = fwdX * toward + rightX * this.strafe * 0.85;
      mz = fwdZ * toward + rightZ * this.strafe * 0.85;
    } else if (this.state === 'retreat') {
      mx = Math.sin(this.yaw);
      mz = Math.cos(this.yaw);
      this.strafeCd -= dt;
      if (this.strafeCd <= 0) { this.strafe = -this.strafe; this.strafeCd = rand(0.5, 1.1); }
      mx += Math.cos(this.yaw) * this.strafe * 0.7;
      mz += -Math.sin(this.yaw) * this.strafe * 0.7;
    } else if (seen) {
      const t = this.lastSeen;
      mx = t.x - this.pos.x; mz = t.z - this.pos.z;
    } else {
      // 巡逻：朝玩家大致方向靠拢（没视线所以不开火，但会主动找上门）
      this.wanderT += dt;
      mx = ctx.playerPos.x - this.pos.x + Math.sin(this.wanderT * 0.8) * 3.5;
      mz = ctx.playerPos.z - this.pos.z + Math.cos(this.wanderT * 0.8) * 3.5;
    }

    const ml = Math.hypot(mx, mz);
    let speed = CFG.bot.speed * (this.state === 'engage' ? 0.92 : 1.0);
    if (ml > 1e-4) { mx /= ml; mz /= ml; } else { mx = mz = 0; }

    // 避障：直走被挡就左右绕
    if (mx || mz) {
      const chosen = this._avoid(mx, mz);
      mx = chosen.x; mz = chosen.y;
      if (!mx && !mz) speed = 0;
    }

    const accel = 24;
    this.vel.x = damp(this.vel.x, mx * speed, accel * 0.4, dt);
    this.vel.z = damp(this.vel.z, mz * speed, accel * 0.4, dt);
    this.vel.y += CFG.player.gravity * dt;

    // 积分 + 碰撞
    const before = _v.copy(this.pos);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.world.resolveCircle(this.pos, 0.40, this.pos.y + 0.05, this.pos.y + 1.7);
    this.world.clampToBounds(this.pos, 0.45);

    this.pos.y += this.vel.y * dt;
    const gy = this.world.groundY(this.pos, 0.40, this.pos.y + 0.05, CFG.player.step);
    if (this.pos.y <= gy) { this.pos.y = gy; this.vel.y = 0; this.onGround = true; }
    else this.onGround = false;

    // 卡住检测：先换个方向绕，绕不开就兜底挪到玩家附近一块有视线的空地
    const moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    if ((mx || mz) && moved < 0.006) {
      this.stuckT += dt;
      if (this.stuckT > 0.7 && this.stuckT <= 2.2) {
        this.strafe = -this.strafe;
        this.strafeCd = rand(0.6, 1.2);
      }
      if (this.stuckT > 2.2) {
        this._unstick(ctx);
        this.stuckT = 0;
      }
    } else this.stuckT = 0;

    // ---- 开火 ----
    const realSpeed = Math.hypot(this.vel.x, this.vel.z);
    this.fireCd -= dt;
    this.burstCd -= dt;

    if (this.state === 'engage' && visible && this.reloadT <= 0) {
      if (this.mag <= 0) {
        this.reloadT = w.reload;
      } else if (this.burstLeft > 0) {
        if (this.fireCd <= 0) {
          this._shoot(ctx, dist, realSpeed);
          this.burstLeft--;
          this.fireCd = 60 / w.rpm;
          if (this.burstLeft <= 0) {
            this.burstCd = rand(CFG.bot.burstGap[0], CFG.bot.burstGap[1]);
          }
        }
      } else if (this.burstCd <= 0 && this.seeTimer >= CFG.bot.reaction) {
        this.burstLeft = randInt(w.burst[0], w.burst[1]);
        this.fireCd = 0;
      }
    } else if (this.state !== 'engage' && this.mag < w.mag * 0.35 && this.reloadT <= 0) {
      this.reloadT = w.reload;
    }

    this._animate(dt, realSpeed);
  }

  /** 简单避障：从期望方向开始，左右试探，找一条不被挡的 */
  _avoid(dx, dz) {
    const eye = _v.set(this.pos.x, this.pos.y + 0.9, this.pos.z);
    const probe = 1.5;
    const angles = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.1, -2.1, 3.14];
    for (const a of angles) {
      const c = Math.cos(a), s = Math.sin(a);
      const nx = dx * c - dz * s;
      const nz = dx * s + dz * c;
      _v2.set(nx, 0, nz).normalize();
      if (!this.world.raycast(eye, _v2, probe)) return { x: nx, y: nz };
    }
    // 四面八方都被挡：往反方向退，别原地卡死
    return { x: -dx, y: -dz };
  }

  /** 兜底：在玩家周围找一个不卡墙、有视线的位置直接挪过去 */
  _unstick(ctx) {
    const V = this.pos.constructor;
    const p = ctx.playerPos;
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(6, 14);
      const c = new V(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r);
      this.world.clampToBounds(c, 0.6);
      const test = c.clone();
      this.world.resolveCircle(test, 0.48, 0.05, 1.7);
      if (test.distanceTo(c) > 0.02) continue;          // 卡在碰撞体里
      const eye = new V(c.x, 1.6, c.z);
      const tgt = new V(p.x, p.y + 1.62, p.z);
      if (!this.world.hasLineOfSight(eye, tgt)) continue;
      this.pos.copy(c);
      this.vel.set(0, 0, 0);
      this.root.position.copy(c);
      return true;
    }
    return false;
  }

  _shoot(ctx, dist, moveSpeed) {
    const w = this.weapon;
    this.mag--;

    let err = CFG.bot.aimErr + CFG.bot.aimErrDist * dist;
    if (moveSpeed > 1.5) err += CFG.bot.aimErrMove;
    if (ctx.playerMoving) err += CFG.bot.aimErrMove * 0.8;
    if (this.state === 'retreat') err += 1.6;
    err *= 1 / Math.max(0.4, this.seeTimer / CFG.bot.aimTime > 1 ? 1.6 : 0.85);

    const eye = this.eye(_v3).clone();
    const target = _v.copy(ctx.playerEye).add(_v2.set(
      rand(-0.35, 0.35), rand(-0.28, 0.28), rand(-0.35, 0.35)));
    const dir = target.sub(eye).normalize();

    // 把误差摊到锥面上
    const right = _v2.set(-dir.z, 0, dir.x).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * err * D2R;
    dir.addScaledVector(right, Math.cos(a) * r)
       .addScaledVector(up, Math.sin(a) * r).normalize();

    if (ctx.onEnemyShoot) {
      ctx.onEnemyShoot({
        origin: eye, dir, dmg: w.dmg, pellets: w.pellets,
        spread: w.pellets > 1 ? w.spread : 0, sfx: w.sfx,
        from: this.pos.clone(),
      });
    }
  }

  _animate(dt, speed) {
    const amt = clamp(speed / 4.4, 0, 1.3);
    this.moveAmt = damp(this.moveAmt, amt, 8, dt);
    this.phase += dt * (3.0 + speed * 1.5);

    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const A = 0.60 * this.moveAmt;

    if (this.nodes.leg_u_L) this.nodes.leg_u_L.rotation.x = s * A;
    if (this.nodes.leg_u_R) this.nodes.leg_u_R.rotation.x = -s * A;
    if (this.nodes.leg_l_L) this.nodes.leg_l_L.rotation.x = Math.max(0, -s - 0.25) * 0.95 * this.moveAmt;
    if (this.nodes.leg_l_R) this.nodes.leg_l_R.rotation.x = Math.max(0, s - 0.25) * 0.95 * this.moveAmt;
    if (this.nodes.foot_L) this.nodes.foot_L.rotation.x = -s * 0.30 * this.moveAmt;
    if (this.nodes.foot_R) this.nodes.foot_R.rotation.x = s * 0.30 * this.moveAmt;

    const bob = Math.abs(c) * 0.035 * this.moveAmt;
    this.root.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    this.root.rotation.set(0, this.yaw, 0);
    if (this.nodes.upper) {
      this.nodes.upper.rotation.x = clamp(-this.aimPitch * 0.55, -0.32, 0.32);
      this.nodes.upper.rotation.z = Math.sin(this.phase) * 0.045 * this.moveAmt;
    }
  }

  // ---------------------------------------------------------- 被击中
  /**
   * 射线检测（世界空间）。返回 {t, part, mul} 或 null
   * 敌人只绕 Y 旋转，所以把射线变换到局部空间即可精确求交。
   */
  rayHit(origin, dir, maxT) {
    if (!this.alive) return null;
    const c = Math.cos(-this.yaw), s = Math.sin(-this.yaw);
    const ox = origin.x - this.pos.x, oy = origin.y - this.pos.y, oz = origin.z - this.pos.z;
    // 绕 Y 反向旋转
    const lox = ox * c + oz * s;
    const loz = -ox * s + oz * c;
    const ldx = dir.x * c + dir.z * s;
    const ldz = -dir.x * s + dir.z * c;
    const o = { x: lox, y: oy, z: loz };
    const d = { x: ldx, y: dir.y, z: ldz };

    let best = null;
    for (const hb of HITBOXES) {
      const r = rayAABB(o, d, { x: hb.min[0], y: hb.min[1], z: hb.min[2] },
                        { x: hb.max[0], y: hb.max[1], z: hb.max[2] }, maxT);
      if (r && (!best || r.t < best.t)) {
        best = { t: r.t, part: hb.part, mul: hb.mul };
      }
    }
    return best;
  }
}

function dampAngle(a, b, lambda, dt) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-lambda * dt));
}
