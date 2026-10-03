import {
  columnName,
  objectFace,
  editableOnFace,
  pinPosition,
  screenX,
  bounds,
  objectPoints,
  intersection,
  cutLength,
} from "./core.js";
import { shellBounds, terminals, collisionIssues, pendingLogicalConnections } from "./design-checks.js";
const DARK_COLORS = {
  "#f3f6f7": "#151d24",
  "#314b4f0c": "#00000030",
  "#f0eee6": "#302f29",
  "#e7eeeb": "#23352f",
  "#dedbce": "#55513f",
  "#cfddd7": "#3e5a4f",
  "#d0bb85": "#b59d60",
  "#bda66f": "#d0b979",
  "#f7f5ee": "#272820",
  "#f7faf8": "#182920",
  "#ae985f": "#998347",
  "#bdcbc5": "#526e60",
  "#899b9f": "#a1b3bd",
  "#0b8878": "#50d2b5",
  "#82969b": "#a1b3bd",
  "#c8e6e04d": "#64bfa52b",
  "#f7fbfa66": "#45685a40",
  "#078876": "#64e2c2",
  "#8daaa2": "#84b9a2",
  "#06796e": "#7fe8ce",
  "#375f58": "#b4ddce",
  "#f8fffc": "#1c3128",
  "#008e7a": "#79e4c4",
  "#448172": "#8bccb3",
  "#8fa9a1": "#81a596",
  "#f0f6f2": "#23352f",
  "#385e57": "#c0e3d5",
  "#11b7a743": "#5bd9b847",
  "#168a81": "#50bcae",
  "#8a9799": "#a0abaa",
  "#7dd3c5": "#9be9d9",
  "#c3cdcc": "#d2dcda",
  "#259b8e": "#65d2ba",
  "#a3b0ae": "#c2d1cb",
  "#087e72": "#63d8ba",
  "#21978c": "#6ad8c4",
  white: "#1c3029",
  "#0b9180": "#62dbbc",
  "#168e7e": "#6be5c4",
  "#168e7e55": "#6be5c488",
  "#d9e2e4": "#34414b",
  "#078b7d12": "#66d5b526",
  "#078b7d": "#6ae1c1",
};
export const CELL = 28;
let logicSignature = null, cachedLogicLinks = [];
function logicalLinksFor(project) {
  // Mouse movement and zoom redraw frequently; rebuild the tree only when connectivity changes.
  const signature = JSON.stringify(project.objects.map((o) => o.type === "component"
    ? [o.x, o.y, o.rotation, o.pins.filter((p) => p.net).map((p) => [p.x, p.y, p.net])]
    : [o.type, o.points]));
  if (signature !== logicSignature) {
    cachedLogicLinks = pendingLogicalConnections(project); logicSignature = signature;
  }
  return cachedLogicLinks;
}
export function viewsFor(width, height, view, stacked = false) {
  if (stacked) height = Math.max(100, height - 96);
  if (view === "split" && stacked)
    return [
      { face: "front", x: 0, y: 0, w: width, h: height / 2 },
      { face: "back", x: 0, y: height / 2, w: width, h: height / 2 },
    ];
  return view === "split"
    ? [
        { face: "front", x: 0, y: 0, w: width / 2, h: height },
        { face: "back", x: width / 2, y: 0, w: width / 2, h: height },
      ]
    : [{ face: view, x: 0, y: 0, w: width, h: height }];
}
export function transform(board, view, camera) {
  return {
    scale: CELL * camera.zoom,
    ox:
      view.x +
      view.w / 2 -
      ((board.cols - 1) * CELL * camera.zoom) / 2 +
      camera.panX,
    oy:
      view.y +
      view.h / 2 -
      ((board.rows - 1) * CELL * camera.zoom) / 2 +
      camera.panY,
  };
}
export function toScreen(p, board, view, camera) {
  const t = transform(board, view, camera);
  return {
    x: t.ox + screenX(p.x, board.cols, view.face) * t.scale,
    y: t.oy + p.y * t.scale,
  };
}
export function fromScreen(p, board, view, camera, round = true) {
  const t = transform(board, view, camera);
  const x = screenX((p.x - t.ox) / t.scale, board.cols, view.face),
    y = (p.y - t.oy) / t.scale;
  return { x: round ? Math.round(x) : x, y: round ? Math.round(y) : y };
}
// Keep the visible target and the click radius identical, without overlapping adjacent pads.
export const pinHitRadius = (camera) => Math.min(Math.max(10, 8 * camera.zoom), CELL * camera.zoom / 2);
export function logicalPinAt(project, point, view, camera) {
  const radius = pinHitRadius(camera);
  let target = null, nearest = Infinity;
  for (const terminal of terminals(project)) {
    const p = toScreen(terminal.point, project.board, view, camera);
    const distance = Math.hypot(p.x - point.x, p.y - point.y);
    if (distance <= radius && distance < nearest) { target = terminal; nearest = distance; }
  }
  return target;
}
function text(ctx, s, x, y, color = "#708589", size = 11, align = "center") {
  ctx.fillStyle = color;
  ctx.font = `${size}px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(s, x, y);
}
function circle(ctx, x, y, r, fill, stroke, width = 1) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}
function line(ctx, points, color, width) {
  if (!points.length) return;
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}
export function labelBox(ctx, component, pin, board, view, camera) {
  const pos = toScreen(pinPosition(component, pin), board, view, camera),
    s = CELL * camera.zoom;
  const dx = (pin.labelDx ?? 0) * s * (view.face === "back" ? -1 : 1),
    dy = (pin.labelDy ?? 0) * s;
  const align = dx < -0.1 ? "right" : dx > 0.1 ? "left" : "center";
  const fontSize = Math.max(9, Math.min(13, 12 * camera.zoom));
  ctx.font = `${fontSize}px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif`;
  const width = ctx.measureText(pin.label).width;
  const x = pos.x + dx,
    y = pos.y + dy;
  return {
    x: align === "left" ? x : align === "right" ? x - width : x - width / 2,
    y: y - fontSize / 2 - 3,
    w: width,
    h: fontSize + 6,
    tx: x,
    ty: y,
    align,
    fontSize,
    pos,
  };
}
export function componentNameBox(ctx, component, board, view, camera) {
  const b = bounds([component]);
  const origin = { x: (b.minX + b.maxX) / 2, y: b.minY };
  const position = {
    x: origin.x + (component.nameDx ?? 0),
    y: origin.y + (component.nameDy ?? (b.maxY - b.minY) / 2),
  };
  const point = toScreen(position, board, view, camera);
  const fontSize = Math.max(10, Math.min(13, 12 * camera.zoom));
  ctx.font = `${fontSize}px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif`;
  const width = ctx.measureText(component.name).width;
  return {
    x: point.x - width / 2,
    y: point.y - fontSize / 2 - 3,
    w: width,
    h: fontSize + 6,
    tx: point.x,
    ty: point.y,
    fontSize,
    origin,
    position,
    pos: toScreen({ x: origin.x, y: (b.minY + b.maxY) / 2 }, board, view, camera),
  };
}
export function drawScene(
  canvas,
  project,
  state,
  { width, height, exporting = false } = {},
) {
  // Print/export retains the light palette regardless of the workspace preference.
  const dark = !exporting && document.documentElement.dataset.theme === "dark";
  const ink = (color) => (dark ? (DARK_COLORS[color] ?? color) : color);
  const ctx = canvas.getContext("2d");
  const dpr = exporting ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  width ??= canvas.clientWidth;
  height ??= canvas.clientHeight;
  if (
    canvas.width !== Math.round(width * dpr) ||
    canvas.height !== Math.round(height * dpr)
  ) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = ink("#f3f6f7");
  ctx.fillRect(0, 0, width, height);
  const board = project.board,
    views = viewsFor(width, height, state.view, !exporting && state.readOnly),
    camera = state.camera;
  const diagnostics = !exporting && !state.readOnly;
  const logicalLinks = diagnostics && (state.showLogic || state.tool === "logic") ? logicalLinksFor(project) : [];
  const physical = diagnostics ? collisionIssues(state.placement
    ? { ...project, objects: [...project.objects, state.placement] } : project) : [];
  for (const v of views) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(v.x, v.y, v.w, v.h);
    ctx.clip();
    const t = transform(board, v, camera),
      s = t.scale,
      to = (p) => toScreen(p, board, v, camera);
    const bx = t.ox - s * 0.7,
      by = t.oy - s * 0.7,
      bw = (board.cols + 0.4) * s,
      bh = (board.rows + 0.4) * s;
    ctx.shadowColor = ink("#314b4f0c");
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = v.face === "back" ? ink("#f0eee6") : ink("#e7eeeb");
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 6);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = v.face === "back" ? ink("#dedbce") : ink("#cfddd7");
    ctx.lineWidth = 1;
    ctx.stroke();
    for (let x = 0; x < board.cols; x++)
      for (let y = 0; y < board.rows; y++) {
        const p = to({ x, y });
        if (
          p.x < v.x - 10 ||
          p.x > v.x + v.w + 10 ||
          p.y < -10 ||
          p.y > height + 10
        )
          continue;
        if (v.face === "back")
          circle(
            ctx,
            p.x,
            p.y,
            Math.max(2.4, 4.8 * camera.zoom),
            ink("#d0bb85"),
            ink("#bda66f"),
            0.7,
          );
        circle(
          ctx,
          p.x,
          p.y,
          Math.max(1.2, 2.4 * camera.zoom),
          v.face === "back" ? ink("#f7f5ee") : ink("#f7faf8"),
          v.face === "back" ? ink("#ae985f") : ink("#bdcbc5"),
          0.8,
        );
      }
    const step = camera.zoom < 0.5 ? 5 : 1;
    for (let x = 0; x < board.cols; x += step) {
      const p = to({ x, y: 0 });
      text(ctx, columnName(x), p.x, by - 15, ink("#899b9f"), 10);
    }
    for (let y = 0; y < board.rows; y += step) {
      const p = to({ x: v.face === "back" ? board.cols - 1 : 0, y });
      text(ctx, String(y + 1), bx - 17, p.y, ink("#899b9f"), 10);
    }
    const a1 = to({ x: 0, y: 0 });
    ctx.fillStyle = ink("#0b8878");
    ctx.beginPath();
    ctx.moveTo(a1.x - 6, by + 2);
    ctx.lineTo(a1.x + 6, by + 2);
    ctx.lineTo(a1.x, by + 8);
    ctx.fill();
    if (state.readOnly && !exporting)
      text(
        ctx,
        v.face === "front" ? "元件面 · A1 左上" : "焊盘面 · A1 右上",
        v.x + v.w - 12,
        v.y + 20,
        ink("#82969b"),
        11,
        "right",
      );
    else if (exporting)
      text(
        ctx,
        `${v.face === "front" ? "正面 · 元件面" : "背面 · 焊盘面"}  /  A1 ${v.face === "front" ? "左上" : "右上"}`,
        v.x + v.w / 2,
        50,
        ink("#82969b"),
        11,
      );
    const active = (o) =>
      exporting ? objectFace(o) === v.face : editableOnFace(o, v.face, state);
    const renderObject = (o, ghost = false, preview = false) => {
      ctx.save();
      ctx.globalAlpha = ghost ? 0.2 : preview ? 0.65 : 1;
      const selected = !exporting && state.selected?.has(o.id) && !ghost;
      const shell = o.type === "component" ? shellBounds(o) : null;
      if (shell) {
        const a = to({ x: shell.minX, y: shell.minY }), b = to({ x: shell.maxX, y: shell.maxY });
        ctx.strokeStyle = o.ignoreCollision ? "#9a8d7b" : "#cc8b32";
        ctx.lineWidth = 1.3;
        ctx.setLineDash([7, 3]);
        ctx.strokeRect(Math.min(a.x, b.x), a.y, Math.abs(b.x - a.x), b.y - a.y);
        ctx.setLineDash([]);
      }
      if (o.mounting === "smd") {
        const [a, b] = objectPoints(o).map(to);
        const cx = (a.x + b.x) / 2,
          cy = (a.y + b.y) / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
        if (selected) {
          ctx.fillStyle = ink("#c8e6e04d");
          ctx.fillRect(-s * 0.49, -s * 0.31, s * 0.98, s * 0.62);
        }
        line(
          ctx,
          [
            { x: -s * 0.48, y: 0 },
            { x: s * 0.48, y: 0 },
          ],
          ink("#a3b0ae"),
          s * 0.19,
        );
        ctx.fillStyle =
          o.kind === "resistor" ? (dark ? "#718590" : "#3f535e") : "#c79b61";
        ctx.fillRect(-s * 0.31, -s * 0.18, s * 0.62, s * 0.36);
        ctx.fillStyle = dark ? "#d5dcde" : "#a6b1b8";
        ctx.fillRect(-s * 0.36, -s * 0.2, s * 0.15, s * 0.4);
        ctx.fillRect(s * 0.21, -s * 0.2, s * 0.15, s * 0.4);
        if (selected) {
          ctx.strokeStyle = ink("#078876");
          ctx.lineWidth = 1.5;
          ctx.strokeRect(-s * 0.4, -s * 0.24, s * 0.8, s * 0.48);
        }
        ctx.restore();
      } else if (o.type === "component") {
        const ps = objectPoints(o).map(to);
        const minX = Math.min(...ps.map((p) => p.x)),
          maxX = Math.max(...ps.map((p) => p.x)),
          minY = Math.min(...ps.map((p) => p.y)),
          maxY = Math.max(...ps.map((p) => p.y));
        ctx.fillStyle = selected ? ink("#c8e6e04d") : ink("#f7fbfa66");
        ctx.strokeStyle = selected ? ink("#078876") : ink("#8daaa2");
        ctx.lineWidth = selected ? 1.8 : 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.roundRect(
          minX - s * 0.32,
          minY - s * 0.3,
          maxX - minX + s * 0.64,
          maxY - minY + s * 0.6,
          4,
        );
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        for (const pin of o.pins) {
          const p = to(pinPosition(o, pin));
          circle(
            ctx,
            p.x,
            p.y,
            4 * camera.zoom,
            ink("#f8fffc"),
            selected ? ink("#008e7a") : ink("#448172"),
            1.8,
          );
          if (state.showLabels !== false && pin.label) {
            const b = labelBox(ctx, o, pin, board, v, camera);
            if (selected)
              line(ctx, [p, { x: b.tx, y: b.ty }], ink("#8fa9a1"), 0.7);
            ctx.lineWidth = 3;
            ctx.strokeStyle = ink("#f0f6f2");
            ctx.font = `${b.fontSize}px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif`;
            ctx.textAlign = b.align;
            ctx.textBaseline = "middle";
            ctx.strokeText(pin.label, b.tx, b.ty);
            text(
              ctx,
              pin.label,
              b.tx,
              b.ty,
              ink("#385e57"),
              b.fontSize,
              b.align,
            );
          }
        }
      } else {
        const ps = o.points.map(to),
          wire = o.type === "wire";
        if (selected) line(ctx, ps, ink("#11b7a743"), 11 * camera.zoom);
        if (wire) {
          line(ctx, ps, o.color, 3.7 * camera.zoom); // Bridges are visual only; length always uses the original centerline.
          if (!ghost) {
            for (const previous of project.objects) {
              if (previous.id === o.id) break;
              if (previous.type !== "wire") continue;
              for (let i = 1; i < ps.length; i++) {
                const a = ps[i - 1],
                  b = ps[i];
                const angle = Math.atan2(b.y - a.y, b.x - a.x);
                for (let j = 1; j < previous.points.length; j++) {
                  const cross = intersection(
                    a,
                    b,
                    to(previous.points[j - 1]),
                    to(previous.points[j]),
                  );
                  if (!cross) continue;
                  ctx.save();
                  ctx.translate(cross.x, cross.y);
                  ctx.rotate(angle);
                  ctx.fillStyle = ink("#e7eeeb");
                  ctx.fillRect(
                    -5 * camera.zoom,
                    -5 * camera.zoom,
                    10 * camera.zoom,
                    10 * camera.zoom,
                  );
                  ctx.beginPath();
                  ctx.arc(0, 0, 4 * camera.zoom, Math.PI, 0);
                  ctx.strokeStyle = o.color;
                  ctx.lineWidth = 3.7 * camera.zoom;
                  ctx.stroke();
                  ctx.restore();
                }
              }
            }
          }
          for (const p of [ps[0], ps.at(-1)]) {
            circle(
              ctx,
              p.x,
              p.y,
              5 * camera.zoom,
              ink("#f7faf8"),
              o.color,
              2 * camera.zoom,
            );
            circle(ctx, p.x, p.y, 1.5 * camera.zoom, o.color);
          }
          const mid = ps[Math.floor((ps.length - 1) / 2)],
            end = ps[Math.ceil((ps.length - 1) / 2)];
          text(
            ctx,
            `${o.name}${selected ? " · " + cutLength(o).toFixed(1) + " mm" : ""}`,
            (mid.x + end.x) / 2 + 5,
            (mid.y + end.y) / 2 - 12,
            o.color,
            11,
            "left",
          );
        } else {
          line(
            ctx,
            ps,
            selected ? ink("#168a81") : ink("#8a9799"),
            6.3 * camera.zoom,
          );
          line(
            ctx,
            ps,
            selected ? ink("#7dd3c5") : ink("#c3cdcc"),
            3 * camera.zoom,
          );
          for (const p of [ps[0], ps.at(-1)])
            circle(
              ctx,
              p.x,
              p.y,
              3.5 * camera.zoom,
              selected ? ink("#259b8e") : ink("#a3b0ae"),
            );
        }
        if (selected && !state.readOnly) {
          ps.forEach((p) => {
            ctx.fillStyle = ink("white");
            ctx.strokeStyle = ink("#087e72");
            ctx.lineWidth = 1.5;
            ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
            ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
          });
        }
      }
      if (o.type === "component") {
        const b = componentNameBox(ctx, o, board, v, camera);
        if (selected && o.name)
          line(ctx, [b.pos, { x: b.tx, y: b.ty }], ink("#8fa9a1"), 0.7);
        ctx.lineWidth = 3;
        ctx.strokeStyle = ink("#f0f6f2");
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.strokeText(o.name, b.tx, b.ty);
        text(ctx, o.name, b.tx, b.ty,
          selected ? ink("#06796e") : ink("#375f58"), b.fontSize);
      }
      if (!exporting && !ghost && o.ignoreCollision) {
        const pos = o.type === "component" ? componentNameBox(ctx, o, board, v, camera)
          : { tx: to(o.points[0]).x, ty: to(o.points[0]).y };
        text(ctx, "忽略碰撞", pos.tx, pos.ty - 14, "#b7792d", 9);
      }
      ctx.restore();
    };
    if (state.showGhost !== false)
      for (const o of project.objects.filter((o) => !active(o)))
        renderObject(o, true);
    // Draw solder below component labels in either editing view.
    for (const o of project.objects
      .filter(active)
      .sort(
        (a, b) => Number(b.type === "solder") - Number(a.type === "solder"),
      ))
      renderObject(o);
    if (!exporting && !state.readOnly && (state.showLogic || state.tool === "logic")) {
      for (const terminal of terminals(project)) {
        const p = to(terminal.point);
        if (terminal.pin.nc) {
          line(ctx, [{ x: p.x - 5, y: p.y - 5 }, { x: p.x + 5, y: p.y + 5 }], "#9967bd", 1.5);
          line(ctx, [{ x: p.x - 5, y: p.y + 5 }, { x: p.x + 5, y: p.y - 5 }], "#9967bd", 1.5);
        }
      }
      ctx.setLineDash([4, 5]);
      const named = new Set();
      for (const link of logicalLinks) {
        const a = to(link.from), b = to(link.to);
        line(ctx, [a, b], "#9967bd", 1.2);
        if (!named.has(link.net)) text(ctx, link.net, a.x + 7, a.y + 9, "#9967bd", 10, "left");
        named.add(link.net);
      }
      ctx.setLineDash([]);
      if (state.logicalStart) {
        const o = project.objects.find((o) => o.id === state.logicalStart.id), pin = o?.pins[state.logicalStart.index];
        if (pin) { const p = to(pinPosition(o, pin)); circle(ctx, p.x, p.y, 9, null, "#9967bd", 2); }
      }
    }
    if (!exporting && !state.readOnly)
      for (const point of state.checkHighlight ?? []) {
        const p = to(point); circle(ctx, p.x, p.y, 10, null, "#dc6654", 2);
      }
    if (!exporting && state.placement && v.face === objectFace(state.placement))
      renderObject(state.placement, false, true);
    if (
      !exporting &&
      state.draft &&
      (state.draft.type === "solder" || v.face === "front")
    ) {
      const ps = state.draft.preview ?? state.draft.points;
      if (ps.length)
        line(
          ctx,
          ps.map(to),
          state.draft.type === "solder" ? ink("#21978c") : state.wireColor,
          3,
        );
      ps.forEach((p) => {
        const q = to(p);
        circle(ctx, q.x, q.y, 4, ink("white"), ink("#0b9180"), 1.5);
      });
    }
    if (!exporting && state.hover) {
      const p = to(state.hover);
      circle(ctx, p.x, p.y, pinHitRadius(camera), null, ink("#168e7e"), 1.4);
      line(
        ctx,
        [
          { x: p.x - 12, y: p.y },
          { x: p.x + 12, y: p.y },
        ],
        ink("#168e7e55"),
        1,
      );
      line(
        ctx,
        [
          { x: p.x, y: p.y - 12 },
          { x: p.x, y: p.y + 12 },
        ],
        ink("#168e7e55"),
        1,
      );
    }
    // Conflict markers remain above objects, placement previews and the cursor.
    for (const issue of physical) for (const point of issue.points) {
      const p = to(point);
      circle(ctx, p.x, p.y, 10, ink("#f0f6f2"), "#dc6654", 1.5);
      line(ctx, [{ x: p.x - 5, y: p.y - 5 }, { x: p.x + 5, y: p.y + 5 }], "#dc6654", 2);
      line(ctx, [{ x: p.x - 5, y: p.y + 5 }, { x: p.x + 5, y: p.y - 5 }], "#dc6654", 2);
    }
    ctx.restore();
  }
  if (state.view === "split") {
    line(
      ctx,
      [
        !exporting && state.readOnly
          ? { x: 0, y: views[1].y }
          : { x: width / 2, y: 0 },
        !exporting && state.readOnly
          ? { x: width, y: views[1].y }
          : { x: width / 2, y: height },
      ],
      ink("#d9e2e4"),
      1,
    );
  }
  if (!exporting && state.marquee) {
    const { start, end } = state.marquee;
    ctx.fillStyle = ink("#078b7d12");
    ctx.strokeStyle = ink("#078b7d");
    ctx.setLineDash([4, 3]);
    ctx.fillRect(start.x, start.y, end.x - start.x, end.y - start.y);
    ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
    ctx.setLineDash([]);
  }
  if (exporting) {
    text(ctx, project.name, 24, 25, ink("#24474a"), 18, "left");
    text(
      ctx,
      `${board.cols} × ${board.rows} 孔  ·  孔距 2.54 mm  ·  FantasyPerf`,
      24,
      height - 20,
      ink("#799195"),
      12,
      "left",
    );
  }
}
