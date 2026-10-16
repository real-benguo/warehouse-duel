// ============================================================
//  世界：场景、灯光、地图加载、碰撞体（全部 AABB）
// ============================================================

import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { CFG, clamp } from './config.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class World {
  constructor(quality) {
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.colliders = [];        // {min:Vector3, max:Vector3, kind}
    this.map = null;
    this.lamps = [];
    this._hits = [];
  }

  async load(onProgress) {
    const loader = new GLTFLoader();
    const load = (url) => new Promise((res, rej) =>
      loader.load(url, res, undefined, (e) => rej(new Error('加载失败: ' + url + ' ' + (e && e.message || '')))));

    let step = 0;
    const tick = (label) => { step++; if (onProgress) onProgress(step / 4, label); };

    tick('地图数据');
    const mapRes = await fetch('./assets/map.json');
    if (!mapRes.ok) throw new Error('map.json 读取失败 (' + mapRes.status + ')');
    this.map = await mapRes.json();

    tick('仓库场景');
    const arena = await load('./assets/models/arena.glb');
    this._prepModel(arena.scene);
    this.scene.add(arena.scene);

    tick('武器数据');
    const wpnRes = await fetch('./assets/weapons.json');
    this.weaponAnchors = wpnRes.ok ? await wpnRes.json() : {};

    tick('敌人模型');
    this.enemyGltf = await load('./assets/models/enemy.glb');

    this._buildColliders();
    this._setupLights();
    this._setupEnv();
    if (onProgress) onProgress(1, '完成');
  }

  async loadWeapons(onProgress) {
    const loader = new GLTFLoader();
    const gltf = await new Promise((res, rej) =>
      loader.load('./assets/models/weapons.glb', res, undefined,
        (e) => rej(new Error('武器模型加载失败 ' + (e && e.message || '')))));
    this._prepModel(gltf.scene);
    this.weaponScene = gltf.scene;
    if (onProgress) onProgress(1);
  }

  _prepModel(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = true;
      const m = o.material;
      if (m) {
        m.side = THREE.FrontSide;
        // 没有环境贴图时，metalness 太高会直接渲染成黑色 —— 压到 0.55 以下
        if (m.metalness !== undefined && m.metalness > 0.55) m.metalness = 0.55;
        if (m.roughness !== undefined && m.roughness < 0.28) m.roughness = 0.28;
      }
      // 场景静态物体不需要阴影投射（省性能），只接收
      o.castShadow = false;
      o.receiveShadow = !!this.quality.shadows;
    });
  }

  /** 用一张程序生成的渐变图当环境光（IBL），金属件才不会发黑 */
  setupEnvironment(renderer) {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 64;
    const g = cv.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 64);
    grd.addColorStop(0.00, '#4a6285');
    grd.addColorStop(0.45, '#7d8698');
    grd.addColorStop(0.52, '#6b6255');
    grd.addColorStop(1.00, '#241f19');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 64);
    const tex = new THREE.CanvasTexture(cv);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const env = pmrem.fromEquirectangular(tex).texture;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.55;
    tex.dispose();
    pmrem.dispose();
    this.envTexture = env;
  }

  _buildColliders() {
    this.colliders.length = 0;
    for (const c of this.map.colliders) {
      const a = c.aabb;
      this.colliders.push({
        kind: c.kind,
        min: new THREE.Vector3(a[0], a[1], a[2]),
        max: new THREE.Vector3(a[3], a[4], a[5]),
      });
    }
    this.bounds = {
      min: new THREE.Vector3(...this.map.bounds.min),
      max: new THREE.Vector3(...this.map.bounds.max),
    };
    this.spawns = this.map.spawns.map((s) => ({
      pos: new THREE.Vector3(s.pos[0], s.pos[1], s.pos[2]),
      yaw: s.yaw * Math.PI / 180,
    }));
  }

  _setupEnv() {
    const col = new THREE.Color(0x1a2130);
    this.scene.background = col;
    if (this.quality.fog) {
      this.scene.fog = new THREE.Fog(0x232b3a, 22, 76);
    }
  }

  _setupLights() {
    const hemi = new THREE.HemisphereLight(0xa8bcd8, 0x4a4238, 0.72);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffe8c8, 1.70);
    dir.position.set(11, 27, 13);
    dir.target.position.set(0, 0, 0);
    this.scene.add(dir.target);
    if (this.quality.shadows) {
      dir.castShadow = true;
      const s = 26;
      dir.shadow.camera.left = -s;
      dir.shadow.camera.right = s;
      dir.shadow.camera.top = s;
      dir.shadow.camera.bottom = -s;
      dir.shadow.camera.near = 1;
      dir.shadow.camera.far = 70;
      dir.shadow.mapSize.set(1024, 1024);
      dir.shadow.bias = -0.0012;
      dir.shadow.normalBias = 0.03;
    }
    this.scene.add(dir);
    this.sunLight = dir;

    // 吊灯位置放点光（数量按画质限制）
    const n = Math.min(this.quality.pointLights, this.map.lamps.length);
    const lamps = this.map.lamps;
    const stepN = Math.max(1, Math.floor(lamps.length / Math.max(1, n)));
    for (let i = 0, c = 0; i < lamps.length && c < n; i += stepN, c++) {
      const p = lamps[i];
      const pl = new THREE.PointLight(0xffd8a4, 130, 36, 2.0);
      pl.position.set(p[0], p[1] - 0.40, p[2]);
      this.scene.add(pl);
      this.lamps.push(pl);
    }
    this.ambient = new THREE.AmbientLight(0x3d4c62, 0.50);
    this.scene.add(this.ambient);
  }

  // ============================================================ 碰撞

  /** 圆（玩家/敌人）在 XZ 平面上与所有 AABB 推开；返回是否发生碰撞 */
  resolveCircle(pos, radius, feetY, headY) {
    let hit = false;
    const colliders = this.colliders;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (c.max.y <= feetY + 0.02) continue;   // 完全在脚底以下 → 可以站上去
      if (c.min.y >= headY) continue;          // 完全在头顶以上
      const cx = clamp(pos.x, c.min.x, c.max.x);
      const cz = clamp(pos.z, c.min.z, c.max.z);
      let dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      hit = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = radius - d;
        pos.x += (dx / d) * push;
        pos.z += (dz / d) * push;
      } else {
        // 圆心落在盒内 —— 沿最小穿透方向推出
        const pxr = c.max.x - pos.x, pxl = pos.x - c.min.x;
        const pzr = c.max.z - pos.z, pzl = pos.z - c.min.z;
        const m = Math.min(pxr, pxl, pzr, pzl);
        if (m === pxr) pos.x = c.max.x + radius;
        else if (m === pxl) pos.x = c.min.x - radius;
        else if (m === pzr) pos.z = c.max.z + radius;
        else pos.z = c.min.z - radius;
      }
    }
    return hit;
  }

  /** 某个位置下方最高的可站立面（含地板 y=0） */
  groundY(pos, radius, feetY, step) {
    let g = 0;
    const colliders = this.colliders;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (c.max.y > feetY + step) continue;
      if (c.max.y <= g) continue;
      const cx = clamp(pos.x, c.min.x, c.max.x);
      const cz = clamp(pos.z, c.min.z, c.max.z);
      const dx = pos.x - cx, dz = pos.z - cz;
      if (dx * dx + dz * dz < radius * radius) g = c.max.y;
    }
    return g;
  }

  /** 头顶是否有东西挡住跳跃 */
  ceilingY(pos, radius, headY) {
    let c0 = Infinity;
    for (const c of this.colliders) {
      if (c.min.y < headY) continue;
      const cx = clamp(pos.x, c.min.x, c.max.x);
      const cz = clamp(pos.z, c.min.z, c.max.z);
      const dx = pos.x - cx, dz = pos.z - cz;
      if (dx * dx + dz * dz < radius * radius) c0 = Math.min(c0, c.min.y);
    }
    return c0;
  }

  /** 射线 vs 世界 AABB。返回 {t, point, normal} 或 null */
  raycast(origin, dir, maxT) {
    let bestT = maxT, bestAxis = -1, bestSign = 1, bestC = null;
    for (const c of this.colliders) {
      const r = rayAABB(origin, dir, c.min, c.max, bestT);
      if (r && r.t < bestT) {
        bestT = r.t; bestAxis = r.axis; bestSign = r.sign; bestC = c;
      }
    }
    if (!bestC) return null;
    const point = _v1.copy(dir).multiplyScalar(bestT).add(origin).clone();
    const normal = new THREE.Vector3();
    if (bestAxis === 0) normal.x = bestSign;
    else if (bestAxis === 1) normal.y = bestSign;
    else normal.z = bestSign;
    return { t: bestT, point, normal, collider: bestC };
  }

  /** 视线是否通畅 */
  hasLineOfSight(a, b) {
    _v2.copy(b).sub(a);
    const dist = _v2.length();
    if (dist < 1e-4) return true;
    _v2.multiplyScalar(1 / dist);
    return this.raycast(a, _v2, dist - 0.05) === null;
  }

  /** 把一个物体夹在场地范围内 */
  clampToBounds(pos, radius) {
    const b = this.bounds;
    pos.x = clamp(pos.x, b.min.x + radius, b.max.x - radius);
    pos.z = clamp(pos.z, b.min.z + radius, b.max.z - radius);
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o.isMesh) {
        o.geometry && o.geometry.dispose && o.geometry.dispose();
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          ms.forEach((m) => m.dispose && m.dispose());
        }
      }
    });
  }
}

/** 射线 vs AABB（slab 法），返回 {t, axis, sign} 或 null */
export function rayAABB(origin, dir, min, max, maxT = Infinity) {
  let tmin = 0, tmax = maxT;
  let axis = -1, sign = 1;
  for (let i = 0; i < 3; i++) {
    const o = i === 0 ? origin.x : i === 1 ? origin.y : origin.z;
    const d = i === 0 ? dir.x : i === 1 ? dir.y : dir.z;
    const mn = i === 0 ? min.x : i === 1 ? min.y : min.z;
    const mx = i === 0 ? max.x : i === 1 ? max.y : max.z;
    if (Math.abs(d) < 1e-9) {
      if (o < mn || o > mx) return null;
      continue;
    }
    const inv = 1 / d;
    let t1 = (mn - o) * inv;
    let t2 = (mx - o) * inv;
    let s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmin <= 1e-6) return null;
  return { t: tmin, axis, sign };
}
