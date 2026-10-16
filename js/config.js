// ============================================================
//  配置与武器数据表
//  坐标系：Three.js 标准 —— X 右, Y 上, Z 后（-Z 为前方）
//  角度：全部用「度」写在表里，用的时候转弧度
// ============================================================

export const CFG = {
  player: {
    radius: 0.38,
    height: 1.80,
    eye: 1.62,
    speed: 5.4,            // m/s 基础移动
    accel: 42,
    friction: 13,
    airControl: 0.30,
    jump: 5.2,
    gravity: -19.0,
    step: 0.46,            // 能直接迈上去的高度
    maxHP: 100,
    fovBase: 66,
    fovAds: 42,
    fovLerp: 11,
  },
  round: {
    scoreToWin: 5,
    countdown: 3.0,
    endDelay: 2.8,
    resetDelay: 0.9,
  },
  bot: {
    hp: 100,
    speed: 4.7,
    sprintMul: 1.15,
    sight: 44.0,           // 视野距离
    fov: 150,              // 视野角（度）
    reaction: 0.20,        // 看到你之后的开火延迟
    aimTime: 0.42,         // 瞄准收敛时间
    aimErr: 1.7,           // 基础瞄准误差（度）
    aimErrMove: 1.4,       // 你移动时的额外误差
    aimErrDist: 0.030,     // 每米额外误差
    fireGap: [0.10, 0.20], // 点射间隔
    burst: [3, 6],         // 每次点射发数
    burstGap: [0.28, 0.68],
    weapon: 'assault',
    hearRadius: 22,
    coverPref: 0.55,
  },
  net: {
    // 联机接口开关。'ai' = 本地机器人；将来接 'peer' 走 WebRTC
    mode: 'ai',
    room: null,
  },
  quality: {
    // 由 quality.js 按设备覆盖
    shadows: true,
    pixelRatio: 1.0,
    pointLights: 4,
    fog: true,
    antialias: true,
    maxEnemies: 1,
  },
};

// ------------------------------------------------------------ 武器表
// dmg 单发伤害；pellets 弹丸数；rpm 每分钟发数
// spread* 单位「度」；recoil* 单位「度」
export const WEAPONS = [
  {
    id: 'assault', label: 'AR-15 突击步枪', tag: '均衡主力', node: 'wpn_assault',
    dmg: 23, headMul: 2.1, limbMul: 0.82,
    rpm: 640, mag: 30, reload: 2.15, auto: true, pellets: 1,
    spreadHip: 1.05, spreadAds: 0.16, spreadMove: 1.5, spreadAir: 2.4,
    recoilPitch: 0.80, recoilYaw: 0.34, recover: 8.2,
    adsFov: 42, adsTime: 0.20, moveMul: 0.90,
    vm: { pos: [0.152, -0.232, -0.58], rot: [0, 1.5, 0] },
    ads: { pos: [0.000, -0.100, -0.130], rot: [0, 0, 0] },
    muzzle: 1.00, sfx: 'rifle',
  },
  {
    id: 'smg', label: 'MP 冲锋枪', tag: '近身泼水', node: 'wpn_smg',
    dmg: 16, headMul: 1.85, limbMul: 0.85,
    rpm: 920, mag: 32, reload: 1.85, auto: true, pellets: 1,
    spreadHip: 1.45, spreadAds: 0.42, spreadMove: 1.0, spreadAir: 1.8,
    recoilPitch: 0.60, recoilYaw: 0.42, recover: 9.6,
    adsFov: 46, adsTime: 0.17, moveMul: 0.97,
    vm: { pos: [0.146, -0.222, -0.55], rot: [0, 1.5, 0] },
    ads: { pos: [0.000, -0.092, -0.135], rot: [0, 0, 0] },
    muzzle: 0.85, sfx: 'smg',
  },
  {
    id: 'shotgun', label: 'M 泵动霰弹枪', tag: '贴脸一枪', node: 'wpn_shotgun',
    dmg: 13, headMul: 1.45, limbMul: 0.9,
    rpm: 78, mag: 7, reload: 3.10, auto: false, pellets: 8,
    spreadHip: 4.6, spreadAds: 3.2, spreadMove: 0.8, spreadAir: 1.2,
    recoilPitch: 3.20, recoilYaw: 1.10, recover: 5.4,
    adsFov: 52, adsTime: 0.24, moveMul: 0.86,
    vm: { pos: [0.152, -0.238, -0.62], rot: [0, 1.5, 0] },
    ads: { pos: [0.000, -0.124, -0.150], rot: [0, 0, 0] },
    muzzle: 1.35, sfx: 'shotgun',
  },
  {
    id: 'sniper', label: 'SR 栓动狙击枪', tag: '一枪一个', node: 'wpn_sniper',
    dmg: 88, headMul: 2.6, limbMul: 0.75,
    rpm: 46, mag: 5, reload: 3.00, auto: false, pellets: 1,
    spreadHip: 3.20, spreadAds: 0.03, spreadMove: 3.4, spreadAir: 4.5,
    recoilPitch: 4.40, recoilYaw: 0.95, recover: 4.2,
    adsFov: 17, adsTime: 0.34, moveMul: 0.76, scope: true,
    vm: { pos: [0.156, -0.238, -0.64], rot: [0, 1.5, 0] },
    ads: { pos: [0.000, -0.112, -0.090], rot: [0, 0, 0] },
    muzzle: 1.45, sfx: 'sniper',
  },
  {
    id: 'pistol', label: 'G 半自动手枪', tag: '换枪快', node: 'wpn_pistol',
    dmg: 27, headMul: 2.1, limbMul: 0.85,
    rpm: 420, mag: 15, reload: 1.45, auto: false, pellets: 1,
    spreadHip: 1.00, spreadAds: 0.22, spreadMove: 1.6, spreadAir: 2.6,
    recoilPitch: 1.15, recoilYaw: 0.55, recover: 9.0,
    adsFov: 46, adsTime: 0.14, moveMul: 1.00,
    vm: { pos: [0.138, -0.226, -0.52], rot: [0, 1.5, 0] },
    ads: { pos: [0.000, -0.084, -0.140], rot: [0, 0, 0] },
    muzzle: 0.70, sfx: 'pistol',
  },
  {
    id: 'lmg', label: 'LMG 轻机枪', tag: '火力压制', node: 'wpn_lmg',
    dmg: 25, headMul: 1.75, limbMul: 0.80,
    rpm: 700, mag: 100, reload: 4.60, auto: true, pellets: 1,
    spreadHip: 1.70, spreadAds: 0.30, spreadMove: 1.1, spreadAir: 2.0,
    recoilPitch: 1.00, recoilYaw: 0.50, recover: 7.0,
    adsFov: 44, adsTime: 0.28, moveMul: 0.76,
    vm: { pos: [0.160, -0.238, -0.64], rot: [0, 1.5, 0] },
    ads: { pos: [0.000, -0.108, -0.125], rot: [0, 0, 0] },
    muzzle: 1.20, sfx: 'lmg',
  },
];

export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));
export const WEAPON_INDEX = Object.fromEntries(WEAPONS.map((w, i) => [w.id, i]));

// 敌人可用的武器（伤害统一按玩家血量的百分比思路调过，保证公平）
export const BOT_WEAPONS = {
  assault: { dmg: 11, rpm: 640, mag: 30, reload: 2.4, auto: true, pellets: 1,
             spread: 2.2, burst: [3, 6], sfx: 'rifle' },
  smg: { dmg: 8, rpm: 920, mag: 32, reload: 2.0, auto: true, pellets: 1,
         spread: 2.8, burst: [5, 9], sfx: 'smg' },
  shotgun: { dmg: 7, rpm: 78, mag: 7, reload: 3.2, auto: false, pellets: 6,
             spread: 5.0, burst: [1, 2], sfx: 'shotgun' },
  sniper: { dmg: 52, rpm: 46, mag: 5, reload: 3.2, auto: false, pellets: 1,
            spread: 0.6, burst: [1, 1], sfx: 'sniper' },
};

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// 帧率无关的指数趋近
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
