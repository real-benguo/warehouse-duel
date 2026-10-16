// ============================================================
//  游戏主逻辑：玩家控制、射击判定、回合制、特效、主循环
// ============================================================

import * as THREE from 'three';
import { CFG, WEAPONS, WEAPON_BY_ID, clamp, lerp, damp, rand, D2R } from './config.js';
import { World, rayAABB } from './world.js';
import { WeaponSystem } from './weapons.js';
import { createOpponent } from './net.js';
import * as SFX from './audio.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

const ST = { IDLE: 'idle', COUNT: 'count', LIVE: 'live', ROUNDEND: 'roundend', MATCHEND: 'matchend' };

export class Game {
  constructor({ canvas, quality, input, hud, mode }) {
    this.canvas = canvas;
    this.quality = quality;
    this.input = input;
    this.hud = hud;
    this.mode = mode;

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: quality.antialias, powerPreference: 'high-performance',
      stencil: false, alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = !!quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(
      CFG.player.fovBase, 1, 0.05, 150);
    this.camera.rotation.order = 'YXZ';

    this.world = new World(quality);
    this.weapons = null;
    this.opponent = null;

    this.player = {
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      yaw: 0, pitch: 0,
      hp: CFG.player.maxHP,
      alive: true,
      onGround: true,
      recoverAcc: 0,
      stepDist: 0,
      shake: 0,
      hurtCd: 0,
    };

    this.round = { state: ST.IDLE, t: 0, me: 0, ai: 0, no: 1, endReason: '' };
    this.running = false;
    this.paused = false;
    this._last = 0;
    this._raf = 0;
    this._fpsAcc = 0;
    this._fpsN = 0;
    this.fps = 60;
    this.onMatchEnd = null;

    this._tmpBox = { min: new THREE.Vector3(), max: new THREE.Vector3() };
  }

  // ---------------------------------------------------------- 初始化
  async init(onProgress) {
    this.world.setupEnvironment(this.renderer);
    await this.world.load(onProgress);
    await this.world.loadWeapons();
    this.weapons = new WeaponSystem(this.world, this.camera, this.quality);
    this.weapons.attachModels();
    this.weapons.onShot = (w, dirs, spread) => this._onPlayerShot(w, dirs, spread);
    this.world.scene.add(this.camera);
    this.opponent = createOpponent(this.world, this.quality);
    this._buildEffects();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this._resize(), 220));
    return this;
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------- 特效池
  _buildEffects() {
    const mk = (color, size, opacity, additive) => {
      const g = new THREE.PlaneGeometry(1, 1);
      const m = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.world.scene.add(mesh);
      return mesh;
    };
    this.sparks = [];
    for (let i = 0; i < 26; i++) this.sparks.push({ m: mk(0xffd28a, 1, 0.9, true), life: 0 });
    this.decals = [];
    for (let i = 0; i < 48; i++) {
      const m = mk(0x0a0a0a, 1, 0.85, false);
      m.material.depthWrite = false;
      this.decals.push({ m, life: 0 });
    }
    this.bloods = [];
    for (let i = 0; i < 18; i++) this.bloods.push({ m: mk(0xa01818, 1, 0.9, false), life: 0 });
    this._decalIdx = 0;
  }

  _spark(pos, normal, scale = 1) {
    const s = this.sparks.find((x) => x.life <= 0);
    if (!s) return;
    s.m.position.copy(pos).addScaledVector(normal, 0.02);
    s.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    const k = (0.16 + Math.random() * 0.14) * scale;
    s.m.scale.set(k, k, k);
    s.m.material.opacity = 0.95;
    s.m.visible = true;
    s.life = 0.14;
  }

  _decal(pos, normal) {
    const d = this.decals[this._decalIdx++ % this.decals.length];
    d.m.position.copy(pos).addScaledVector(normal, 0.012);
    d.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    const k = 0.13 + Math.random() * 0.06;
    d.m.scale.set(k, k, k);
    d.m.material.opacity = 0.85;
    d.m.visible = true;
    d.life = 1e9;
  }

  _blood(pos) {
    const b = this.bloods.find((x) => x.life <= 0);
    if (!b) return;
    b.m.position.copy(pos);
    b.m.quaternion.copy(this.camera.quaternion);
    const k = 0.22 + Math.random() * 0.16;
    b.m.scale.set(k, k, k);
    b.m.material.opacity = 0.92;
    b.m.visible = true;
    b.life = 0.22;
  }

  _updateEffects(dt) {
    for (const s of this.sparks) {
      if (s.life > 0) {
        s.life -= dt;
        s.m.material.opacity = Math.max(0, s.life * 6.8);
        if (s.life <= 0) s.m.visible = false;
      }
    }
    for (const b of this.bloods) {
      if (b.life > 0) {
        b.life -= dt;
        b.m.material.opacity = Math.max(0, b.life * 4.2);
        if (b.life <= 0) b.m.visible = false;
      }
    }
  }

  _clearDecals() {
    for (const d of this.decals) { d.m.visible = false; d.life = 0; }
  }

  // ---------------------------------------------------------- 对局流程
  startMatch() {
    this.round.me = 0;
    this.round.ai = 0;
    this.round.no = 1;
    this.hud.buildDots(CFG.round.scoreToWin);
    this.hud.setScore(0, 0);
    this.startRound();
    this.running = true;
    this.paused = false;
    if (!this._raf) {
      this._last = performance.now();
      this._raf = requestAnimationFrame((t) => this._loop(t));
    }
  }

  startRound() {
    const sp = this.world.spawns;
    const a = sp[0], b = sp[1];

    this.player.pos.copy(a.pos);
    this.player.vel.set(0, 0, 0);
    this.player.yaw = a.yaw;
    this.player.pitch = 0;
    this.player.hp = CFG.player.maxHP;
    this.player.alive = true;
    this.player.onGround = true;
    this.player.recoverAcc = 0;
    this.player.stepDist = 0;
    this.player.shake = 0;

    this.weapons.resetAll();
    this.weapons.ads = 0;
    this._clearDecals();
    this.input.reset();

    const botWeapon = pickBotWeapon(this.round.no);
    this.opponent.spawn(b.pos, b.yaw, botWeapon);

    this.round.state = ST.COUNT;
    this.round.t = CFG.round.countdown;
    this.hud.reset();
    this.hud.setHP(this.player.hp, CFG.player.maxHP);
    this.hud.setWeapon(this.weapons.current.label);
    this.hud.setAmmo(this.weapons.ammoNow.mag, Infinity);
    this._lastCount = -1;
  }

  _endRound(winner, reason) {
    if (this.round.state === ST.ROUNDEND || this.round.state === ST.MATCHEND) return;
    this.round.state = ST.ROUNDEND;
    this.round.t = CFG.round.endDelay;
    this.round.endReason = reason;
    if (winner === 'me') { this.round.me++; SFX.roundWin(); }
    else { this.round.ai++; SFX.roundLose(); }
    this.hud.setScore(this.round.me, this.round.ai);
    this.hud.banner(winner === 'me' ? '本回合胜利' : '本回合失败', CFG.round.endDelay - 0.2);
    this.hud.feed(winner === 'me' ? '你击倒了 AI' : 'AI 击倒了你');
  }

  _endMatch() {
    this.round.state = ST.MATCHEND;
    const win = this.round.me > this.round.ai;
    this.hud.banner(win ? '胜 利' : '失 败', 3.0);
    if (this.onMatchEnd) this.onMatchEnd(win, this.round.me, this.round.ai);
  }

  pause() {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.input.releaseLock();
  }

  resume() {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this._last = performance.now();
    if (this.mode === 'desktop') this.input.requestLock();
  }

  stop() {
    this.running = false;
    this.paused = false;
    this.round.state = ST.IDLE;
    this.input.releaseLock();
  }

  // ---------------------------------------------------------- 主循环
  _loop(now) {
    this._raf = requestAnimationFrame((t) => this._loop(t));
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.10) dt = 0.10;
    if (dt <= 0) dt = 1 / 60;

    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc >= 0.5) { this.fps = this._fpsN / this._fpsAcc; this._fpsAcc = 0; this._fpsN = 0; }

    if (!this.paused) this._step(dt);
    this.renderer.render(this.world.scene, this.camera);
  }

  _step(dt) {
    const input = this.input;
    input.update();

    if (this.round.state === ST.COUNT) {
      this.round.t -= dt;
      const n = Math.ceil(this.round.t);
      if (n !== this._lastCount) {
        this._lastCount = n;
        if (n > 0) { this.hud.banner(String(n), 0.8); SFX.countdownBeep(false); }
      }
      if (this.round.t <= 0) {
        this.round.state = ST.LIVE;
        this.hud.banner('开 打', 0.8);
        SFX.countdownBeep(true);
        if (this.mode === 'desktop') input.requestLock();
      }
    } else if (this.round.state === ST.ROUNDEND) {
      this.round.t -= dt;
      if (this.round.t <= 0) {
        if (this.round.me >= CFG.round.scoreToWin || this.round.ai >= CFG.round.scoreToWin) {
          this._endMatch();
        } else {
          this.round.no++;
          this.startRound();
        }
      }
    }

    const live = this.round.state === ST.LIVE || this.round.state === ST.ROUNDEND;
    const canControl = this.round.state === ST.LIVE && this.player.alive;

    this._updatePlayer(dt, canControl);
    this._updateOpponent(dt, live);
    this.weapons.update(dt, this._weaponCtx(canControl));
    this._updateEffects(dt);
    this.hud.update(dt);

    // HUD 同步
    this.hud.setHP(this.player.hp, CFG.player.maxHP);
    const am = this.weapons.ammoNow;
    this.hud.setAmmo(am.mag, am.reserve);
    this.hud.setWeapon(this.weapons.current.label);
    this.hud.setReload(this.weapons.reloading
      ? this.weapons.reloadT / this.weapons.current.reload : 0);
    const spread = this._currentSpread();
    this.hud.setCrosshair(spread, this.weapons.ads);
    const scoped = !!this.weapons.current.scope && this.weapons.ads > 0.78;
    this.hud.setScope(scoped);
    this.hud.setRound('回合 ' + this.round.no,
      this.round.state === ST.LIVE ? '进 行 中'
        : this.round.state === ST.COUNT ? '准备' : '—');
  }

  _currentSpread() {
    const w = this.weapons.current;
    const sp = Math.hypot(this.player.vel.x, this.player.vel.z) / CFG.player.speed;
    let s = lerp(w.spreadHip, w.spreadAds, this.weapons.ads);
    s += w.spreadMove * clamp(sp, 0, 1.4) * (1 - this.weapons.ads * 0.55);
    if (!this.player.onGround) s += w.spreadAir;
    return s;
  }

  _weaponCtx(canControl) {
    return {
      aiming: canControl && this.input.aiming && this.player.onGround,
      firing: canControl && this.input.firing,
      reload: canControl && this.input.consumeReload(),
      vel: this.player.vel,
      onGround: this.player.onGround,
      lookVel: { x: this._lookX || 0, y: this._lookY || 0 },
      forward: this.camera.getWorldDirection(_v).clone(),
      right: _v2.setFromMatrixColumn(this.camera.matrixWorld, 0).clone(),
      up: _v3.setFromMatrixColumn(this.camera.matrixWorld, 1).clone(),
    };
  }

  // ---------------------------------------------------------- 玩家
  _updatePlayer(dt, canControl) {
    const p = this.player, input = this.input;

    // 视角
    const look = input.consumeLook();
    this._lookX = look.x; this._lookY = look.y;
    if (this.player.alive) {
      p.yaw -= look.x;
      p.pitch -= look.y;
      p.pitch = clamp(p.pitch, -88 * D2R, 88 * D2R);
    }

    // 后坐力回正
    if (p.recoverAcc > 0) {
      const rec = Math.min(p.recoverAcc, 7.6 * dt);
      p.pitch -= rec;
      p.recoverAcc -= rec;
    }

    // 换枪
    const swapTo = input.consumeSwapTo();
    if (canControl && swapTo >= 0) this.weapons.select(swapTo);
    const cycle = input.consumeSwapCycle();
    if (canControl && cycle) {
      this.weapons.select(this.weapons.index + (cycle > 0 ? 1 : -1));
      if (this.mode === 'mobile') {
        this.hud.showWheel(true, this.weapons.current.id);
        clearTimeout(this._wheelT);
        this._wheelT = setTimeout(() => this.hud.showWheel(false), 1200);
      }
    }

    // 跳跃
    if (canControl && input.consumeJump() && p.onGround) {
      p.vel.y = CFG.player.jump;
      p.onGround = false;
      SFX.footstep(0, 0.5);
    }

    // 移动
    let wx = 0, wz = 0;
    if (canControl) {
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      const mY = -input.moveY;    // W = -1 → 前进
      const mX = input.moveX;
      wx = fx * mY + rx * mX;
      wz = fz * mY + rz * mX;
      const l = Math.hypot(wx, wz);
      if (l > 1e-4) { wx /= l; wz /= l; }
    }

    const w = this.weapons.current;
    const adsMul = 1 - this.weapons.ads * 0.45;
    const sprint = canControl && input.sprint && input.moveY < -0.35 && this.weapons.ads < 0.3;
    let speed = CFG.player.speed * w.moveMul * adsMul * (sprint ? 1.42 : 1);
    if (!p.onGround) speed *= 0.92;

    const k = p.onGround ? 15 : 3.4;
    p.vel.x = damp(p.vel.x, wx * speed, k, dt);
    p.vel.z = damp(p.vel.z, wz * speed, k, dt);

    // 重力
    p.vel.y += CFG.player.gravity * dt;
    if (p.vel.y < -45) p.vel.y = -45;

    // 位移 + 碰撞
    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;
    this.world.resolveCircle(p.pos, CFG.player.radius, p.pos.y + 0.05,
                             p.pos.y + CFG.player.height);
    this.world.clampToBounds(p.pos, CFG.player.radius);

    p.pos.y += p.vel.y * dt;
    if (p.vel.y > 0) {
      const cy = this.world.ceilingY(p.pos, CFG.player.radius,
                                     p.pos.y + CFG.player.height - 0.05);
      if (p.pos.y + CFG.player.height > cy) {
        p.pos.y = cy - CFG.player.height;
        p.vel.y = 0;
      }
    }
    const gy = this.world.groundY(p.pos, CFG.player.radius, p.pos.y + 0.05,
                                  CFG.player.step);
    const wasAir = !p.onGround;
    if (p.pos.y <= gy + 1e-4) {
      p.pos.y = gy;
      if (wasAir && p.vel.y < -3.5) SFX.jumpLand(0);
      p.vel.y = 0;
      p.onGround = true;
    } else {
      p.onGround = false;
    }

    // 脚步声
    const hs = Math.hypot(p.vel.x, p.vel.z);
    if (p.onGround && hs > 1.0) {
      p.stepDist += hs * dt;
      if (p.stepDist > 2.3) {
        p.stepDist = 0;
        SFX.footstep(0, clamp(hs / 5.4, 0.35, 1.1));
      }
    } else p.stepDist = Math.min(p.stepDist, 1.6);

    // 受伤冷却
    if (p.hurtCd > 0) p.hurtCd -= dt;
    if (p.shake > 0) p.shake = Math.max(0, p.shake - dt * 3.2);

    // 相机
    const sh = p.shake;
    this.camera.position.set(
      p.pos.x + (Math.random() - 0.5) * 0.055 * sh,
      p.pos.y + CFG.player.eye + (Math.random() - 0.5) * 0.055 * sh,
      p.pos.z + (Math.random() - 0.5) * 0.055 * sh,
    );
    this.camera.rotation.set(p.pitch, p.yaw, (Math.random() - 0.5) * 0.02 * sh);
    this.camera.updateMatrixWorld();

    // FOV：开镜拉近
    const wdef = this.weapons.current;
    const targetFov = lerp(CFG.player.fovBase, wdef.adsFov, this.weapons.ads);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = damp(this.camera.fov, targetFov, CFG.player.fovLerp, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  // ---------------------------------------------------------- 对手
  _updateOpponent(dt, live) {
    const op = this.opponent;
    if (!op || !live) return;
    const playerEye = _v.set(this.player.pos.x, this.player.pos.y + CFG.player.eye,
                             this.player.pos.z);
    op.update(dt, {
      playerPos: this.player.pos,
      playerEye,
      playerMoving: Math.hypot(this.player.vel.x, this.player.vel.z) > 1.2,
      playerAlive: this.player.alive,
      onEnemyShoot: (shot) => this._onBotShot(shot),
    });
  }

  // ---------------------------------------------------------- 玩家开枪
  _onPlayerShot(w, dirs, spread) {
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const muzzle = this.weapons.muzzleWorldPos(new THREE.Vector3());

    for (const dir of dirs) {
      let endT = 220;
      let hitEnemy = null;
      let hitWorld = null;

      const eh = this.opponent.rayHit(origin, dir, endT);
      if (eh) { hitEnemy = eh; endT = eh.t; }
      const wh = this.world.raycast(origin, dir, endT);
      if (wh) { hitWorld = wh; endT = wh.t; }

      // 墙比敌人近 → 打的是墙，不能穿墙伤人
      const enemyCloser = hitEnemy && (!hitWorld || hitEnemy.t <= hitWorld.t);

      if (enemyCloser) {
        const dmg = w.dmg * (hitEnemy.part === 'head' ? w.headMul
          : hitEnemy.part === 'legs' ? w.limbMul : 1);
        const pt = _v2.copy(dir).multiplyScalar(hitEnemy.t).add(origin);
        this.opponent.applyDamage(dmg, hitEnemy.part);
        this._blood(pt);
        const killed = !this.opponent.isAlive();
        this.hud.hitmark(killed);
        SFX.hitmark(hitEnemy.part === 'head');
        if (killed) {
          SFX.enemyDown(0);
          this.hud.feed(hitEnemy.part === 'head' ? '爆头击杀' : '击杀');
          this._endRound('me', 'kill');
        }
      } else if (hitWorld) {
        this._spark(hitWorld.point, hitWorld.normal);
        this._decal(hitWorld.point, hitWorld.normal);
        SFX.bulletImpact(0);
      }
      this.weapons.tracer(muzzle, _v3.copy(dir).multiplyScalar(endT).add(origin));
    }

    // 后坐力打到真实准心上（玩家需要自己压枪）
    this.player.pitch += w.recoilPitch * D2R;
    this.player.yaw += rand(-1, 1) * w.recoilYaw * D2R;
    this.player.recoverAcc += w.recoilPitch * D2R * 0.55;
    this.player.pitch = clamp(this.player.pitch, -88 * D2R, 88 * D2R);
  }

  // ---------------------------------------------------------- 敌人开枪
  _onBotShot(shot) {
    if (!this.player.alive) return;
    const from = shot.from || shot.origin;
    const pan = this._panTo(from);
    SFX.gunshot(shot.sfx || 'rifle', pan);

    const p = this.player;
    const box = this._tmpBox;
    box.min.set(p.pos.x - 0.40, p.pos.y + 0.10, p.pos.z - 0.40);
    box.max.set(p.pos.x + 0.40, p.pos.y + 1.80, p.pos.z + 0.40);

    const pellets = shot.pellets || 1;
    let total = 0, head = false;
    for (let i = 0; i < pellets; i++) {
      const dir = _v.copy(shot.dir).clone();
      if (pellets > 1 && shot.spread) {
        const r = Math.sqrt(Math.random()) * shot.spread * D2R;
        const a = Math.random() * Math.PI * 2;
        const right = _v2.set(-dir.z, 0, dir.x).normalize();
        const up = new THREE.Vector3().crossVectors(right, dir).normalize();
        dir.addScaledVector(right, Math.cos(a) * r)
           .addScaledVector(up, Math.sin(a) * r).normalize();
      }
      const wh = this.world.raycast(shot.origin, dir, 200);
      const maxT = wh ? wh.t : 200;
      const ph = rayAABB(shot.origin, dir, box.min, box.max, maxT);
      if (ph) {
        const hy = shot.origin.y + dir.y * ph.t;
        const isHead = hy > p.pos.y + 1.46;
        total += shot.dmg * (isHead ? 1.9 : 1);
        head = head || isHead;
      }
    }

    if (total > 0) {
      this._damagePlayer(total, from, head);
    } else {
      const wh = this.world.raycast(shot.origin, shot.dir, 200);
      if (wh) this._spark(wh.point, wh.normal, 0.7);
    }
  }

  _panTo(worldPos) {
    const d = _v.copy(worldPos).sub(this.camera.position);
    const fwd = this.camera.getWorldDirection(_v2);
    const right = _v3.setFromMatrixColumn(this.camera.matrixWorld, 0);
    const l = d.length() || 1;
    const r = (d.x * right.x + d.z * right.z) / l;
    return clamp(r * 1.6, -1, 1);
  }

  _damagePlayer(dmg, fromPos, head) {
    const p = this.player;
    if (!p.alive || this.round.state !== ST.LIVE) return;
    p.hp -= dmg;
    p.shake = Math.min(1.4, p.shake + 0.5 + dmg * 0.012);
    p.hurtCd = 0.25;
    const dir = _v.copy(fromPos).sub(p.pos);
    this.hud.damageDir(dir.x, dir.z, p.yaw);
    SFX.hurt(this._panTo(fromPos));
    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      SFX.enemyDown(0);
      this.hud.banner(head ? '被爆头' : '你被击倒', 1.4);
      this._endRound('ai', 'death');
    }
  }
}

function pickBotWeapon(roundNo) {
  const pool = ['assault', 'assault', 'smg', 'shotgun', 'sniper', 'lmg'];
  const idx = (roundNo * 7 + 3) % pool.length;
  return pool[idx];
}
