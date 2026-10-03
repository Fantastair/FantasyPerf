import { pinPosition, objectPoints, objectFace, holeName } from "./core.js";

const key = (p) => `${p.x},${p.y}`;
export function terminals(project) {
  return project.objects.filter((o) => o.type === "component").flatMap((object) =>
    object.pins.map((pin, index) => ({ object, pin, index, point: pinPosition(object, pin) })),
  );
}
export function declarationStatus(project) {
  const pins = terminals(project), undeclared = pins.filter((t) => !t.pin.net && !t.pin.nc);
  return { total: pins.length, undeclared, enabled: pins.length > 0 && undeclared.length === 0 };
}
export function defaultShell(o) {
  const xs = o.pins.map((p) => p.x), ys = o.pins.map((p) => p.y);
  if (o.mounting === "smd") return { enabled: true, x: 0.15, y: -0.25, w: 0.7, h: 0.5 };
  const x = Math.min(...xs) - 0.4, y = Math.min(...ys) - 0.4;
  return { enabled: true, x, y, w: Math.max(...xs) - x + 0.4, h: Math.max(...ys) - y + 0.4 };
}
export function shellBounds(o) {
  if (!o.shell?.enabled) return null;
  const { x, y, w, h } = o.shell;
  const ps = [{ x, y }, { x: x + w, y }, { x, y: y + h }, { x: x + w, y: y + h }]
    .map((p) => pinPosition(o, p));
  return { minX: Math.min(...ps.map((p) => p.x)), maxX: Math.max(...ps.map((p) => p.x)),
    minY: Math.min(...ps.map((p) => p.y)), maxY: Math.max(...ps.map((p) => p.y)) };
}
const overlaps = (a, b) => a && b && a.minX < b.maxX - 1e-8 && b.minX < a.maxX - 1e-8 &&
  a.minY < b.maxY - 1e-8 && b.minY < a.maxY - 1e-8;
function solderHitsShell(o, box) {
  return o.points.some((b, i) => {
    if (!i) return false;
    const a = o.points[i - 1];
    return a.y === b.y
      ? a.y > box.minY && a.y < box.maxY && Math.min(a.x, b.x) < box.maxX && Math.max(a.x, b.x) > box.minX
      : a.x > box.minX && a.x < box.maxX && Math.min(a.y, b.y) < box.maxY && Math.max(a.y, b.y) > box.minY;
  });
}
function occupancy(project) {
  const cells = new Map();
  for (const o of project.objects) {
    if (o.ignoreCollision || (o.type !== "wire" && (o.type !== "component" || o.mounting === "smd"))) continue;
    const points = o.type === "wire" ? [o.points[0], o.points.at(-1)] : objectPoints(o);
    for (const point of points) {
      const k = key(point);
      if (!cells.has(k)) cells.set(k, { point, ids: new Set() });
      cells.get(k).ids.add(o.id);
    }
  }
  return cells;
}
// Reports are bounded for the UI. accept lets an operation stop at its first new conflict.
export function collisionIssues(project, { limit = 200, accept = () => true } = {}) {
  const issues = [];
  const add = (issue) => { if (accept(issue)) issues.push({ severity: "error", ...issue }); return issues.length >= limit; };
  const names = new Map(project.objects.map((o) => [o.id, o.name || "未命名"]));
  for (const [k, cell] of occupancy(project)) {
    if (cell.ids.size < 2) continue;
    const ids = [...cell.ids];
    if (add({ kind: "hole", key: `hole:${k}`, ids, points: [cell.point],
      message: `${holeName(cell.point)} 插孔冲突：${ids.slice(0, 4).map((id) => names.get(id)).join("、")}` })) return issues;
  }
  const shells = project.objects.filter((o) => o.type === "component" && o.shell?.enabled && !o.ignoreCollision)
    .map((o) => ({ o, box: shellBounds(o) })).sort((a, b) => a.box.minX - b.box.minX);
  for (let i = 0; i < shells.length; i++) {
    const a = shells[i];
    for (let j = i + 1; j < shells.length && shells[j].box.minX < a.box.maxX; j++) {
      const b = shells[j];
      if (objectFace(a.o) !== objectFace(b.o) || !overlaps(a.box, b.box)) continue;
      if (add({ kind: "shell", key: `shell:${[a.o.id, b.o.id].sort().join("/")}`, ids: [a.o.id, b.o.id],
        points: [objectPoints(a.o)[0], objectPoints(b.o)[0]], message: `${a.o.name} 与 ${b.o.name} 外壳重叠` })) return issues;
    }
    if (objectFace(a.o) !== "back") continue;
    for (const b of project.objects) {
      if (b.type !== "solder" || b.ignoreCollision || !solderHitsShell(b, a.box)) continue;
      if (add({ kind: "shell-solder", key: `shell-solder:${a.o.id}/${b.id}`, ids: [a.o.id, b.id],
        points: [objectPoints(a.o)[0]], message: `${b.name} 穿过 ${a.o.name} 的外壳` })) return issues;
    }
  }
  return issues;
}
export function firstNewCollision(before, after) {
  const previous = new Map(before.objects.map((o) => [o.id, o]));
  const footprint = (o) => JSON.stringify([o.type, o.mounting, o.x, o.y, o.rotation,
    o.pins?.map((p) => [p.x, p.y]), o.points, !!o.ignoreCollision, o.shell?.enabled ? o.shell : null]);
  // Label / intent changes and pure deletions cannot create a physical conflict.
  if (after.objects.every((o) => previous.has(o.id) && footprint(o) === footprint(previous.get(o.id)))) return null;
  const cellsByObject = (p) => {
    const result = new Map();
    for (const [cell, { ids }] of occupancy(p)) for (const id of ids) {
      if (!result.has(id)) result.set(id, new Set());
      result.get(id).add(cell);
    }
    return result;
  };
  const oldCells = cellsByObject(before), newCells = cellsByObject(after);
  const commonCount = (cells, a, b) => {
    const x = cells.get(a), y = cells.get(b);
    if (!x || !y) return 0;
    let count = 0;
    for (const k of x.size < y.size ? x : y) if ((x.size < y.size ? y : x).has(k)) count++;
    return count;
  };
  const existed = (issue) => {
    if (issue.kind === "hole") {
      for (let i = 0; i < issue.ids.length; i++)
        for (let j = i + 1; j < issue.ids.length; j++)
          if (commonCount(newCells, issue.ids[i], issue.ids[j]) > commonCount(oldCells, issue.ids[i], issue.ids[j])) return false;
      return true;
    }
    const [a, b] = issue.ids.map((id) => previous.get(id));
    if (!a || !b || a.ignoreCollision || b.ignoreCollision) return false;
    return issue.kind === "shell" ? objectFace(a) === objectFace(b) && overlaps(shellBounds(a), shellBounds(b))
      : a.shell?.enabled && solderHitsShell(b, shellBounds(a));
  };
  return collisionIssues(after, { limit: 1, accept: (issue) => !existed(issue) })[0] ?? null;
}

export function analyzeConnections(project) {
  const status = declarationStatus(project);
  if (!status.enabled) return { ...status, errors: [], warnings: [] };
  const pins = terminals(project), parent = new Map(), touched = new Set();
  const root = (k) => {
    if (!parent.has(k)) parent.set(k, k);
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(k) !== k) { const next = parent.get(k); parent.set(k, r); k = next; }
    return r;
  };
  const join = (a, b) => { const x = root(a), y = root(b); if (x !== y) parent.set(x, y); };
  for (const o of project.objects) {
    if (o.type === "wire") {
      const a = key(o.points[0]), b = key(o.points.at(-1));
      join(a, b); touched.add(a); touched.add(b);
    } else if (o.type === "solder") {
      for (let i = 1; i < o.points.length; i++) {
        const a = o.points[i - 1], b = o.points[i];
        const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y), n = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
        let previous = key(a); touched.add(previous);
        for (let j = 1; j <= n; j++) {
          const k = key({ x: a.x + dx * j, y: a.y + dy * j });
          join(previous, k); touched.add(k); previous = k;
        }
      }
    }
  }
  // Component pins, including SMD resistor/capacitor ends, are NEVER joined internally.
  const actual = new Map(), nets = new Map();
  for (const t of pins) {
    const r = root(key(t.point));
    if (!actual.has(r)) actual.set(r, []);
    actual.get(r).push(t);
    if (t.pin.net) {
      if (!nets.has(t.pin.net)) nets.set(t.pin.net, new Map());
      const groups = nets.get(t.pin.net);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(t);
    }
  }
  const issue = (kind, message, ts, severity = "error") => ({ kind, message, severity,
    ids: [...new Set(ts.map((t) => t.object.id))], points: ts.map((t) => t.point) });
  const errors = [], warnings = [];
  for (const [net, groups] of nets) {
    if (groups.size > 1) errors.push(issue("open", `连接组「${net}」漏接：分为 ${groups.size} 个实际连通部分`, [...groups.values()].flat()));
  }
  for (const ts of actual.values()) {
    const names = [...new Set(ts.map((t) => t.pin.net).filter(Boolean))];
    if (names.length > 1) errors.push(issue("short", `误短接：连接组 ${names.map((n) => `「${n}」`).join("、")} 实际相连`, ts));
    for (const t of ts.filter((t) => t.pin.nc))
      if (ts.length > 1) errors.push(issue("nc", `${t.object.name} 第 ${t.index + 1} 脚（NC）连接了其他引脚`, ts));
    for (const t of ts.filter((t) => !t.pin.nc && !touched.has(key(t.point))))
      warnings.push(issue("floating", `${t.object.name} 第 ${t.index + 1} 脚没有实际连线`, [t], "warning"));
  }
  // A wire end without another conductor or terminal at that hole is a dangling tail.
  const pinCells = new Set(pins.map((t) => key(t.point)));
  const contacts = new Map();
  for (const o of project.objects) {
    if (o.type === "solder") {
      for (let i = 1; i < o.points.length; i++) {
        const a = o.points[i - 1], b = o.points[i], n = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
        for (let j = 0; j <= n; j++) {
          const k = key({ x: a.x + Math.sign(b.x - a.x) * j, y: a.y + Math.sign(b.y - a.y) * j });
          if (!contacts.has(k)) contacts.set(k, new Set());
          contacts.get(k).add(o.id);
        }
      }
    } else if (o.type === "wire") for (const p of [o.points[0], o.points.at(-1)]) {
      const k = key(p); if (!contacts.has(k)) contacts.set(k, new Set()); contacts.get(k).add(o.id);
    }
  }
  for (const o of project.objects.filter((o) => o.type === "wire"))
    for (const p of [o.points[0], o.points.at(-1)])
      if (!pinCells.has(key(p)) && contacts.get(key(p))?.size === 1)
        warnings.push({ kind: "dangling", severity: "warning", ids: [o.id], points: [p], message: `${o.name} 在 ${holeName(p)} 的端点悬空` });
  return { ...status, errors, warnings };
}
