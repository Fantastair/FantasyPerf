import demoData from "./demo-project.js";

export const PITCH = 2.54;
export const FORMAT = "FantasyPerf";
// 项目数据格式使用三段式版本：
//   大版本：数据含义不兼容的重构，正常情况下保持稳定；
//   中版本：新增功能带来的向后兼容扩展，旧文件自动升级；
//   小版本：仅修复，不改变数据含义，同中版本内互相兼容。
export const FORMAT_VERSION = "1.1.0";
// 生成文件的工具版本，与 package.json 保持一致（由单元测试看住）。
export const APP_VERSION = "1.1.0";
export const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
// 早期的整数版本号：1 等同于 1.0.0；2 是引入 meta 的那次改动，等同于 1.1.0。
const LEGACY_VERSIONS = { 1: "1.0.0", 2: "1.1.0" };
export const COLORS = [
  "#dc6654",
  "#3b8bc2",
  "#dca83d",
  "#7c6ac5",
  "#278c72",
  "#3c4656",
];
export const clone = (value) => structuredClone(value);
export const uid = () => {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  // LAN HTTP previews do not expose randomUUID, but getRandomValues is available.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
export const same = (a, b) => a.x === b.x && a.y === b.y;
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export function columnName(index) {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export const holeName = (p) => `${columnName(p.x)}${p.y + 1}`;
// 升级步骤按起始版本登记，逐级执行，因此任何旧文件都能升到当前版本。
// 每一步只补全或翻译字段，不改变已有数据的含义。
const FORMAT_MIGRATIONS = {
  // 1.0.0 → 1.1.0：新增版本标识（生成工具、工具版本、导出时间）。
  "1.0.0": {
    to: "1.1.0",
    migrate: (data) => ({
      ...data,
      meta: { app: FORMAT, appVersion: null, savedAt: null },
    }),
  },
};
// 版本号解析：接受三段式字符串，也接受早期的整数版本。
export function parseVersion(value) {
  if (typeof value === "string" && VERSION_PATTERN.test(value)) return value;
  return Object.hasOwn(LEGACY_VERSIONS, value) ? LEGACY_VERSIONS[value] : null;
}
const versionParts = (v) => v.split(".").map(Number);
export const versionMajor = (v) => versionParts(v)[0];
const versionMinor = (v) => versionParts(v)[1];
// 返回 -1 / 0 / 1，供逐级升级与兼容性判断使用。
export function compareVersions(a, b) {
  const [x, y] = [versionParts(a), versionParts(b)];
  for (let i = 0; i < 3; i++)
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
function migrationFrom(version) {
  if (FORMAT_MIGRATIONS[version]) return FORMAT_MIGRATIONS[version];
  // 小版本只做修复，不改变数据含义：找不到精确步骤时按同大版本内最近的低版本处理。
  const lower = Object.keys(FORMAT_MIGRATIONS)
    .filter(
      (v) =>
        versionMajor(v) === versionMajor(version) &&
        compareVersions(v, version) < 0,
    )
    .sort(compareVersions);
  return lower.length ? FORMAT_MIGRATIONS[lower.at(-1)] : null;
}
// 兼容规则配合三段式版本：
//   大版本不同：数据含义可能不兼容，拒绝打开；
//   中版本更高：缺少新功能所需的字段，提示升级工具；
//   同中版本、小版本更高：只包含修复，按当前版本读取；
//   版本更低：按登记的步骤逐级升级。
export function upgradeProject(raw) {
  if (!raw || typeof raw !== "object" || raw.format !== FORMAT)
    throw new Error("不是 FantasyPerf 项目文件");
  const file = parseVersion(raw.version);
  if (!file) throw new Error("项目文件缺少有效的版本标识（应形如 1.1.0）");
  if (versionMajor(file) > versionMajor(FORMAT_VERSION))
    throw new Error(
      `项目文件是大版本 ${versionMajor(file)}，当前工具只支持大版本 ${versionMajor(FORMAT_VERSION)}，请换用对应版本的工具`,
    );
  if (compareVersions(file, FORMAT_VERSION) > 0) {
    if (versionMinor(file) > versionMinor(FORMAT_VERSION))
      throw new Error(
        `项目文件版本 ${file} 高于当前工具支持的 ${FORMAT_VERSION}，请升级工具后再打开`,
      );
    return { ...raw, version: FORMAT_VERSION };
  }
  let data = { ...raw, version: file };
  while (compareVersions(data.version, FORMAT_VERSION) < 0) {
    const step = migrationFrom(data.version);
    if (!step) throw new Error(`缺少 ${data.version} 的升级步骤`);
    const next = { ...step.migrate(data), version: step.to };
    if (compareVersions(next.version, data.version) <= 0)
      throw new Error(`版本 ${data.version} 的升级步骤没有前进`);
    data = next;
  }
  return data;
}
export function newProject(cols = 30, rows = 20, name = "未命名项目") {
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    meta: { app: FORMAT, appVersion: APP_VERSION, savedAt: null },
    name,
    board: { cols, rows, pitch: PITCH },
    defaults: { start: 3, end: 3 },
    objects: [],
    reference: null,
  };
}
// 正面是元件面，背面是焊盘面：元件与跳线在元件面，锡线与贴片元件在焊盘面。
export function objectFace(o) {
  return o.type === "solder" || o.mounting === "smd" ? "back" : "front";
}
export function faceName(face) {
  return face === "front" ? "正面 · 元件面" : "背面 · 焊盘面";
}
export function editableOnFace(o, face, state) {
  return (
    objectFace(o) === face ||
    (o.type === "solder" &&
      face === "front" &&
      (state.showGhost !== false || state.tool === "solder"))
  );
}
export function smdPlacement(point, rotation) {
  if (rotation === 90)
    return { x: Math.round(point.x), y: Math.floor(point.y) };
  if (rotation === 180)
    return { x: Math.ceil(point.x), y: Math.round(point.y) };
  if (rotation === 270)
    return { x: Math.round(point.x), y: Math.ceil(point.y) };
  return { x: Math.floor(point.x), y: Math.round(point.y) };
}
export function pinPosition(c, p) {
  const r = ((c.rotation % 360) + 360) % 360;
  const [x, y] =
    r === 90
      ? [-p.y, p.x]
      : r === 180
        ? [-p.x, -p.y]
        : r === 270
          ? [p.y, -p.x]
          : [p.x, p.y];
  return { x: c.x + x, y: c.y + y };
}
export function objectPoints(o) {
  return o.type === "component"
    ? o.pins.map((p) => pinPosition(o, p))
    : o.points;
}
export function bounds(objects) {
  const ps = objects.flatMap(objectPoints);
  return ps.length
    ? {
        minX: Math.min(...ps.map((p) => p.x)),
        maxX: Math.max(...ps.map((p) => p.x)),
        minY: Math.min(...ps.map((p) => p.y)),
        maxY: Math.max(...ps.map((p) => p.y)),
      }
    : null;
}
export function inBoard(p, board) {
  return p.x >= 0 && p.y >= 0 && p.x < board.cols && p.y < board.rows;
}
export function fits(objects, board) {
  return objects.every(
    (o) =>
      (o.type !== "component" || inBoard(o, board)) &&
      objectPoints(o).every((p) => inBoard(p, board)),
  );
}
export function moveObjects(objects, dx, dy) {
  for (const o of objects) {
    if (o.type === "component") {
      o.x += dx;
      o.y += dy;
    } else o.points = o.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }
  return objects;
}
export function constrainedDelta(objects, dx, dy, board) {
  // Keep a custom component's reference hole on the board even when it has no pin there.
  const b = bounds(
    objects.map((o) =>
      o.type === "component"
        ? { type: "solder", points: [...objectPoints(o), { x: o.x, y: o.y }] }
        : o,
    ),
  );
  return b
    ? {
        x: clamp(dx, -b.minX, board.cols - 1 - b.maxX),
        y: clamp(dy, -b.minY, board.rows - 1 - b.maxY),
      }
    : { x: 0, y: 0 };
}
export function orthogonal(a, b, horizontal = true) {
  if (same(a, b)) return [];
  if (a.x === b.x || a.y === b.y) return [{ ...b }];
  return [horizontal ? { x: b.x, y: a.y } : { x: a.x, y: b.y }, { ...b }];
}
export function cleanPath(points) {
  const result = [];
  for (const p of points) {
    if (result.length && same(result.at(-1), p)) continue;
    result.push({ ...p });
    while (result.length > 2) {
      const [a, b, c] = result.slice(-3);
      if (
        (a.x === b.x && b.x === c.x && (b.y - a.y) * (c.y - b.y) >= 0) ||
        (a.y === b.y && b.y === c.y && (b.x - a.x) * (c.x - b.x) >= 0)
      )
        result.splice(-2, 1);
      else break;
    }
  }
  return result;
}
export function lengthMM(points) {
  return points
    .slice(1)
    .reduce(
      (sum, p, i) =>
        sum + Math.hypot(p.x - points[i].x, p.y - points[i].y) * PITCH,
      0,
    );
}
export const cutLength = (wire) =>
  lengthMM(wire.points) + wire.allowanceStart + wire.allowanceEnd;
export function editVertex(points, index, target, orth = true) {
  const p = clone(points);
  if (!orth) {
    p[index] = { ...target };
    return p;
  }
  // Propagate the axis constraint through collinear runs, including backtracking.
  for (const axis of ["x", "y"]) {
    for (const direction of [-1, 1]) {
      for (let i = index + direction; i >= 0 && i < p.length; i += direction) {
        if (points[i][axis] !== points[i - direction][axis]) break;
        p[i][axis] = target[axis];
      }
    }
  }
  p[index] = { ...target };
  return p;
}
export function distanceToSegment(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = clamp(
    ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    0,
    1,
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function intersection(a, b, c, d) {
  const rx = b.x - a.x,
    ry = b.y - a.y,
    sx = d.x - c.x,
    sy = d.y - c.y,
    den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-8) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den,
    u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  return t > 0.025 && t < 0.975 && u > 0.025 && u < 0.975
    ? { x: a.x + t * rx, y: a.y + t * ry, t }
    : null;
}
// 只有焊盘面（背面）左右镜像，翻面时同一孔位保持同一编号。
export function screenX(x, cols, face) {
  return face === "back" ? cols - 1 - x : x;
}
export class History {
  constructor(limit = 100) {
    this.past = [];
    this.future = [];
    this.limit = limit;
  }
  push(project) {
    this.past.push(clone(project));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(project) {
    if (!this.past.length) return null;
    this.future.push(clone(project));
    return this.past.pop();
  }
  redo(project) {
    if (!this.future.length) return null;
    this.past.push(clone(project));
    return this.future.pop();
  }
}
export function regularPins(kind, count = 8, spacing = 1, gap = 3) {
  return Array.from({ length: count }, (_, i) => {
    const half = Math.ceil(count / 2);
    return kind === "double"
      ? {
          x: i < half ? 0 : gap,
          y: (i < half ? i : count - 1 - i) * spacing,
          label: String(i + 1),
          labelDx: i < half ? -0.45 : 0.45,
          labelDy: 0,
        }
      : {
          x: i * spacing,
          y: 0,
          label: String(i + 1),
          labelDx: 0,
          labelDy: -0.55,
        };
  });
}
export function demoProject() {
  return validateProject(demoData);
}
export function validateProject(raw) {
  const data = upgradeProject(raw);
  const fail = (m) => {
      throw new Error(m);
    },
    num = (x, min, max) =>
      typeof x === "number" && Number.isFinite(x) && x >= min && x <= max,
    int = (x, min, max) => num(x, min, max) && Number.isInteger(x),
    str = (s, n = 100) => typeof s === "string" && s.length <= n;
  if (
    !str(data.name) ||
    !data.board ||
    !int(data.board.cols, 2, 100) ||
    !int(data.board.rows, 2, 100) ||
    data.board.pitch !== PITCH
  )
    fail("板尺寸需为 2–100 孔，孔距需为 2.54 mm");
  if (
    !data.defaults ||
    !num(data.defaults.start, 0, 1000) ||
    !num(data.defaults.end, 0, 1000)
  )
    fail("默认余量无效");
  if (!Array.isArray(data.objects) || data.objects.length > 3000)
    fail("对象数量超过 3000 或数据损坏");
  const ids = new Set();
  const result = newProject(data.board.cols, data.board.rows, data.name);
  result.defaults = { start: data.defaults.start, end: data.defaults.end };
  const meta = data.meta && typeof data.meta === "object" ? data.meta : {};
  if (
    (meta.app != null && meta.app !== FORMAT) ||
    (meta.appVersion != null &&
      !(str(meta.appVersion, 40) && VERSION_PATTERN.test(meta.appVersion))) ||
    (meta.savedAt != null &&
      !(str(meta.savedAt, 40) && !Number.isNaN(Date.parse(meta.savedAt))))
  )
    fail("项目版本标识无效");
  result.meta = {
    app: FORMAT,
    appVersion: typeof meta.appVersion === "string" ? meta.appVersion : null,
    savedAt: typeof meta.savedAt === "string" ? meta.savedAt : null,
  };
  if (data.reference != null) {
    const r = data.reference;
    if (
      !str(r.name, 200) ||
      !str(r.dataUrl, 1_800_000) ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
        r.dataUrl,
      ) ||
      !int(r.naturalWidth, 1, 2400) ||
      !int(r.naturalHeight, 1, 2400) ||
      !num(r.x, 0, 100000) ||
      !num(r.y, 0, 100000) ||
      !num(r.width, 140, 1000) ||
      !num(r.opacity, 0.15, 1) ||
      typeof r.visible !== "boolean"
    )
      fail("原理图参考图片或显示参数无效");
    result.reference = {
      name: r.name,
      dataUrl: r.dataUrl,
      naturalWidth: r.naturalWidth,
      naturalHeight: r.naturalHeight,
      x: r.x,
      y: r.y,
      width: r.width,
      opacity: r.opacity,
      visible: r.visible,
    };
  }

  for (const o of data.objects) {
    if (!o || !str(o.id, 100) || !o.id || ids.has(o.id) || !str(o.name))
      fail("对象编号重复或名称无效");
    ids.add(o.id);
    let v = { id: o.id, type: o.type, name: o.name };
    if (o.type === "component") {
      if (
        !int(o.x, 0, 99) ||
        !int(o.y, 0, 99) ||
        ![0, 90, 180, 270].includes(o.rotation) ||
        !Array.isArray(o.pins) ||
        !o.pins.length ||
        o.pins.length > 256
      )
        fail("元件引脚或位置无效");
      const coords = new Set();
      v = {
        ...v,
        x: o.x,
        y: o.y,
        rotation: o.rotation,
        pins: o.pins.map((p) => {
          if (
            !p ||
            !int(p.x, -99, 99) ||
            !int(p.y, -99, 99) ||
            !str(p.label, 100) ||
            !num(p.labelDx ?? 0, -100, 100) ||
            !num(p.labelDy ?? -0.55, -100, 100)
          )
            fail("引脚数据无效");
          const k = `${p.x},${p.y}`;
          if (coords.has(k)) fail("元件中存在重复引脚位置");
          coords.add(k);
          return {
            x: p.x,
            y: p.y,
            label: p.label,
            labelDx: p.labelDx ?? 0,
            labelDy: p.labelDy ?? -0.55,
          };
        }),
      };
      if (o.mounting !== undefined) {
        if (
          o.mounting !== "smd" ||
          !["resistor", "capacitor"].includes(o.kind) ||
          v.pins.length !== 2 ||
          v.pins[0].x !== 0 ||
          v.pins[0].y !== 0 ||
          v.pins[1].x !== 1 ||
          v.pins[1].y !== 0
        )
          fail("贴片元件必须跨接两个相邻焊盘");
        v.mounting = "smd";
        v.kind = o.kind;
      }
    } else if (o.type === "solder" || o.type === "wire") {
      if (
        !Array.isArray(o.points) ||
        o.points.length < 2 ||
        o.points.length > 2000 ||
        !o.points.every((p) => p && int(p.x, 0, 99) && int(p.y, 0, 99))
      )
        fail("线路坐标无效");
      v.points = o.points.map((p) => ({ x: p.x, y: p.y }));
      if (o.type === "wire") {
        if (
          !["direct", "orthogonal"].includes(o.mode) ||
          !/^#[0-9a-f]{6}$/i.test(o.color) ||
          !num(o.allowanceStart, 0, 1000) ||
          !num(o.allowanceEnd, 0, 1000)
        )
          fail("跳线参数无效");
        if (o.mode === "direct" && o.points.length !== 2)
          fail("直连跳线只能有两个端点");
        Object.assign(v, {
          mode: o.mode,
          color: o.color,
          allowanceStart: o.allowanceStart,
          allowanceEnd: o.allowanceEnd,
        });
      }
      if (
        (o.type === "solder" || o.mode === "orthogonal") &&
        o.points.some(
          (p, i) =>
            i > 0 && p.x !== o.points[i - 1].x && p.y !== o.points[i - 1].y,
        )
      )
        fail("直角线路不能包含斜线");
      if (lengthMM(v.points) === 0) fail("线路长度不能为零");
    } else fail("未知对象类型");
    if (!fits([v], result.board)) fail("存在超出板边界的对象");
    result.objects.push(v);
  }
  return result;
}
export function objectsCSV(project) {
  const cell = (v) => `"${String(v).replaceAll('"', '""')}"`,
    // Spreadsheets treat leading =, +, - and @ as formulas.
    text = (v) => (/^[=+\-@\t\r]/.test(String(v)) ? "'" + v : String(v)),
    pins = (o) =>
      o.pins.map((p) => `${holeName(pinPosition(o, p))}=${p.label}`).join("; ");
  const rows = [
    [
      "编号",
      "类别",
      "板面",
      "基准孔 / 起点",
      "终点",
      "旋转 (°)",
      "引脚数",
      "引脚孔位与标注",
      "路径长度 (mm)",
      "起点余量 (mm)",
      "终点余量 (mm)",
      "裁线长度 (mm)",
    ],
  ];
  for (const o of project.objects) {
    const face = faceName(objectFace(o));
    if (o.type === "component") {
      const smd = o.mounting === "smd",
        pads = smd ? objectPoints(o) : null;
      rows.push([
        text(o.name),
        smd ? (o.kind === "resistor" ? "贴片电阻" : "贴片电容") : "元件",
        face,
        holeName(smd ? pads[0] : o),
        smd ? holeName(pads[1]) : "",
        o.rotation,
        o.pins.length,
        pins(o),
        "",
        "",
        "",
        "",
      ]);
    } else if (o.type === "wire") {
      rows.push([
        text(o.name),
        "跳线",
        face,
        holeName(o.points[0]),
        holeName(o.points.at(-1)),
        "",
        "",
        `${o.mode === "direct" ? "直连" : "直角"} · ${o.points.length} 个路径点`,
        lengthMM(o.points).toFixed(1),
        o.allowanceStart.toFixed(1),
        o.allowanceEnd.toFixed(1),
        cutLength(o).toFixed(1),
      ]);
    }
  }
  return "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
