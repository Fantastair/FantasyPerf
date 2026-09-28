export const PITCH = 2.54;
export const COLORS = [
  "#dc6654",
  "#3b8bc2",
  "#dca83d",
  "#7c6ac5",
  "#278c72",
  "#3c4656",
];
export const clone = (value) => structuredClone(value);
export const uid = () => globalThis.crypto.randomUUID();
export const same = (a, b) => a.x === b.x && a.y === b.y;
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export function columnName(index) {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export const holeName = (p) => `${columnName(p.x)}${p.y + 1}`;
export function newProject(cols = 30, rows = 20, name = "未命名项目") {
  return {
    format: "FantasyPerf",
    version: 1,
    name,
    board: { cols, rows, pitch: PITCH },
    defaults: { start: 3, end: 3 },
    objects: [],
    reference: null,
  };
}
export function objectFace(o) {
  return o.type === "solder" || o.mounting === "smd" ? "front" : "back";
}
export function editableOnFace(o, face, state) {
  return (
    objectFace(o) === face ||
    (o.type === "solder" &&
      face === "back" &&
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
export function screenX(x, cols, face) {
  return face === "front" ? cols - 1 - x : x;
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
  const p = newProject(20, 15, "双排模块 · 布线示例");
  p.objects = [
    {
      id: uid(),
      type: "component",
      name: "U1",
      x: 7,
      y: 4,
      rotation: 0,
      pins: regularPins("double", 8, 1, 3).map((pin, i) => ({
        ...pin,
        label: ["VCC", "IN1", "IN2", "GND", "OUT2", "OUT1", "EN", "VCC"][i],
      })),
    },
    {
      id: uid(),
      type: "component",
      name: "J1 · 电源",
      x: 2,
      y: 3,
      rotation: 0,
      pins: regularPins("single", 2).map((pin, i) => ({
        ...pin,
        label: ["VCC", "GND"][i],
      })),
    },
    {
      id: uid(),
      type: "component",
      name: "J2 · 输出",
      x: 14,
      y: 10,
      rotation: 0,
      pins: regularPins("single", 3).map((pin, i) => ({
        ...pin,
        label: ["OUT1", "OUT2", "GND"][i],
      })),
    },
    {
      id: uid(),
      type: "solder",
      name: "T1",
      points: [
        { x: 2, y: 3 },
        { x: 2, y: 4 },
        { x: 7, y: 4 },
      ],
    },
    {
      id: uid(),
      type: "solder",
      name: "T2",
      points: [
        { x: 3, y: 3 },
        { x: 3, y: 7 },
        { x: 7, y: 7 },
      ],
    },
    {
      id: uid(),
      type: "solder",
      name: "T3",
      points: [
        { x: 5, y: 7 },
        { x: 5, y: 11 },
        { x: 16, y: 11 },
        { x: 16, y: 10 },
      ],
    },
    {
      id: uid(),
      type: "wire",
      name: "W1",
      mode: "direct",
      color: COLORS[0],
      allowanceStart: 3,
      allowanceEnd: 3,
      points: [
        { x: 10, y: 5 },
        { x: 14, y: 10 },
      ],
    },
    {
      id: uid(),
      type: "wire",
      name: "W2",
      mode: "orthogonal",
      color: COLORS[1],
      allowanceStart: 3,
      allowanceEnd: 3,
      points: [
        { x: 10, y: 6 },
        { x: 12, y: 6 },
        { x: 12, y: 10 },
        { x: 15, y: 10 },
      ],
    },
  ];
  return p;
}
export function validateProject(raw) {
  const fail = (m) => {
      throw new Error(m);
    },
    num = (x, min, max) =>
      typeof x === "number" && Number.isFinite(x) && x >= min && x <= max,
    int = (x, min, max) => num(x, min, max) && Number.isInteger(x),
    str = (s, n = 100) => typeof s === "string" && s.length <= n;
  if (!raw || raw.format !== "FantasyPerf" || raw.version !== 1)
    fail("不支持的项目格式或版本");
  if (
    !str(raw.name) ||
    !raw.board ||
    !int(raw.board.cols, 2, 100) ||
    !int(raw.board.rows, 2, 100) ||
    raw.board.pitch !== PITCH
  )
    fail("板尺寸需为 2–100 孔，孔距需为 2.54 mm");
  if (
    !raw.defaults ||
    !num(raw.defaults.start, 0, 1000) ||
    !num(raw.defaults.end, 0, 1000)
  )
    fail("默认余量无效");
  if (!Array.isArray(raw.objects) || raw.objects.length > 3000)
    fail("对象数量超过 3000 或数据损坏");
  const ids = new Set();
  const result = newProject(raw.board.cols, raw.board.rows, raw.name);
  result.defaults = { start: raw.defaults.start, end: raw.defaults.end };
  if (raw.reference != null) {
    const r = raw.reference;
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

  for (const o of raw.objects) {
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
export function wireCSV(project) {
  const cell = (v) => `"${String(v).replaceAll('"', '""')}"`;
  const rows = [
    [
      "编号",
      "颜色",
      "起点",
      "终点",
      "模式",
      "路径长度 (mm)",
      "起点余量 (mm)",
      "终点余量 (mm)",
      "裁线长度 (mm)",
    ],
    ...project.objects
      .filter((o) => o.type === "wire")
      .map((o) => [
        /^[=+\-@\t\r]/.test(o.name) ? "'" + o.name : o.name,
        o.color,
        holeName(o.points[0]),
        holeName(o.points.at(-1)),
        o.mode === "direct" ? "直连" : "直角",
        lengthMM(o.points).toFixed(1),
        o.allowanceStart.toFixed(1),
        o.allowanceEnd.toFixed(1),
        cutLength(o).toFixed(1),
      ]),
  ];
  return "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
