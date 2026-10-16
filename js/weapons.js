// ============================================================
//  武器系统：视图模型、开火节奏、后坐力、开镜、换弹、枪口火焰、曳光弹
// ============================================================

import * as THREE from 'three';
import { WEAPONS, WEAPON_BY_ID, clamp, lerp, damp, rand, D2R } from './config.js';
import * as SFX from './audio.js';

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

export class WeaponSystem {
  constructor(world, camera, quality) {
    this.world = world;
    this.camera = camera;
    this.quality = quality;

    // 视图模型容器（挂在相机下，跟着相机走）
    this.root = new THREE.Group();
    this.root.renderOrder = 10;
    camera.add(this.root);

    this.models = {};
    this.index = 0;
    this.ammo = {};
    for (const w of WEAPONS) this.ammo[w.id] = { mag: w.mag, reserve: Infinity };

    this.ads = 0;
    this.adsTarget = 0;
    this.cooldown = 0;
    this.reloading = false;
    this.reloadT = 0;
    this.pumpT = 0;                 // 泵动/拉栓动作剩余时间
    this.bobT = 0;
    this.bobAmp = 0;
    this.sway = { x: 0, y: 0 };
    this.kick = { pos: new THREE.Vector3(), rot: new THREE.Vector3(), vel: new THREE.Vector3() };
    this.raise = 0;                 // 换枪抬起动画
    this.enabled = true;

    this.onShot = null;             // (weapon, dirs[]) => void
    this.onDryFire = null;

    this._buildEffects();
  }

  // ---------------------------------------------------------- 初始化
  attachModels() {
    const src = this.world.weaponScene;
    if (!src) return;
    for (const w of WEAPONS) {
      const node = src.getObjectByName(w.node);
      if (!node) { console.warn('缺少武器节点', w.node); continue; }
      node.visible = false;
      node.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = false;
          o.receiveShadow = false;
          o.frustumCulled = false;
          // 双面：瞄具筒是空心的，只有双面渲染才能看到"筒壁"，形成正确的瞄准画面
          if (o.material) o.material.side = THREE.DoubleSide;
        }
      });
      this.root.add(node);
      this.models[w.id] = node;
    }
    this._applyTransform(1);
    this._showCurrent(true);
  }

  _buildEffects() {
    // 枪口火焰：一张加色混合的贴图
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,235,1)');
    grd.addColorStop(0.28, 'rgba(255,214,130,0.92)');
    grd.addColorStop(0.62, 'rgba(255,140,40,0.40)');
    grd.addColorStop(1, 'rgba(255,90,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;

    this.flashMat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, opacity: 0,
    });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), this.flashMat);
    this.flash.renderOrder = 20;
    this.flash.visible = false;
    this.root.add(this.flash);

    this.flashLight = new THREE.PointLight(0xffcf8a, 0, 9, 2);
    this.root.add(this.flashLight);

    // 曳光弹池
    this.tracers = [];
    const tg = new THREE.PlaneGeometry(1, 1);
    const tm = new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: 0, side: THREE.DoubleSide,
    });
    for (let i = 0; i < 22; i++) {
      const m = new THREE.Mesh(tg, tm.clone());
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 15;
      this.world.scene.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }
  }

  // ---------------------------------------------------------- 状态查询
  get current() { return WEAPONS[this.index]; }
  get ammoNow() { return this.ammo[this.current.id]; }

  select(i, silent) {
    i = ((i % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
    if (i === this.index) return;
    this.index = i;
    this.reloading = false;
    this.reloadT = 0;
    this.pumpT = 0;
    this.cooldown = Math.max(this.cooldown, 0.22);
    this.raise = 1;
    this.ads = 0;
    this._showCurrent();
    if (!silent) SFX.reloadClick(0);
  }

  _showCurrent() {
    for (const w of WEAPONS) {
      const m = this.models[w.id];
      if (m) m.visible = (w.id === this.current.id);
    }
    const a = this.world.weaponAnchors && this.world.weaponAnchors[this.current.id];
    this.anchor = a || { muzzle: [0, 0.01, -0.7], sight: [0, 0.06, -0.2] };
  }

  resetAll() {
    for (const w of WEAPONS) this.ammo[w.id] = { mag: w.mag, reserve: Infinity };
    this.reloading = false; this.reloadT = 0; this.cooldown = 0;
    this.ads = 0; this.adsTarget = 0; this.pumpT = 0;
    this.kick.pos.set(0, 0, 0); this.kick.rot.set(0, 0, 0); this.kick.vel.set(0, 0, 0);
    this.raise = 0;
  }

  // ---------------------------------------------------------- 每帧
  update(dt, ctx) {
    const w = this.current;
    const am = this.ammoNow;

    // 换枪抬起
    if (this.raise > 0) this.raise = Math.max(0, this.raise - dt * 4.2);

    // 开镜
    const wantAds = this.enabled && ctx.aiming && !this.reloading;
    this.adsTarget = wantAds ? 1 : 0;
    const rate = 1 / Math.max(0.05, w.adsTime);
    this.ads = clamp(this.ads + (this.adsTarget - this.ads) * clamp(rate * dt * 2.4, 0, 1),
                     0, 1);

    // 换弹
    if (this.reloading) {
      this.reloadT += dt;
      if (this.reloadT >= w.reload) {
        const need = w.mag - am.mag;
        am.mag = w.mag;
        am.reserve = Infinity;
        this.reloading = false;
        this.reloadT = 0;
        SFX.reloadDone();
      }
    }

    // 开火冷却
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.pumpT > 0) this.pumpT -= dt;

    // 是否要开火
    if (this.enabled && ctx.firing && !this.reloading && this.pumpT <= 0 && this.cooldown <= 0) {
      if (am.mag > 0) {
        this._fire(w, ctx);
      } else {
        if (this.cooldown <= 0) { SFX.dryFire(); this.cooldown = 0.28; }
        if (this.onDryFire) this.onDryFire();
        this._autoReload();
      }
    }

    // 手动换弹
    if (ctx.reload && !this.reloading && am.mag < w.mag) this._autoReload();

    // 走路摇摆
    const speed = Math.hypot(ctx.vel.x, ctx.vel.z);
    const t = this.ads > 0.5 ? 0.25 : 1;
    this.bobT += dt * (4.6 + speed * 1.15);
    const targetAmp = clamp(speed / 5.4, 0, 1.3) * t;
    this.bobAmp = damp(this.bobAmp, targetAmp, 8, dt);

    // 视角拖动惯性
    this.sway.x = damp(this.sway.x, clamp(-ctx.lookVel.x * 0.055, -0.05, 0.05), 9, dt);
    this.sway.y = damp(this.sway.y, clamp(ctx.lookVel.y * 0.055, -0.05, 0.05), 9, dt);

    // 后坐力回弹
    const k = 34, d = 13;
    this.kick.vel.x += (-this.kick.pos.x * k - this.kick.vel.x * d) * dt;
    this.kick.vel.y += (-this.kick.pos.y * k - this.kick.vel.y * d) * dt;
    this.kick.vel.z += (-this.kick.pos.z * k - this.kick.vel.z * d) * dt;
    this.kick.pos.x += this.kick.vel.x * dt;
    this.kick.pos.y += this.kick.vel.y * dt;
    this.kick.pos.z += this.kick.vel.z * dt;
    this.kick.rot.x = damp(this.kick.rot.x, 0, 14, dt);
    this.kick.rot.y = damp(this.kick.rot.y, 0, 14, dt);
    this.kick.rot.z = damp(this.kick.rot.z, 0, 14, dt);

    // 枪口火焰衰减
    if (this.flash.visible) {
      this.flashMat.opacity -= dt * 26;
      this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 78);
      if (this.flashMat.opacity <= 0) { this.flash.visible = false; this.flashMat.opacity = 0; }
    }

    // 曳光弹衰减
    for (const tr of this.tracers) {
      if (tr.life > 0) {
        tr.life -= dt;
        tr.mesh.material.opacity = Math.max(0, tr.life * 16);
        if (tr.life <= 0) tr.mesh.visible = false;
      }
    }

    this._applyTransform(dt, ctx);

    // 带瞄准镜的枪完全开镜时把模型藏掉，否则相机正好卡在目镜里、糊一片黑
    const mdl = this.models[w.id];
    if (mdl) {
      if (w.scope) mdl.visible = this.ads < 0.86;
      else if (!mdl.visible) mdl.visible = true;
    }
  }

  _autoReload() {
    const w = this.current, am = this.ammoNow;
    if (this.reloading || am.mag >= w.mag) return;
    this.reloading = true;
    this.reloadT = 0;
    SFX.reloadClick(0);
    setTimeout(() => { if (this.reloading) SFX.reloadClick(1); }, w.reload * 450);
    setTimeout(() => { if (this.reloading) SFX.reloadClick(2); }, w.reload * 780);
  }

  _fire(w, ctx) {
    const am = this.ammoNow;
    am.mag--;
    this.cooldown = 60 / w.rpm;
    if (!w.auto) this.cooldown = Math.max(this.cooldown, 0.07);
    if (w.id === 'shotgun' || w.id === 'sniper') this.pumpT = w.id === 'sniper' ? 0.62 : 0.42;

    // 散布
    const moveFactor = clamp(Math.hypot(ctx.vel.x, ctx.vel.z) / 5.4, 0, 1.4);
    let spread = lerp(w.spreadHip, w.spreadAds, this.ads);
    spread += w.spreadMove * moveFactor * (1 - this.ads * 0.55);
    if (!ctx.onGround) spread += w.spreadAir;
    spread = Math.max(0.02, spread);

    const dirs = [];
    for (let i = 0; i < w.pellets; i++) {
      const d = _v.copy(ctx.forward).clone();
      if (w.pellets > 1) {
        // 霰弹：在锥内均匀撒
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * spread * D2R;
        applyCone(d, ctx.right, ctx.up, Math.cos(a) * r, Math.sin(a) * r);
      } else {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * spread * D2R;
        applyCone(d, ctx.right, ctx.up, Math.cos(a) * r, Math.sin(a) * r);
      }
      dirs.push(d);
    }

    // 视觉后坐力
    this.kick.pos.z += 0.028;
    this.kick.pos.y += 0.006;
    this.kick.vel.z += 0.55;
    this.kick.rot.x -= w.recoilPitch * D2R * 0.55;
    this.kick.rot.y += rand(-1, 1) * w.recoilYaw * D2R * 0.6;

    this._muzzleFlash(w);
    SFX.gunshot(w.sfx, 0);

    if (this.onShot) this.onShot(w, dirs, spread);
  }

  _muzzleFlash(w) {
    const m = this.anchor.muzzle;
    this.flash.position.set(m[0], m[1], m[2] + 0.06);
    const s = (0.16 + 0.20 * Math.random()) * (w.muzzle || 1);
    this.flash.scale.set(s, s, s);
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flashMat.opacity = 0.95;
    this.flash.visible = true;
    this.flashLight.position.set(m[0], m[1], m[2] - 0.1);
    this.flashLight.intensity = 16 * (w.muzzle || 1);
  }

  /** 从枪口到命中点画一条曳光 */
  tracer(fromWorld, toWorld) {
    const tr = this.tracers.find((t) => t.life <= 0);
    if (!tr) return;
    const mid = _v.copy(fromWorld).add(toWorld).multiplyScalar(0.5);
    const dir = toWorld.clone().sub(fromWorld);
    const len = dir.length();
    if (len < 0.2) return;
    tr.mesh.position.copy(mid);
    tr.mesh.scale.set(0.022, len, 1);
    tr.mesh.quaternion.copy(_q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    tr.mesh.visible = true;
    tr.mesh.material.opacity = 0.85;
    tr.life = 0.075;
  }

  muzzleWorldPos(out) {
    const m = this.anchor.muzzle;
    return out.set(m[0], m[1], m[2]).applyMatrix4(this.root.matrixWorld);
  }

  /** 把视图模型摆到正确位置（含开镜插值、摇摆、后坐） */
  _applyTransform(dt, ctx) {
    const w = this.current;
    const t = this.ads;
    const e = t * t * (3 - 2 * t);

    const px = lerp(w.vm.pos[0], w.ads.pos[0], e);
    const py = lerp(w.vm.pos[1], w.ads.pos[1], e);
    const pz = lerp(w.vm.pos[2], w.ads.pos[2], e);

    const bob = this.bobAmp;
    const bobX = Math.cos(this.bobT) * 0.012 * bob;
    const bobY = Math.abs(Math.sin(this.bobT)) * 0.011 * bob;

    const raiseOff = this.raise * 0.30;

    this.root.position.set(
      px + bobX + this.sway.x + this.kick.pos.x,
      py - bobY + this.sway.y + this.kick.pos.y - raiseOff,
      pz + this.kick.pos.z,
    );
    this.root.rotation.set(
      this.kick.rot.x + bobY * 1.1,
      this.kick.rot.y + (1 - e) * w.vm.rot[1] * D2R,
      this.kick.rot.z + (1 - e) * this.sway.x * 1.2 + this.raise * 0.55,
    );
  }
}

function applyCone(dir, right, up, dx, dy) {
  dir.addScaledVector(right, dx).addScaledVector(up, dy).normalize();
}
