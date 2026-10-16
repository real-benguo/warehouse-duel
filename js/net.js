// ============================================================
//  联机适配器（预留）
//  当前只实现本地 AI。将来接真人对战只需再写一个 PeerAdapter，
//  Game 只通过下面这组接口跟对手通信，不关心对手是 AI 还是真人。
// ============================================================

import { Enemy } from './enemy.js';

/**
 * 对手适配器接口
 *   spawn(pos, yaw, weaponId)        回合开始，把对手放到出生点
 *   update(dt, ctx)                  每帧驱动对手
 *   rayHit(origin, dir, maxT)        玩家的子弹打中对手了吗
 *   applyDamage(dmg, part, mul)      给对手造成伤害
 *   isAlive()                        对手还活着吗
 *   getState()                       给网络层同步用的状态快照
 *   reset()                          回合重置
 */
export class LocalAIAdapter {
  constructor(world, quality, opts = {}) {
    this.enemy = new Enemy(world, quality);
    this.kind = 'ai';
    this.name = 'AI';
    this.opts = opts;
  }

  spawn(pos, yaw, weaponId) { this.enemy.spawn(pos, yaw, weaponId); }
  update(dt, ctx) { this.enemy.update(dt, ctx); }
  rayHit(o, d, t) { return this.enemy.rayHit(o, d, t); }
  applyDamage(dmg) { this.enemy.hp -= dmg; if (this.enemy.hp <= 0) this.enemy.die(); }
  isAlive() { return this.enemy.alive; }
  get hp() { return this.enemy.hp; }
  get pos() { return this.enemy.pos; }
  get eyePos() {
    return this.enemy.alive
      ? this.enemy.eye(new (this.enemy.pos.constructor)())
      : null;
  }
  reset() { this.enemy.alive = false; this.enemy.root.visible = false; }
  getState() {
    return {
      pos: [this.enemy.pos.x, this.enemy.pos.y, this.enemy.pos.z],
      yaw: this.enemy.yaw,
      hp: this.enemy.hp,
      alive: this.enemy.alive,
    };
  }
}

/**
 * WebRTC 联机适配器骨架 —— 等以后要接真人对战时实现。
 * 思路：
 *   1) 用免费信令（PeerJS / 公共房间）交换 SDP
 *   2) 建立 DataChannel，10~20Hz 互发 getState() 快照
 *   3) 本地用插值把远端玩家渲染成一个 Enemy 实例
 *   4) applyDamage / rayHit 走「本地判定 + 远端确认」的简易权威模型
 */
export class PeerAdapter {
  constructor(world, quality, opts = {}) {
    this.kind = 'peer';
    this.name = '玩家';
    this.world = world;
    this.remote = new Enemy(world, quality);   // 远端玩家用同一套模型渲染
    this.channel = null;
    this.ready = false;
    this.opts = opts;
  }

  async connect(_roomId) {
    throw new Error('联机功能尚未开启（当前版本只支持 AI 对战）');
  }

  spawn(pos, yaw) { this.remote.spawn(pos, yaw); }
  update(dt, ctx) {
    // 收到快照时：把 remote.pos / remote.yaw 插值到目标，再跑 _animate
    this.remote._animate(dt, 0);
  }
  rayHit(o, d, t) { return this.remote.rayHit(o, d, t); }
  applyDamage(dmg) { /* 发给远端，由远端扣血 */ }
  isAlive() { return this.remote.alive; }
  reset() { this.remote.alive = false; this.remote.root.visible = false; }
  getState() { return null; }
}

export function createOpponent(world, quality) {
  // 以后按 CFG.net.mode 切换
  return new LocalAIAdapter(world, quality);
}
