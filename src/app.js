import {
  COMPONENT_VERSION, parseComponentVersion,
  validateComponent, parseComponentFile, createComponentFile,
} from "./component-files.js";
import { COMPONENT_LIBRARY, instantiateLibraryItem, unlabeledPins } from "./library.js";
import { installViewerGestures } from "./viewer.js";
import { createReferenceLayer } from "./reference.js";
import {
  PITCH,
  FORMAT,
  FORMAT_VERSION,
  APP_VERSION,
  compareVersions,
  parseVersion,
  objectFace,
  faceName,
  editableOnFace,
  smdPlacement,
  COLORS,
  clone,
  uid,
  same,
  isHole,
  clamp,
  holeName,
  newProject,
  pinPosition,
  objectPoints,
  bounds,
  inBoard,
  fits,
  moveObjects,
  constrainedDelta,
  orthogonal,
  cleanPath,
  lengthMM,
  cutLength,
  editVertex,
  distanceToSegment,
  History,
  demoProject,
  validateProject,
  objectsCSV,
} from "./core.js";
import {
  CELL,
  viewsFor,
  toScreen,
  fromScreen,
  labelBox,
  componentNameBox,
  logicalPinAt,
  drawScene,
} from "./renderer.js";
import { collisionIssues, firstNewCollision, declarationStatus, analyzeConnections, defaultShell, terminals } from "./design-checks.js";

const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
// 存档键名跨格式版本保持不变：格式版本写在存档 JSON 内部，旧存档仍会被读取并升级。
const STORE = "fantasyperf.project.v1",
  TEMPLATES = "fantasyperf.templates.v1";
let project = newProject(),
  history = new History(),
  clipboard = [],
  savedTimer,
  toastTimer,
  pendingFrame = false,
  space = false,
  gesture = null,
  lastHit = null,
  panel = "properties",
  lastSave = "",
  storageBlocked = false;
const viewerQuery = new URLSearchParams(location.search).get("view") === "1";
const mobileMedia = matchMedia(
  "(max-width: 999px), (hover: none) and (pointer: coarse)",
);
let readOnly = viewerQuery || mobileMedia.matches;
let desktopSession = null;
document.documentElement.dataset.readonly = String(readOnly);
let templates = [], importedComponents = [];
let legacyTemplateRecords = [], legacyTemplateIndices = [], legacyTemplateSnapshot = null;
try {
  const raw = localStorage.getItem(STORE);
  if (raw) {
    project = validateProject(JSON.parse(raw));
    lastSave = JSON.stringify(project);
  }
} catch (e) {
  storageBlocked = true;
  setTimeout(
    () =>
      toast(
        "自动存档无法读取，已打开空白板；原存档不会被覆盖，请先导出或恢复。",
      ),
    100,
  );
}
function readLegacyTemplates() {
  const snapshot = localStorage.getItem(TEMPLATES);
  const legacy = JSON.parse(snapshot || "[]");
  if (!Array.isArray(legacy)) throw new Error("旧模板数据无效");
  const valid = [], indices = [];
  for (const [index, raw] of legacy.entries()) {
    try {
      valid.push(validateComponent(raw));
      indices.push(index);
    } catch {}
    if (valid.length === 100) break;
  }
  templates = valid;
  legacyTemplateIndices = indices;
  legacyTemplateRecords = legacy;
  legacyTemplateSnapshot = snapshot;
}
try { readLegacyTemplates(); } catch {}
const state = {
  view: "front",
  tool: "select",
  camera: { zoom: 1, panX: 0, panY: 0 },
  selected: new Set(),
  hover: null,
  showGhost: true,
  showLabels: true,
  wireMode: "direct",
  wireColor: COLORS[0],
  wireIgnoreCollision: false,
  logicalStart: null,
  showLogic: false,
  checkHighlight: [],
  draft: null,
  placement: null,
  marquee: null,
  referenceSelected: false,
};
const canvas = $("#board"),
  modal = $("#modal");
const referenceLayer = createReferenceLayer($(".stage"), {
  getProject: () => project,
  commit,
  notify: toast,
  onVisibilityChange: () => refresh(),
  onSelect: () => {
    state.referenceSelected = true;
    state.selected.clear();
    panel = "properties";
    refresh();
  },
});

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 3600);
}
function requestDraw() {
  if (pendingFrame) return;
  pendingFrame = true;
  requestAnimationFrame(() => {
    pendingFrame = false;
    drawScene(canvas, project, state);
    referenceLayer.render(state.referenceSelected);
  });
}
function save() {
  clearTimeout(savedTimer);
  $("#save-status").textContent = "保存中…";
  savedTimer = setTimeout(flushSave, 300);
}
function flushSave() {
  if (readOnly) return;
  clearTimeout(savedTimer);
  if (gesture?.before) {
    savedTimer = setTimeout(flushSave, 300);
    return;
  }
  if (storageBlocked) {
    $("#save-status").textContent = "原存档已保护 · 请导出";
    return;
  }
  try {
    const serialized = JSON.stringify(project);
    localStorage.setItem(STORE, serialized);
    lastSave = serialized;
    $("#save-status").textContent = "已自动保存到本机";
  } catch {
    $("#save-status").textContent = "自动保存失败 · 请导出";
    toast("浏览器存储不可用或已满，请导出项目文件备份。");
  }
}
function changed(options) {
  state.checkHighlight = [];
  save();
  refresh(options);
}
function commit(fn, options) {
  if (readOnly) return;
  const before = clone(project);
  fn();
  const conflict = !options?.allowConflicts && firstNewCollision(before, project, { includeHoles: false });
  if (conflict) {
    project = before;
    toast(conflict.message + "。可为特殊安装勾选忽略碰撞。");
    refresh();
    return false;
  }
  if (JSON.stringify(before) !== JSON.stringify(project)) {
    history.push(before);
    changed(options);
  } else refresh(options);
  return true;
}
function selectedObjects() {
  return project.objects.filter((o) => state.selected.has(o.id));
}
function nameNext(prefix) {
  let n = 1;
  while (project.objects.some((o) => o.name === prefix + n)) n++;
  return prefix + n;
}
function cancel() {
  state.logicalStart = null;
  state.draft = null;
  state.placement = null;
  state.marquee = null;
  if (gesture?.before) project = gesture.before;
  gesture = null;
  refresh();
}
function setTool(tool) {
  if (readOnly) return;
  state.referenceSelected = false;
  if (state.draft || state.placement) cancel();
  state.logicalStart = null;
  state.tool = tool;
  if (tool === "component" || tool === "wire") panel = "properties";
  if (tool === "logic") state.showLogic = true;
  state.checkHighlight = [];
  state.selected.clear();
  if ((tool === "wire" || tool === "component") && state.view !== "split")
    state.view = "front";
  if (tool === "component") libraryDialog();
  refresh();
}
function setView(view) {
  const logic = state.tool === "logic", start = state.logicalStart;
  cancel();
  state.view = view;
  state.selected.clear();
  state.tool = logic ? "logic" : "select";
  state.logicalStart = logic ? start : null;
  fit();
  refresh();
}
function fit() {
  const v = viewsFor(
    canvas.clientWidth,
    canvas.clientHeight,
    state.view,
    readOnly,
  )[0];
  const w = v.w,
    h = v.h;
  state.camera = {
    zoom: clamp(
      Math.min(
        (w - (readOnly ? 56 : 100)) / ((project.board.cols + 1) * CELL),
        (h - (readOnly ? 100 : 160)) / ((project.board.rows + 1) * CELL),
      ),
      0.15,
      3,
    ),
    panX: 0,
    panY: 0,
  };
  requestDraw();
  $("#zoom-label").textContent = Math.round(state.camera.zoom * 100) + "%";
}
function zoom(factor, anchor) {
  const old = state.camera.zoom,
    next = clamp(old * factor, 0.15, 4);
  const v = viewAt(
    anchor ?? { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 },
  );
  anchor ??= { x: v.x + v.w / 2, y: v.y + v.h / 2 };
  state.camera.panX =
    ((state.camera.panX - (anchor.x - v.x - v.w / 2)) * next) / old +
    (anchor.x - v.x - v.w / 2);
  state.camera.panY =
    ((state.camera.panY - (anchor.y - v.y - v.h / 2)) * next) / old +
    (anchor.y - v.y - v.h / 2);
  state.camera.zoom = next;
  $("#zoom-label").textContent = Math.round(next * 100) + "%";
  requestDraw();
}
function refresh({ preserveInspector = false } = {}) {
  $("#app-version").textContent = `v${APP_VERSION}`;
  state.readOnly = readOnly;
  $("#project-name").readOnly = readOnly;
  if (readOnly) $("#save-status").textContent = "只读查看";
  $("#viewer-welcome").hidden = !readOnly || project.objects.length > 0;
  $('[data-action="viewer-reference"]').disabled = !project.reference;
  if (!project.reference) state.referenceSelected = false;
  $("#project-name").value = project.name;
  $("#summary").textContent =
    `${project.board.cols} × ${project.board.rows} 孔 · 2.54 mm`;
  $$("[data-view]").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === state.view),
  );
  $$("[data-tool]").forEach((b) =>
    b.classList.toggle("active", b.dataset.tool === state.tool),
  );
  $('[data-action="undo"]').disabled = !history.past.length;
  $('[data-action="redo"]').disabled = !history.future.length;
  $("#view-label").textContent =
    state.view === "split" ? "两面同步 · 左右镜像" : faceName(state.view);
  $("#view-label").hidden = !readOnly;
  $("#status-face").textContent =
    state.view === "split"
      ? "并排核对"
      : state.view === "front"
        ? "元件面"
        : "焊盘面";
  $("#mode-options").innerHTML =
    state.tool === "wire"
      ? `<select id="wire-mode" aria-label="跳线模式"><option value="direct" ${state.wireMode === "direct" ? "selected" : ""}>直连跳线</option><option value="orthogonal" ${state.wireMode === "orthogonal" ? "selected" : ""}>直角跳线</option></select>`
      : "";
  $("#wire-mode")?.addEventListener("change", (e) => {
    state.draft = null;
    state.wireMode = e.target.value;
    requestDraw();
    updateHint();
  });
  $("#empty-tip").hidden =
    readOnly ||
    project.objects.length > 0 ||
    !!project.reference ||
    state.tool !== "select";
  const declarations = declarationStatus(project);
  $("#check-count").textContent = declarations.undeclared.length ? `${declarations.undeclared.length} 待声明` : "";
  $("#wire-count").textContent = project.objects.filter(
    (o) => o.type === "wire",
  ).length;
  $("#selection-hint").textContent = state.selected.size
    ? `已选 ${state.selected.size} 个对象 · 线路绑定孔位`
    : "孔距 2.54 mm";
  canvas.style.cursor = space
    ? "grab"
    : state.tool === "select"
      ? "default"
      : "crosshair";
  updateHint();
  if (!preserveInspector) renderInspector();
  requestDraw();
}
function updateHint() {
  if (readOnly) {
    $("#status-hint").textContent = "只读 · 单指拖动 · 双指缩放 · 点击查看详情";
    return;
  }
  const hints = {
    select: "点击选择 · Shift 多选 · 拖动框选 · 空格拖动平移",
    component:
      state.placement?.mounting === "smd"
        ? "点击相邻焊盘之间放置 · R 旋转 · 右键 / Esc 取消"
        : "点击孔位放置 · R 旋转 · 右键 / Esc 取消",
    logic: state.logicalStart ? "点击第二个引脚建立逻辑连接 · 可直接跨面选择 · Esc 取消" : "点击两个元件引脚声明同组 · 可直接选择另一面的引脚",
    solder: "两面均可画锡线 · Tab 切换拐弯 · Enter 完成 · 右键退出",
    wire:
      state.wireMode === "direct"
        ? "点击起点和终点 · 右键 / Esc 取消"
        : "中间路径半格吸附，两端落在焊盘 · Tab 换向 · Enter / 双击完成",
  };
  $("#status-hint").textContent = hints[state.tool];
}
function numberField(
  id,
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  unit = "",
) {
  return `<div class="field"><label for="${id}">${label}</label><div class="unit-field"><input id="${id}" type="number" min="${min}" max="${max}" step="${step}" value="${value}">${unit ? `<span>${unit}</span>` : ""}</div></div>`;
}
function field(id, label, value) {
  return `<div class="field"><label for="${id}">${label}</label><input id="${id}" maxlength="100" value="${esc(value)}"></div>`;
}
function bindNumber(id, fn) {
  $(id)?.addEventListener("change", (e) => {
    const el = e.target,
      n = el.valueAsNumber;
    if (!el.checkValidity() || !Number.isFinite(n)) {
      toast("请输入有效范围内的数值");
      renderInspector();
      return;
    }
    fn(n);
  });
}
function renderInspector() {
  if (readOnly) {
    renderViewerInspector();
    return;
  }
  const root = $("#inspector-content"),
    selected = selectedObjects();
  $$("[data-panel]").forEach((b) =>
    b.classList.toggle("active", b.dataset.panel === panel),
  );
  if (panel === "checks") { renderChecks(root); return; }
  if (panel === "wires") {
    const wires = project.objects.filter((o) => o.type === "wire");
    root.innerHTML = `<h2 class="section-heading">裁线清单 <small>${wires.length} 根</small></h2><p class="muted">贴板路径 + 两端余量，单位 mm</p>${wires.length ? wires.map((o) => `<button class="wire-row" data-wire-id="${esc(o.id)}"><span class="wire-swatch" style="background:${o.color}"></span><span><strong>${esc(o.name)}</strong><small>${holeName(o.points[0])} → ${holeName(o.points.at(-1))}</small></span><span class="wire-length">${cutLength(o).toFixed(1)}</span></button>`).join("") : `<div class="empty-list">还没有跳线<br>选择左侧「跳线」连接两个孔位</div>`}${wires.length ? `<div class="data-row"><span>总裁线长度</span><strong>${wires.reduce((s, o) => s + cutLength(o), 0).toFixed(1)} mm</strong></div><button class="wide" data-action="csv">导出全部元件清单</button>` : ""}`;
    root.querySelectorAll("[data-wire-id]").forEach(
      (b) =>
        (b.onclick = () => {
          state.selected = new Set([b.dataset.wireId]);
          state.view = state.view === "split" ? "split" : "front";
          state.tool = "select";
          panel = "properties";
          refresh();
        }),
    );
    return;
  }
  if (state.referenceSelected && project.reference) {
    referenceLayer.properties(root);
    return;
  }
  if (selected.length > 1) {
    root.innerHTML = `<h2 class="section-heading">已选 ${selected.length} 个对象</h2><div class="info-box">拖动选中对象可一起移动。元件与线路按相同孔距整体平移。</div><button class="wide" data-action="copy">复制所选</button><button class="wide danger" data-action="delete">删除所选</button>`;
    return;
  }
  if (!selected.length) {
    root.innerHTML = `<h2 class="section-heading">洞洞板 <small>独立焊盘</small></h2><div class="field-grid">${numberField("cols", "列数", project.board.cols, 2, 100)}${numberField("rows", "行数", project.board.rows, 2, 100)}</div><div class="info-box">${((project.board.cols - 1) * PITCH).toFixed(2)} × ${((project.board.rows - 1) * PITCH).toFixed(2)} mm<br>首末孔中心距 · 固定孔距 2.54 mm</div><hr class="rule"><h2 class="section-heading">视图显示</h2><label class="check"><input id="ghost" type="checkbox" ${state.showGhost ? "checked" : ""}>显示另一面参考</label><label class="check"><input id="labels" type="checkbox" ${state.showLabels ? "checked" : ""}>显示引脚标注</label><hr class="rule"><h2 class="section-heading">新跳线默认余量</h2><div class="field-grid">${numberField("default-start", "起点", project.defaults.start, 0, 1000, 0.1, "mm")}${numberField("default-end", "终点", project.defaults.end, 0, 1000, 0.1, "mm")}</div><p class="muted">仅应用于之后绘制的跳线，已绘制的跳线可单独修改。</p>${state.tool === "wire" ? `<h2 class="section-heading">跳线颜色</h2>${palette(state.wireColor)}` : ""}<hr class="rule"><div class="data-row"><span>元件 / 锡线 / 跳线</span><strong>${["component", "solder", "wire"].map((t) => project.objects.filter((o) => o.type === t).length).join(" / ")}</strong></div>`;
    for (const key of ["cols", "rows"])
      bindNumber("#" + key, (n) => {
        const board = { ...project.board, [key]: n };
        if (!fits(project.objects, board)) {
          toast("已有对象超出新尺寸，请先移动或删除这些对象。");
          renderInspector();
          return;
        }
        commit(() => (project.board = board));
        fit();
      });
    bindNumber("#default-start", (n) =>
      commit(() => (project.defaults.start = n)),
    );
    bindNumber("#default-end", (n) => commit(() => (project.defaults.end = n)));
    $("#ghost").onchange = (e) => {
      state.showGhost = e.target.checked;
      requestDraw();
    };
    $("#labels").onchange = (e) => {
      state.showLabels = e.target.checked;
      requestDraw();
    };
    if (state.placement || state.tool === "wire") {
      const ignored = state.placement?.ignoreCollision ?? state.wireIgnoreCollision;
      root.insertAdjacentHTML("beforeend", `<label class="check"><input id="placement-ignore" type="checkbox" ${ignored ? "checked" : ""}>${state.placement ? "放置元件" : "新跳线"}忽略碰撞</label><p class="muted">仅豁免物理碰撞，实际连通关系仍参与校验。</p>`);
      $("#placement-ignore").onchange = (e) => {
        if (state.placement) state.placement.ignoreCollision = e.target.checked;
        else state.wireIgnoreCollision = e.target.checked;
        requestDraw();
      };
    }
    bindPalette((color) => {
      state.wireColor = color;
      renderInspector();
    });
    return;
  }
  const o = selected[0];
  root.innerHTML = `<h2 class="section-heading">${o.mounting === "smd" ? (o.kind === "resistor" ? "贴片电阻" : "贴片电容") : o.type === "component" ? "元件" : o.type === "wire" ? "跳线" : "锡线"}<small>${faceName(objectFace(o))}</small></h2>${field("object-name", "名称", o.name)}`;
  $("#object-name").onchange = (e) =>
    commit(() => (o.name = e.target.value.trim() || o.name));
  if (o.mounting === "smd") {
    const pads = objectPoints(o);
    root.insertAdjacentHTML(
      "beforeend",
      `<div class="info-box">0603 / 0805 贴片电阻、电容示意。跨接两个相邻焊盘，不区分封装尺寸。</div><div class="data-row"><span>焊盘位置</span><strong>${holeName(pads[0])} ↔ ${holeName(pads[1])}</strong></div><div class="data-row"><span>旋转</span><strong>${o.rotation}°</strong></div><div class="row-actions"><button data-action="rotate">↻ 旋转 90°</button><button data-action="edit-component">编辑元件</button></div><p class="muted">拖动焊盘端移动元件 · R 旋转；名称默认居中，可独立拖动并按半格吸附，可填写阻值或容值。</p><button class="wide" data-action="export-component">导出元件文件</button>`,
    );
  } else if (o.type === "component") {
    root.insertAdjacentHTML(
      "beforeend",
      `<div class="field-grid">${numberField("object-x", "列（从 1 起）", o.x + 1, 1, project.board.cols)}${numberField("object-y", "行", o.y + 1, 1, project.board.rows)}</div><div class="data-row"><span>基准孔 / 旋转</span><strong>${holeName(o)} / ${o.rotation}°</strong></div><div class="row-actions"><button data-action="rotate">↻ 旋转 90°</button><button data-action="edit-component">编辑引脚布局</button></div><hr class="rule"><h2 class="section-heading">引脚标注 <small>${o.pins.length} 脚</small></h2><div class="pin-list">${o.pins.map((p, i) => `<div class="pin-row"><span>${holeName(pinPosition(o, p))}</span><input aria-label="引脚 ${i + 1} 标注" data-pin="${i}" maxlength="100" value="${esc(p.label)}"></div>`).join("")}</div><p class="muted">拖动名称或引脚标注可调整位置，按半格吸附；仅选中元件时显示指示连线。</p><button class="wide" data-action="export-component">导出元件文件</button>`,
    );
    for (const key of ["x", "y"])
      bindNumber("#object-" + key, (n) => {
        const candidate = { ...o, [key]: n - 1 };
        if (!fits([candidate], project.board)) {
          toast("元件不能超出板边界");
          renderInspector();
          return;
        }
        commit(() => (o[key] = n - 1));
      });
    root.querySelectorAll("[data-pin]").forEach(
      (el) =>
        (el.onchange = (e) =>
          commit(
            () => (o.pins[Number(el.dataset.pin)].label = e.target.value),
            // Keep the input nodes alive so scrolling and native focus navigation survive blur.
            { preserveInspector: true },
          )),
    );
  } else {
    root.insertAdjacentHTML(
      "beforeend",
      `<div class="data-row"><span>起点 → 终点</span><strong>${holeName(o.points[0])} → ${holeName(o.points.at(-1))}</strong></div><div class="data-row"><span>贴板路径</span><strong>${lengthMM(o.points).toFixed(1)} mm</strong></div>`,
    );
    if (o.type === "wire") {
      root.insertAdjacentHTML(
        "beforeend",
        `<div class="data-row"><span>模式</span><strong>${o.mode === "direct" ? "两孔直连" : "直角折线"}</strong></div><hr class="rule"><label for="wire-color">导线颜色</label><input type="color" id="wire-color" value="${o.color}">${palette(o.color)}<div class="field-grid">${numberField("allow-start", "起点余量", o.allowanceStart, 0, 1000, 0.1, "mm")}${numberField("allow-end", "终点余量", o.allowanceEnd, 0, 1000, 0.1, "mm")}</div><div class="metric"><label>建议裁线长度</label><strong>${cutLength(o).toFixed(1)}</strong><small>mm</small></div><p class="muted">按贴板中心线计算，未计入线径与弯折半径。</p>`,
      );
      $("#wire-color").onchange = (e) =>
        commit(() => (o.color = e.target.value));
      bindPalette((color) => commit(() => (o.color = color)));
      bindNumber("#allow-start", (n) => commit(() => (o.allowanceStart = n)));
      bindNumber("#allow-end", (n) => commit(() => (o.allowanceEnd = n)));
    }
    root.insertAdjacentHTML(
      "beforeend",
      '<p class="muted">拖动端点或折点调整路径；直角线路的相邻折点会同步调整以保持横竖。</p>',
    );
  }
  if (o.type === "component" || o.type === "wire") renderDesignProperties(root, o);
  root.insertAdjacentHTML(
    "beforeend",
    '<div class="row-actions"><button data-action="duplicate">复制实例</button><button class="danger" data-action="delete">删除</button></div>',
  );
}
function palette(color) {
  return `<div class="color-palette">${COLORS.map((c) => `<button aria-label="颜色 ${c}" data-color="${c}" class="${c === color ? "active" : ""}" style="background:${c}"></button>`).join("")}</div>`;
}
function bindPalette(fn) {
  $$("[data-color]").forEach((b) => (b.onclick = () => fn(b.dataset.color)));
}
function dialog(title, body, footer = "") {
  cancel();
  $("#modal-content").innerHTML =
    `<div class="modal-head"><h2>${title}</h2><button data-close aria-label="关闭">×</button></div><div class="modal-body">${body}</div>${footer ? `<div class="modal-foot">${footer}</div>` : ""}`;
  modal.oncancel = () => {
    if (state.tool === "component") state.tool = "select";
    state.placement = null;
    refresh();
  };
  if (!modal.open) modal.showModal();
}
function closeDialog() {
  modal.close();
  canvas.focus();
}
function projectDialog(demo = false) {
  dialog(
    demo ? "打开布线示例" : "新建洞洞板",
    `${project.objects.length ? '<p class="muted">当前设计会被替换。可以撤销恢复，建议先导出项目留存。</p>' : ""}${demo ? '<div class="info-box">10 × 8 孔，已验证的 555 定时器 LED 多谐振荡器，含完整布局、布线及原理图参考。</div>' : `${field("new-name", "项目名称", "未命名项目")}<div class="field-grid">${numberField("new-cols", "列数", 30, 2, 100)}${numberField("new-rows", "行数", 20, 2, 100)}</div>`}<p class="form-error" id="dialog-error"></p>`,
    `<button data-close>取消</button><button id="create-project" class="primary">${demo ? "打开示例" : "创建洞洞板"}</button>`,
  );
  $("#create-project").onclick = () => {
    let next;
    if (demo) next = demoProject();
    else {
      const c = $("#new-cols"),
        r = $("#new-rows");
      if (!c.checkValidity() || !r.checkValidity() || !c.value || !r.value) {
        $("#dialog-error").textContent = "行列数请填写 2–100 之间的整数";
        return;
      }
      next = newProject(
        +c.value,
        +r.value,
        $("#new-name").value.trim() || "未命名项目",
      );
    }
    storageBlocked = false;
    commit(() => (project = next), { allowConflicts: true });
    state.selected.clear();
    state.tool = "select";
    state.view = "front";
    closeDialog();
    fit();
    refresh();
  };
}
function smdDialog(existing = null) {
  dialog(
    existing ? "编辑贴片元件" : "放置贴片元件",
    `<label class="check"><input id="dialog-ignore-collision" type="checkbox" ${existing?.ignoreCollision ? "checked" : ""}>忽略碰撞</label><div class="field"><label for="smd-kind">元件类型</label><select id="smd-kind"><option value="resistor">贴片电阻</option><option value="capacitor">贴片电容</option></select></div>${field("smd-name", "名称 / 数值", existing?.name ?? nameNext("R"))}<div class="info-box">适用于 0603 / 0805 贴片电阻、电容的布线示意，无需选择封装。放置在焊盘面两个相邻焊盘之间。</div><p class="muted">点击两孔之间落位，按 R 旋转 90°。</p><p class="form-error" id="smd-error"></p>`,
    `<button data-close>取消</button><button id="place-smd" class="primary">${existing ? "保存修改" : "放到焊盘面"}</button>`,
  );
  $("#smd-kind").value = existing?.kind ?? "resistor";
  let suggested = $("#smd-name").value;
  $("#smd-kind").onchange = () => {
    if (!existing && $("#smd-name").value === suggested) {
      suggested = nameNext($("#smd-kind").value === "resistor" ? "R" : "C");
      $("#smd-name").value = suggested;
    }
  };
  $("#place-smd").onclick = () => {
    const kind = $("#smd-kind").value;
    const o = {
      id: existing?.id ?? uid(),
      type: "component",
      mounting: "smd",
      kind,
      name:
        $("#smd-name").value.trim() ||
        nameNext(kind === "resistor" ? "R" : "C"),
      x: existing?.x ?? 0,
      y: existing?.y ?? 0,
      rotation: existing?.rotation ?? 0,
      pins: clone(existing?.pins ?? unlabeledPins("single", 2)),
      ignoreCollision: $("#dialog-ignore-collision").checked,
      ...(existing?.shell ? { shell: clone(existing.shell) } : {}),
      ...(existing?.nameDx !== undefined ? { nameDx: existing.nameDx } : {}),
      ...(existing?.nameDy !== undefined ? { nameDy: existing.nameDy } : {}),
    };
    if (existing && !commit(() => {
      project.objects[project.objects.findIndex((p) => p.id === o.id)] = o;
    })) return;
    closeDialog();
    if (state.view !== "split") state.view = "back";
    state.referenceSelected = false;
    state.selected = new Set(existing ? [o.id] : []);
    state.tool = existing ? "select" : "component";
    state.placement = existing ? null : o;
    refresh();
  };
}
function editComponent(o) {
  if (o.mounting === "smd") smdDialog(o);
  else componentDialog(o);
}
function pinPreview(pins) {
  const xs = pins.map((p) => p.x), ys = pins.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const w = Math.max(...xs) - minX, h = Math.max(...ys) - minY;
  const scale = Math.min(14, 140 / Math.max(w, 1), 48 / Math.max(h, 1));
  const holes = [];
  if ((w + 1) * (h + 1) <= 400) {
    for (let y = 0; y <= h; y++)
      for (let x = 0; x <= w; x++)
        holes.push(`<circle class="preview-hole" cx="${84 + (x - w / 2) * scale}" cy="${36 + (y - h / 2) * scale}" r="2" />`);
  }
  return `<svg class="pin-preview" viewBox="0 0 168 72" role="img" aria-label="引脚排列预览">${holes.join("")}${pins.map((p) => `<circle cx="${84 + (p.x - minX - w / 2) * scale}" cy="${36 + (p.y - minY - h / 2) * scale}" r="3" />`).join("")}</svg>`;
}
function placeLibraryComponent(item, name) {
  const o = instantiateLibraryItem(item, name);
  const b = bounds([o]);
  o.x = Math.max(0, -b.minX);
  o.y = Math.max(0, -b.minY);
  if (!fits([o], project.board)) {
    toast("当前板尺寸放不下该元件，请先增大板尺寸。");
    return;
  }
  closeDialog();
  state.referenceSelected = false;
  state.selected.clear();
  state.tool = "component";
  panel = "properties";
  state.placement = o;
  if (state.view !== "split") state.view = objectFace(o);
  refresh();
}
function exportComponents(items, name) {
  try {
    download(JSON.stringify(createComponentFile(items), null, 2), "application/json",
      ".fantasyperf-components.json", name);
  } catch (error) { toast(`元件导出失败：${error.message}`); }
}
function libraryDialog() {
  if (readOnly) return;
  const categories = [...new Set(COMPONENT_LIBRARY.map((item) => item.category))];
  dialog(
    "元件",
    `<p class="muted">通用排布不带引脚标注；常用元件按所列型号预置功能标注。按排布筛选，点击即可放置。</p><div class="field-grid"><div class="field"><label for="library-search">搜索元件</label><input id="library-search" type="search" placeholder="NE555、8 脚、运放、单排…"></div><div class="field"><label for="library-category">引脚排布</label><select id="library-category"><option value="">全部排布</option>${categories.map((category) => `<option>${esc(category)}</option>`).join("")}</select></div></div><div id="library-results" class="library-results"></div><div id="imported-components"></div>${templates.length ? `<section class="component-files"><h3>旧版浏览器模板</h3><p class="muted">发现 ${templates.length} 个旧模板。清除网站数据会丢失，请导出文件留存，导出后可手动删除这里的旧模板。</p><button id="export-legacy">导出全部旧模板</button><div class="template-list">${templates.map((t, i) => `<div class="template-row"><button data-legacy="${i}">${esc(t.name)} · ${t.pins.length} 脚 · 放置</button><button data-export-legacy="${i}">导出</button><button data-delete-legacy="${i}" aria-label="删除旧模板 ${esc(t.name)}">删除</button></div>`).join("")}</div></section>` : ""}<p class="muted component-file-note">选中板上元件可导出文件，之后在此导入复用。文件由你保管；导入列表仅在本次打开页面期间保留。</p>`,
    '<button data-close>关闭</button><button id="import-components">导入元件</button><button id="library-custom" class="primary">自定义元件</button>',
  );
  const render = () => {
    const query = $("#library-search").value.trim().toLowerCase().replace(/\s/g, ""),
      category = $("#library-category").value;
    const items = COMPONENT_LIBRARY.filter(
      (item) => (!category || item.category === category) &&
        `${item.title} ${item.description} ${item.keywords ?? ""}`.toLowerCase().replace(/\s/g, "").includes(query),
    );
    $("#library-results").innerHTML = items.length
      ? [["generic", "通用引脚排布 · 无标注"], ["named", "常用元件 · 型号预设"]]
          .map(([group, title]) => {
            const matches = items.filter((item) => item.group === group);
            return matches.length ? `<h3 class="library-group-title">${title}</h3>${matches.map((item) => `<button class="library-item" data-library="${item.id}">${pinPreview(item.pins)}<strong>${esc(item.title)}</strong><small>${esc(item.description)}</small><span>放置 →</span></button>`).join("")}` : "";
          }).join("")
      : '<p class="empty-list">没有匹配项，可创建自定义元件。</p>';
    $$("[data-library]").forEach((button) => button.onclick = () => {
      const item = COMPONENT_LIBRARY.find((item) => item.id === button.dataset.library);
      placeLibraryComponent(item, nameNext(item.prefix));
    });
  };
  $("#library-search").oninput = render;
  $("#library-category").onchange = render;
  $("#library-custom").onclick = () => componentDialog();
  $("#import-components").onclick = () => $("#component-file-input").click();
  if (templates.length) {
    $("#export-legacy").onclick = () => exportComponents(templates, "旧版元件模板");
    $$("[data-legacy]").forEach((b) => b.onclick = () => {
      const item = templates[+b.dataset.legacy];
      placeLibraryComponent(item, item.name);
    });
    $$("[data-export-legacy]").forEach((b) => b.onclick = () => {
      const item = templates[+b.dataset.exportLegacy];
      exportComponents([item], item.name);
    });
  }
  $$("[data-delete-legacy]").forEach((button) => button.onclick = () => {
    const index = +button.dataset.deleteLegacy;
    if (!confirm(`删除旧模板「${templates[index].name}」？已导出的文件和板上元件不受影响。`)) return;
    try {
      if (localStorage.getItem(TEMPLATES) !== legacyTemplateSnapshot) {
        readLegacyTemplates();
        libraryDialog();
        toast("旧模板已在其他窗口变更，列表已刷新，请重新选择要删除的模板");
        return;
      }
      const remaining = legacyTemplateRecords.filter((_, i) => i !== legacyTemplateIndices[index]);
      if (remaining.length) localStorage.setItem(TEMPLATES, JSON.stringify(remaining));
      else localStorage.removeItem(TEMPLATES);
      readLegacyTemplates();
      libraryDialog();
      toast("旧模板已删除");
    } catch { toast("删除失败，浏览器存储不可用，旧模板列表已保留"); }
  });
  renderImportedComponents();
  render();
}
function renderImportedComponents() {
  const root = $("#imported-components");
  if (!root) return;
  root.innerHTML = importedComponents.length
    ? `<section class="component-files"><h3>已导入 · 本次会话</h3>${importedComponents.map((item, i) => `<button class="wide" data-imported="${i}">${esc(item.name)} · ${item.pins.length} 脚 · 放置</button>`).join("")}</section>` : "";
  root.querySelectorAll("[data-imported]").forEach((b) => b.onclick = () => {
    const item = importedComponents[+b.dataset.imported];
    placeLibraryComponent(item, item.name);
  });
}
function renderViewerInspector() {
  const root = $("#inspector-content"),
    o = selectedObjects()[0];
  $$("[data-panel]").forEach((b) =>
    b.classList.toggle("active", b.dataset.panel === panel),
  );
  if (panel === "wires") {
    const wires = project.objects.filter((o) => o.type === "wire");
    root.innerHTML = `<h2 class="section-heading">跳线清单</h2>${wires.length ? wires.map((w) => `<button class="wire-row" data-viewer-wire="${esc(w.id)}"><span class="wire-swatch" style="background:${w.color}"></span><span><strong>${esc(w.name)}</strong><small>${holeName(w.points[0])} → ${holeName(w.points.at(-1))}</small></span><span class="wire-length">${cutLength(w).toFixed(1)} mm</span></button>`).join("") : '<p class="muted">此项目没有跳线。</p>'}`;
    $$("[data-viewer-wire]").forEach(
      (b) =>
        (b.onclick = () => {
          state.selected = new Set([b.dataset.viewerWire]);
          state.view = "front";
          panel = "properties";
          fit();
          refresh();
        }),
    );
    return;
  }
  if (!o) {
    root.innerHTML = `<h2 class="section-heading">${esc(project.name)}</h2><p class="muted">${project.board.cols} × ${project.board.rows} 孔 · 孔距 2.54 mm</p><p class="muted">单指拖动、双指缩放。点击元件或线路查看详情。</p><label class="check"><input id="viewer-ghost" type="checkbox" ${state.showGhost ? "checked" : ""}>显示另一面参考</label><label class="check"><input id="viewer-labels" type="checkbox" ${state.showLabels ? "checked" : ""}>显示引脚标注</label>`;
    $("#viewer-ghost").onchange = (e) => {
      state.showGhost = e.target.checked;
      requestDraw();
    };
    $("#viewer-labels").onchange = (e) => {
      state.showLabels = e.target.checked;
      requestDraw();
    };
    return;
  }
  root.innerHTML = `<h2 class="section-heading">${esc(o.name)}</h2><p class="muted">${faceName(objectFace(o))} · 只读</p>`;
  if (o.type === "component")
    root.insertAdjacentHTML(
      "beforeend",
      `${o.mounting === "smd" ? '<p class="muted">0603 / 0805 贴片示意</p>' : ""}<div class="viewer-pin-list">${o.pins.map((p) => `<div class="data-row"><span>${holeName(pinPosition(o, p))}</span><strong>${esc(p.label)}</strong></div>`).join("")}</div>`,
    );
  else
    root.insertAdjacentHTML(
      "beforeend",
      `<div class="data-row"><span>起点 → 终点</span><strong>${holeName(o.points[0])} → ${holeName(o.points.at(-1))}</strong></div><div class="data-row"><span>路径长度</span><strong>${lengthMM(o.points).toFixed(1)} mm</strong></div>${o.type === "wire" ? `<div class="data-row"><span>起点 / 终点余量</span><strong>${o.allowanceStart} / ${o.allowanceEnd} mm</strong></div><div class="metric"><label>建议裁线长度</label><strong>${cutLength(o).toFixed(1)}</strong><small>mm</small></div>` : ""}`,
    );
}
function viewerReference() {
  if (!project.reference) return;
  dialog(
    "原理图参考",
    '<div class="viewer-reference"><img alt="原理图参考"></div>',
    "<button data-close>关闭</button>",
  );
  $(".viewer-reference img").src = project.reference.dataUrl;
}
function componentDialog(existing = null) {
  let pins = clone(
    existing?.pins ?? unlabeledPins("double", 8, 1, 3),
  );
  let custom = false;
  dialog(
    existing ? "编辑元件" : "自定义元件",
    `<label class="check"><input id="dialog-ignore-collision" type="checkbox" ${existing?.ignoreCollision ? "checked" : ""}>忽略碰撞</label>${field("component-name", "元件名称", existing?.name ?? nameNext("U"))}<div class="field-grid"><div class="field"><label for="pin-kind">引脚布局</label><select id="pin-kind"><option value="double">双排引脚</option><option value="single">单排引脚</option><option value="custom">自定义孔位</option></select></div>${numberField("pin-count", "引脚总数", pins.length, 1, 64)}</div><div class="field-grid">${numberField("pin-spacing", "同排中心距（孔距）", 1, 1, 20)}${numberField("pin-gap", "两排之间空孔数", 2, 0, 29)}</div><p class="muted" id="pin-gap-help"></p><div id="component-pin-preview"></div><div id="custom-grid-wrap" hidden><label>点击添加 / 移除引脚（12 × 8 孔）</label><div class="custom-grid" id="custom-grid"></div></div><div class="field"><label for="pin-labels">引脚名称 · 每行一个，按引脚顺序填入</label><textarea id="pin-labels" rows="5" placeholder="VCC\nGND\nTX\nRX"></textarea></div><p class="muted" id="pin-summary"></p><p class="form-error" id="dialog-error"></p>`,
    `${existing ? "" : '<button id="back-components">返回元件</button>'}<button data-close>取消</button><button id="place-component" class="primary">${existing ? "保存修改" : "放到板上"}</button>`,
  );
  const update = () => {
    $("#pin-labels").value = pins.map((p) => p.label).join("\n");
    $("#component-pin-preview").innerHTML = pins.length ? pinPreview(pins) : "";
    $("#pin-gap-help").textContent = custom
      ? "按实际孔位排列引脚。"
      : $("#pin-kind").value === "double"
        ? `两排之间 ${$("#pin-gap").value} 个空孔；中心距 ${+$("#pin-gap").value + 1} 个孔距（${((+$("#pin-gap").value + 1) * PITCH).toFixed(2)} mm）。`
        : "同排中心距 1 个孔距表示相邻孔位，2 个孔距表示中间隔 1 个空孔。";
    $("#pin-summary").textContent =
      `${pins.length} 个引脚 · 标注可留空；双排顺序为左侧向下、右侧向上`;
    if (custom) {
      $("#custom-grid").innerHTML = Array.from({ length: 96 }, (_, i) => {
        const x = i % 12,
          y = Math.floor(i / 12),
          idx = pins.findIndex((p) => p.x === x && p.y === y);
        return `<button aria-label="自定义引脚 ${x + 1},${y + 1}" data-grid="${i}" class="${idx >= 0 ? "on" : ""}">${idx >= 0 ? idx + 1 : "·"}</button>`;
      }).join("");
      $("#custom-grid")
        .querySelectorAll("button")
        .forEach(
          (b) =>
            (b.onclick = () => {
              syncLabels();
              const i = +b.dataset.grid,
                x = i % 12,
                y = Math.floor(i / 12),
                idx = pins.findIndex((p) => p.x === x && p.y === y);
              if (idx >= 0) pins.splice(idx, 1);
              else
                pins.push({
                  x,
                  y,
                  label: "",
                  labelDx: 0,
                  labelDy: 0,
                });
              update();
            }),
        );
    }
  };
  const syncLabels = () => {
    const labels = $("#pin-labels").value.split(/\r?\n/);
    pins.forEach((p, i) => (p.label = labels[i] ?? ""));
  };
  const generate = () => {
    custom = $("#pin-kind").value === "custom";
    $("#custom-grid-wrap").hidden = !custom;
    $("#pin-count").disabled = custom;
    $("#pin-spacing").disabled = custom;
    $("#pin-gap").disabled = custom || $("#pin-kind").value === "single";
    if (!custom) {
      if (
        !["#pin-count", "#pin-spacing", "#pin-gap"].every(
          (s) => $(s).disabled || ($(s).checkValidity() && $(s).value),
        )
      )
        return;
      syncLabels();
      const previousPins = pins;
      const labels = pins.map((p) => p.label);
      pins = unlabeledPins(
        $("#pin-kind").value,
        +$("#pin-count").value,
        +$("#pin-spacing").value,
        +$("#pin-gap").value + 1,
      );
      pins.forEach((p, i) => {
        p.label = labels[i] ?? p.label;
        for (const k of ["id", "net", "nc"]) if (previousPins[i]?.[k] !== undefined) p[k] = previousPins[i][k];
      });
    }
    $("#dialog-error").textContent = "";
    update();
  };
  if (existing) {
    $("#pin-kind").value = "custom";
    custom = true;
    $("#custom-grid-wrap").hidden = false;
    $("#pin-count").disabled = true;
    $("#pin-spacing").disabled = true;
    $("#pin-gap").disabled = true;
  }
  ["#pin-kind", "#pin-count", "#pin-spacing", "#pin-gap"].forEach(
    (s) => ($(s).oninput = generate),
  );
  update();
  if (!existing) $("#back-components").onclick = libraryDialog;
  $("#place-component").onclick = () => {
    if (!custom && !["#pin-count", "#pin-spacing", "#pin-gap"].every(
      (s) => $(s).disabled || ($(s).checkValidity() && $(s).value),
    )) {
      $("#dialog-error").textContent = "请填写有效的引脚数量、中心距和空孔数";
      return;
    }
    syncLabels();
    if (!pins.length) {
      $("#dialog-error").textContent = "至少需要一个引脚";
      return;
    }
    if (pins.some((p) => p.label.length > 100)) {
      $("#dialog-error").textContent = "单个引脚名称不能超过 100 字符";
      return;
    }
    const o = {
      id: existing?.id ?? uid(),
      type: "component",
      name: $("#component-name").value.trim() || nameNext("U"),
      x: existing?.x ?? 0,
      y: existing?.y ?? 0,
      rotation: existing?.rotation ?? 0,
      pins: clone(pins),
      ignoreCollision: $("#dialog-ignore-collision").checked,
      ...(existing?.shell ? { shell: clone(existing.shell) } : {}),
      ...(existing?.nameDx !== undefined ? { nameDx: existing.nameDx } : {}),
      ...(existing?.nameDy !== undefined ? { nameDy: existing.nameDy } : {}),
    };
    if (existing) {
      if (!fits([o], project.board)) {
        $("#dialog-error").textContent = "修改后的引脚超出板边界，请先移动元件";
        return;
      }
      if (!commit(() => {
        project.objects[project.objects.findIndex((x) => x.id === o.id)] = o;
      })) return;
      closeDialog();
      state.selected = new Set([o.id]);
      state.tool = "select";
      refresh();
    } else {
      const b = bounds([o]);
      if (
        b.maxX - b.minX >= project.board.cols ||
        b.maxY - b.minY >= project.board.rows
      ) {
        $("#dialog-error").textContent = "元件尺寸超过板尺寸，请减少引脚或间距";
        return;
      }
      o.x = -b.minX;
      o.y = -b.minY;
      closeDialog();
      state.tool = "component";
      if (state.view !== "split") state.view = "front";
      state.placement = o;
      refresh();
    }
  };
}
function exportDialog() {
  dialog(
    "导出设计",
    `<p class="muted">项目文件保留全部可编辑数据；图片适合照图焊接。</p><div class="export-options"><button data-export="project">完整项目 <small>JSON · 格式 v${FORMAT_VERSION} · 生成工具 ${APP_VERSION}</small></button><button data-export="front">元件面 PNG <small>正面 · 元件与跳线</small></button><button data-export="back">焊盘面 PNG <small>背面 · 水平镜像，保留实际孔位编号</small></button><button data-export="split">并排 PNG <small>两面同步对照</small></button><button data-export="csv">全部元件 CSV 清单 <small>元件、引脚、跳线与裁线长度</small></button></div>`,
  );
  $$("[data-export]").forEach(
    (b) =>
      (b.onclick = () => {
        const t = b.dataset.export;
        if (t === "project")
          download(
            JSON.stringify(exportedProject(), null, 2),
            "application/json",
            ".fantasyperf.json",
          );
        else if (t === "csv")
          download(
            objectsCSV(project),
            "text/csv;charset=utf-8",
            "-元件清单.csv",
          );
        else exportPNG(t);
      }),
  );
}
// Exports always carry the current format version, the tool version and the
// export time, so a later release can recognise and upgrade the file in place.
function exportedProject() {
  return {
    ...project,
    format: FORMAT,
    version: FORMAT_VERSION,
    meta: {
      ...(project.meta ?? {}),
      app: FORMAT,
      appVersion: APP_VERSION,
      savedAt: new Date().toISOString(),
    },
  };
}
function download(data, type, suffix, name = project.name) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download =
    (name.replace(/[\\/:*?"<>|]/g, "_") || "FantasyPerf") + suffix;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("导出文件已生成");
}
function exportPNG(view) {
  const out = document.createElement("canvas");
  const width = (project.board.cols * CELL + 140) * (view === "split" ? 2 : 1),
    height = project.board.rows * CELL + 180;
  drawScene(
    out,
    project,
    {
      ...state,
      view,
      selected: new Set(),
      camera: { zoom: 1, panX: 0, panY: 8 },
    },
    { width, height, exporting: true },
  );
  out.toBlob((blob) => {
    if (blob)
      download(
        blob,
        "image/png",
        `-${view === "front" ? "元件面" : view === "back" ? "焊盘面" : "两面对照"}.png`,
      );
    else toast("图片生成失败，请重试");
  }, "image/png");
}
function helpDialog() {
  dialog(
    "操作指南",
    `<p class="muted">正面是元件面，背面是焊盘面。左右翻板时，同一孔位保持同一编号。</p><div class="shortcut-list">${[
      ["选择 / 元件 / 锡线 / 跳线 / 逻辑连接", "V / C / S / W / L"],
      ["多选 / 框选", "Shift 点击 / 拖动空白"],
      ["移动选中对象", "拖动 / 方向键"],
      ["平移画布", "空格拖动 / 中键拖动"],
      ["缩放 / 适合窗口", "滚轮 / F"],
      ["旋转元件", "R"],
      ["结束 / 退出工具", "Enter 或双击 / 右键或 Esc"],
      ["切换直角拐弯方向", "Tab"],
      ["撤销 / 重做", "Ctrl / ⌘ Z · Shift Z"],
      ["复制 / 粘贴", "Ctrl / ⌘ C · V"],
      ["删除所选", "Delete / Backspace"],
      ["编辑元件布局", "双击元件"],
    ]
      .map(([l, k]) => `<span>${l}</span><kbd>${k}</kbd>`)
      .join(
        "",
      )}</div><hr class="rule"><p class="muted">线路绑定孔位。单独移动元件时，线路保持原位；一起框选则一起移动。选中线路后可拖动折点；直角跳线中间路径可半格吸附，首末端必须落在焊盘。名称默认居于元件中心，引脚标注默认居于引脚中心；拖动标注可调整位置，按半格吸附。右键取消当前工具并返回选择。重复点击重叠对象可轮换选择。</p><p class="muted">自动保存仅在当前浏览器生效，请定期导出完整项目。占孔冲突显示叉号与校验提示，不限制摆放；已启用的外壳检查会阻止新增外壳碰撞，跳线自动参与同面外壳检查。全部引脚声明连接组或 NC 后检查漏接和误短接；已实际连通的逻辑线自动隐藏。忽略碰撞只豁免物理检查。</p>`,
    '<button class="primary" data-close>开始设计</button>',
  );
}
function rotate() {
  if (state.placement) {
    const before = clone(state.placement);
    state.placement.rotation = (state.placement.rotation + 90) % 360;
    const d = constrainedDelta([state.placement], 0, 0, project.board);
    moveObjects([state.placement], d.x, d.y);
    if (!fits([state.placement], project.board)) {
      state.placement = before;
      toast("旋转后元件超出板尺寸");
    }
    requestDraw();
    return;
  }
  const cs = selectedObjects().filter((o) => o.type === "component");
  if (!cs.length) return;
  const next = clone(cs);
  next.forEach((o) => (o.rotation = (o.rotation + 90) % 360));
  if (!fits(next, project.board)) {
    toast("旋转后超出板边界，请先移动元件");
    return;
  }
  commit(() => cs.forEach((o) => (o.rotation = (o.rotation + 90) % 360)));
}
function remove() {
  if (state.referenceSelected && project.reference) {
    commit(() => {
      project.reference = null;
    });
    return;
  }
  if (!state.selected.size) return;
  commit(
    () =>
      (project.objects = project.objects.filter(
        (o) => !state.selected.has(o.id),
      )),
  );
  state.selected.clear();
  refresh();
}
function copy() {
  clipboard = clone(selectedObjects());
  if (clipboard.length) toast(`已复制 ${clipboard.length} 个对象`);
}
function paste() {
  if (!clipboard.length) return;
  const objects = clone(clipboard);
  const d = constrainedDelta(objects, 1, 1, project.board);
  moveObjects(objects, d.x, d.y);
  if (!fits(objects, project.board)) {
    toast("复制对象放不进当前板尺寸");
    return;
  }
  objects.forEach((o) => {
    o.id = uid();
    if (o.type === "component") o.pins.forEach((p) => { delete p.net; if (p.id) p.id = uid(); });
    o.name =
      o.type === "component" ? o.name : nameNext(o.type === "wire" ? "W" : "T"); // reserve unique line names across the batch
    if (o.type !== "component") {
      let n = 1,
        prefix = o.type === "wire" ? "W" : "T";
      while (
        project.objects.some((p) => p.name === prefix + n) ||
        objects.some((p) => p !== o && p.name === prefix + n)
      )
        n++;
      o.name = prefix + n;
    }
  });
  if (!commit(() => project.objects.push(...objects))) return;
  state.selected = new Set(objects.map((o) => o.id));
  state.tool = "select";
  if (new Set(objects.map((o) => objectFace(o))).size > 1) state.view = "split";
  else state.view = objectFace(objects[0]);
  refresh();
}
function undo(redo = false) {
  cancel();
  const next = redo ? history.redo(project) : history.undo(project);
  if (next) {
    project = next;
    state.selected.clear();
    changed();
  } else refresh();
}
const actions = {
  "viewer-demo": () => {
    project = demoProject();
    state.selected.clear();
    fit();
    refresh();
  },
  "viewer-details": () => {
    panel = "properties";
    renderInspector();
    document.body.classList.add("viewer-details-open");
  },
  "viewer-wires": () => {
    panel = "wires";
    renderInspector();
    document.body.classList.add("viewer-details-open");
  },
  "viewer-close": () => document.body.classList.remove("viewer-details-open"),
  "viewer-reference": viewerReference,

  smd: () => smdDialog(),
  reference: () => {
    if (project.reference) {
      state.referenceSelected = true;
      state.selected.clear();
      panel = "properties";
      refresh();
    } else referenceLayer.choose();
  },
  new: () => projectDialog(),
  demo: () => projectDialog(true),
  open: () => $("#file-input").click(),
  export: exportDialog,
  help: helpDialog,
  fit,
  undo: () => undo(),
  redo: () => undo(true),
  "zoom-in": () => zoom(1.2),
  "zoom-out": () => zoom(1 / 1.2),
  rotate,
  delete: remove,
  copy,
  duplicate: () => {
    copy();
    paste();
  },
  "edit-component": () => {
    const o = selectedObjects()[0];
    if (o?.type === "component") editComponent(o);
  },
  "export-component": () => {
    const o = selectedObjects()[0];
    if (o?.type === "component") exportComponents([o], o.name);
  },
  csv: () =>
    download(objectsCSV(project), "text/csv;charset=utf-8", "-元件清单.csv"),
};
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  if (readOnly && b.dataset.tool) return;
  if (
    readOnly &&
    b.dataset.action &&
    ![
      "open",
      "help",
      "fit",
      "zoom-in",
      "zoom-out",
      "viewer-demo",
      "viewer-details",
      "viewer-wires",
      "viewer-close",
      "viewer-reference",
    ].includes(b.dataset.action)
  )
    return;
  if (b.hasAttribute("data-close")) {
    closeDialog();
    if (state.tool === "component" && !state.placement) state.tool = "select";
    refresh();
  } else if (b.dataset.action) actions[b.dataset.action]?.();
  else if (b.dataset.tool) setTool(b.dataset.tool);
  else if (b.dataset.view) setView(b.dataset.view);
  else if (b.dataset.panel) {
    panel = b.dataset.panel;
    renderInspector();
  }
});
$("#project-name").onchange = (e) =>
  commit(() => (project.name = e.target.value.trim() || "未命名项目"));
$("#component-file-input").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || readOnly) return;
  if (file.size > 10 * 1024 * 1024) { toast("元件文件不能超过 10 MB"); return; }
  try {
    const raw = JSON.parse(await file.text());
    const items = parseComponentFile(raw);
    if (readOnly) return;
    importedComponents = items;
    libraryDialog();
    $("#imported-components").scrollIntoView({ block: "nearest" });
    const from = parseComponentVersion(raw.version);
    const upgraded = compareVersions(from, COMPONENT_VERSION) < 0
      ? `（格式已从 v${raw.version} 升级到 v${COMPONENT_VERSION}）` : "";
    toast(`已导入 ${items.length} 个元件${upgraded}，点击名称即可放置`);
  } catch (error) { toast(`元件导入失败：${error.message}`); }
};
$("#file-input").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) {
    toast("项目文件不能超过 5 MB");
    return;
  }
  try {
    const raw = JSON.parse(await f.text());
    // 旧格式文件（含早期的整数版本号）在校验时自动升级为当前版本。
    const imported = validateProject(raw);
    const from = parseVersion(raw.version);
    const upgraded =
      from && compareVersions(from, FORMAT_VERSION) < 0
        ? `格式已从 v${from} 升级到 v${FORMAT_VERSION}`
        : "";
    if (readOnly) {
      project = imported;
      state.selected.clear();
      state.tool = "select";
      document.body.classList.remove("viewer-details-open");
      fit();
      refresh();
      toast(
        upgraded
          ? `已打开（${upgraded}），只读查看，不会覆盖编辑存档。`
          : "已打开，只读查看，不会覆盖编辑存档。",
      );
      return;
    }
    dialog(
      "打开项目",
      `<p>将打开「${esc(imported.name)}」</p><p class="muted">${imported.board.cols} × ${imported.board.rows} 孔，${imported.objects.length} 个对象。当前设计可通过撤销恢复。</p>${upgraded ? `<div class="info-box">文件格式为 v${from}，将自动升级为 v${FORMAT_VERSION}，原有数据全部保留。</div>` : ""}`,
      '<button data-close>取消</button><button id="confirm-import" class="primary">打开项目</button>',
    );
    $("#confirm-import").onclick = () => {
      storageBlocked = false;
      commit(() => (project = imported), { allowConflicts: true });
      state.selected.clear();
      state.tool = "select";
      closeDialog();
      fit();
      refresh();
      toast(upgraded ? `项目已完整恢复 · ${upgraded}` : "项目已完整恢复");
    };
  } catch (error) {
    toast("无法打开项目：" + error.message);
  }
};
function viewAt(p) {
  return (
    viewsFor(
      canvas.clientWidth,
      canvas.clientHeight,
      state.view,
      readOnly,
    ).find(
      (v) => p.x >= v.x && p.x < v.x + v.w && p.y >= v.y && p.y < v.y + v.h,
    ) ??
    viewsFor(canvas.clientWidth, canvas.clientHeight, state.view, readOnly)[0]
  );
}
function eventPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}
function pointerGrid(p, v, half = false) {
  const point = fromScreen(p, project.board, v, state.camera, false), factor = half ? 2 : 1;
  return { x: Math.round(point.x * factor) / factor, y: Math.round(point.y * factor) / factor };
}
function usesHalfGrid() {
  if (state.draft?.type === "wire" && state.wireMode === "orthogonal") return true;
  if (gesture?.kind !== "vertex") return false;
  const o = gesture.before.objects.find((o) => o.id === gesture.id);
  return o.type === "wire" && o.mode === "orthogonal" && gesture.index > 0 && gesture.index < o.points.length - 1;
}
function activeOn(o, face) {
  return editableOnFace(o, face, state);
}
function labelAt(o, p, v) {
  if (o.type !== "component") return null;
  const ctx = canvas.getContext("2d");
  const labels = o.name
    ? [{ index: null, box: componentNameBox(ctx, o, project.board, v, state.camera) }]
    : [];
  if (o.mounting !== "smd" && state.showLabels)
    o.pins.forEach((pin, index) => {
      if (pin.label)
        labels.push({ index, box: labelBox(ctx, o, pin, project.board, v, state.camera) });
    });
  return labels.find(({ box }) =>
    p.x >= box.x - 3 && p.x <= box.x + box.w + 3 &&
    p.y >= box.y && p.y <= box.y + box.h,
  ) ?? null;
}
function startLabelDrag(o, label, p, v) {
  gesture = {
    kind: "label",
    id: o.id,
    index: label.index,
    start: p,
    view: v,
    position: fromScreen({ x: label.box.tx, y: label.box.ty }, project.board, v, state.camera, false),
    origin: label.index === null ? label.box.origin : pinPosition(o, o.pins[label.index]),
    before: clone(project),
  };
}
function hitObjects(p, v) {
  const grid = fromScreen(p, project.board, v, state.camera, false),
    tol = 7 / (CELL * state.camera.zoom);
  return project.objects
    .filter((o) => activeOn(o, v.face))
    .filter((o) => {
      if (o.type === "component") {
        const b = bounds([o]);
        return (
          (grid.x >= b.minX - 0.35 &&
            grid.x <= b.maxX + 0.35 &&
            grid.y >= b.minY - 0.95 &&
            grid.y <= b.maxY + 0.35) ||
          !!labelAt(o, p, v)
        );
      }
      return o.points.some(
        (pt, i) => i > 0 && distanceToSegment(grid, o.points[i - 1], pt) < tol,
      );
    })
    .reverse();
}
function draftPreview(p) {
  if (!state.draft) return;
  const d = state.draft;
  d.preview = [
    ...d.points,
    ...(d.type === "wire" && state.wireMode === "direct"
      ? [p]
      : orthogonal(d.points.at(-1), p, d.horizontal)),
  ];
}
function finishDraft() {
  if (!state.draft) return;
  const d = state.draft,
    points = cleanPath(d.points);
  if (points.length < 2 || lengthMM(points) === 0) {
    toast("请至少指定两个不同的孔位");
    return;
  }
  if (d.type === "wire" && (!isHole(points[0]) || !isHole(points.at(-1)))) {
    toast("跳线两端必须落在焊盘，请继续选择整数孔位作为终点");
    return;
  }
  const o = {
    id: uid(),
    type: d.type,
    name: nameNext(d.type === "wire" ? "W" : "T"),
    points,
  };
  if (d.type === "wire")
    Object.assign(o, {
      mode: state.wireMode,
      color: state.wireColor,
      allowanceStart: project.defaults.start,
      allowanceEnd: project.defaults.end,
      ignoreCollision: state.wireIgnoreCollision,
    });
  if (!commit(() => project.objects.push(o))) {
    if (d.type === "wire" && state.wireMode === "direct") {
      d.points = d.points.slice(0, 1);
      d.preview = d.points;
      requestDraw();
    }
    return;
  }
  state.draft = null;
  state.selected = new Set([o.id]);
  refresh();
}
canvas.addEventListener("pointerdown", (e) => {
  if (readOnly) return;
  if (e.button !== 0 && e.button !== 1) return;
  state.referenceSelected = false;
  canvas.focus();
  e.preventDefault();
  const p = eventPoint(e),
    v = viewAt(p),
    grid = pointerGrid(p, v, state.draft?.type === "wire" && state.wireMode === "orthogonal");
  canvas.setPointerCapture(e.pointerId);
  if (e.button === 1 || space) {
    gesture = { kind: "pan", start: p, camera: clone(state.camera) };
    canvas.style.cursor = "grabbing";
    return;
  }
  if (state.placement) {
    if (v.face !== objectFace(state.placement)) {
      toast(
        state.placement.mounting === "smd"
          ? "请在焊盘面放置贴片元件"
          : "请在元件面放置",
      );
      return;
    }
    if (!inBoard(grid, project.board)) return;
    const o = clone(state.placement);
    const target =
      o.mounting === "smd"
        ? smdPlacement(
            fromScreen(p, project.board, v, state.camera, false),
            o.rotation,
          )
        : grid;
    o.x = target.x;
    o.y = target.y;
    if (!fits([o], project.board)) {
      toast("元件超出板边界，请移动到板内");
      return;
    }
    if (!commit(() => project.objects.push(o))) return;
    state.placement = null;
    state.selected = new Set([o.id]);
    state.tool = "select";
    refresh();
    return;
  }
  if (state.tool === "logic") { pickLogicalPin(p, v); return; }
  if (state.tool === "solder" || state.tool === "wire") {
    if (state.tool === "wire" && v.face !== "front") {
      toast("请在元件面绘制跳线");
      return;
    }
    if (!inBoard(grid, project.board)) return;
    if (!state.draft) {
      state.selected.clear();
      state.draft = {
        type: state.tool,
        points: [grid],
        horizontal: true,
        preview: [grid],
      };
      refresh();
    } else {
      const d = state.draft;
      if (same(d.points.at(-1), grid)) return;
      d.points.push(
        ...(d.type === "wire" && state.wireMode === "direct"
          ? [grid]
          : orthogonal(d.points.at(-1), grid, d.horizontal)),
      );
      d.preview = d.points;
      if (d.type === "wire" && state.wireMode === "direct") finishDraft();
      else requestDraw();
    }
    return;
  }
  if (state.tool !== "select") return;
  // Selected handles get priority over objects underneath.
  for (const o of selectedObjects().filter((o) => activeOn(o, v.face))) {
    if (o.type === "component" && !e.shiftKey) {
      const label = labelAt(o, p, v);
      if (label) {
        startLabelDrag(o, label, p, v);
        return;
      }
    } else if (o.type !== "component") {
      const i = o.points.findIndex((pt) => {
        const q = toScreen(pt, project.board, v, state.camera);
        return Math.hypot(q.x - p.x, q.y - p.y) < 9;
      });
      if (i >= 0) {
        gesture = {
          kind: "vertex",
          id: o.id,
          index: i,
          start: p,
          view: v,
          before: clone(project),
        };
        return;
      }
    }
  }
  const hits = hitObjects(p, v);
  let hit = hits[0];
  if (hits.length) {
    if (
      lastHit &&
      Math.hypot(p.x - lastHit.x, p.y - lastHit.y) < 4 &&
      Date.now() - lastHit.time < 1800 &&
      hits.length > 1
    ) {
      const idx = hits.findIndex((o) => o.id === lastHit.id);
      hit = hits[(idx + 1) % hits.length];
    }
    lastHit = { ...p, id: hit.id, time: Date.now() };
    if (e.shiftKey) {
      if (state.selected.has(hit.id)) state.selected.delete(hit.id);
      else state.selected.add(hit.id);
    } else if (!state.selected.has(hit.id)) state.selected = new Set([hit.id]);
    gesture = {
      kind: "move",
      start: p,
      grid,
      view: v,
      before: clone(project),
      ids: new Set(state.selected),
    };
    const label = !e.shiftKey && labelAt(hit, p, v);
    if (label) startLabelDrag(hit, label, p, v);
    panel = "properties";
    refresh();
  } else {
    if (!e.shiftKey) state.selected.clear();
    state.marquee = { start: p, end: p };
    gesture = {
      kind: "marquee",
      view: v,
      start: p,
      append: new Set(state.selected),
    };
    refresh();
  }
});
canvas.addEventListener("pointermove", (e) => {
  if (readOnly) return;
  const p = eventPoint(e),
    v = gesture?.view ?? viewAt(p),
    g = pointerGrid(p, v, usesHalfGrid());
  state.hover = state.tool === "logic" ? logicalPinAt(project, p, v, state.camera)?.point ?? null
    : inBoard(g, project.board) ? g : null;
  $("#hole-position").textContent = state.hover ? holeName(state.hover) : "—";
  if (gesture) {
    const d = gesture;
    if (d.kind === "pan") {
      state.camera.panX = d.camera.panX + p.x - d.start.x;
      state.camera.panY = d.camera.panY + p.y - d.start.y;
    } else if (d.kind === "move") {
      const original = d.before.objects.filter((o) => d.ids.has(o.id)),
        delta = constrainedDelta(
          original,
          g.x - d.grid.x,
          g.y - d.grid.y,
          project.board,
        );
      project = clone(d.before);
      moveObjects(
        project.objects.filter((o) => d.ids.has(o.id)),
        delta.x,
        delta.y,
      );
      $("#status-hint").textContent = "线路保持原位；一起框选可一起移动";
    } else if (d.kind === "vertex") {
      const original = d.before.objects.find((o) => o.id === d.id);
      const target = {
        x: clamp(g.x, 0, project.board.cols - 1),
        y: clamp(g.y, 0, project.board.rows - 1),
      };
      const points = editVertex(
        original.points,
        d.index,
        target,
        original.type === "solder" || original.mode === "orthogonal",
        original.type === "wire" && original.mode === "orthogonal",
      );
      if (points.every((p) => inBoard(p, project.board))) {
        project = clone(d.before);
        project.objects.find((o) => o.id === d.id).points = points;
      }
    } else if (d.kind === "label") {
      project = clone(d.before);
      if (Math.hypot(p.x - d.start.x, p.y - d.start.y) < 3) {
        requestDraw();
        return;
      }
      const o = project.objects.find((o) => o.id === d.id),
        target = d.index === null ? o : o.pins[d.index],
        prefix = d.index === null ? "name" : "label",
        s = CELL * state.camera.zoom;
      // Snap the text anchor to the board's half-hole grid in either face.
      const x = Math.round((d.position.x +
        ((p.x - d.start.x) / s) * (v.face === "back" ? -1 : 1)) * 2) / 2;
      const y = Math.round((d.position.y + (p.y - d.start.y) / s) * 2) / 2;
      target[prefix + "Dx"] = clamp(x - d.origin.x, -100, 100);
      target[prefix + "Dy"] = clamp(y - d.origin.y, -100, 100);
    } else if (d.kind === "marquee") {
      state.marquee.end = p;
      const left = Math.min(d.start.x, p.x),
        right = Math.max(d.start.x, p.x),
        top = Math.min(d.start.y, p.y),
        bottom = Math.max(d.start.y, p.y);
      state.selected = new Set(d.append);
      for (const o of project.objects) {
        const inside = viewsFor(
          canvas.clientWidth,
          canvas.clientHeight,
          state.view,
        )
          .filter((view) => activeOn(o, view.face))
          .some((view) =>
            objectPoints(o)
              .map((pt) => toScreen(pt, project.board, view, state.camera))
              .every(
                (pt) =>
                  pt.x >= left &&
                  pt.x <= right &&
                  pt.y >= top &&
                  pt.y <= bottom,
              ),
          );
        if (inside) state.selected.add(o.id);
      }
    }
  } else {
    if (
      state.placement &&
      state.hover &&
      v.face === objectFace(state.placement)
    ) {
      const target =
        state.placement.mounting === "smd"
          ? smdPlacement(
              fromScreen(p, project.board, v, state.camera, false),
              state.placement.rotation,
            )
          : g;
      state.placement.x = target.x;
      state.placement.y = target.y;
    }
    if (state.draft && state.hover) draftPreview(g);
  }
  requestDraw();
});
function endGesture() {
  if (!gesture) return;
  const d = gesture;
  gesture = null;
  state.marquee = null;
  if (d.before && JSON.stringify(project) !== JSON.stringify(d.before)) {
    if (d.kind === "vertex") {
      const o = project.objects.find((o) => o.id === d.id);
      o.points = cleanPath(o.points);
      if (o.points.length < 2 || lengthMM(o.points) === 0) {
        project = d.before;
        toast("线路不能缩成单点");
        refresh();
        return;
      }
    }
    const conflict = firstNewCollision(d.before, project, { includeHoles: false });
    if (conflict) {
      project = d.before;
      toast(conflict.message + "，本次移动已取消");
      refresh();
      return;
    }
    history.push(d.before);
    state.checkHighlight = [];
    save();
  }
  refresh();
}
canvas.addEventListener("pointerup", endGesture);
canvas.addEventListener("pointercancel", () => {
  if (gesture?.before) project = gesture.before;
  gesture = null;
  state.marquee = null;
  refresh();
});
canvas.addEventListener("pointerleave", () => {
  if (!gesture) {
    state.hover = null;
    $("#hole-position").textContent = "—";
    requestDraw();
  }
});
canvas.addEventListener("dblclick", (e) => {
  if (readOnly) return;
  if (state.draft) {
    finishDraft();
    return;
  }
  if (state.tool === "select") {
    const p = eventPoint(e),
      o = hitObjects(p, viewAt(p)).find((o) => o.type === "component");
    if (o) editComponent(o);
  }
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    zoom(Math.exp(-e.deltaY * 0.0015), eventPoint(e));
  },
  { passive: false },
);
$(".stage").addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (readOnly) return;
  state.tool = "select";
  cancel();
  canvas.focus();
});
document.addEventListener("keydown", (e) => {
  const editable = e.target.closest("input,textarea,select,[contenteditable]");
  if (modal.open || editable) return;
  if (readOnly) {
    if (e.key === "Escape")
      document.body.classList.remove("viewer-details-open");
    if (e.key.toLowerCase() === "f") fit();
    if (
      [
        "Delete",
        "Backspace",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
      ].includes(e.key) ||
      e.ctrlKey ||
      e.metaKey
    )
      e.preventDefault();
    return;
  }
  const cmd = e.metaKey || e.ctrlKey,
    k = e.key.toLowerCase();
  if (cmd && ["z", "y", "c", "v", "s"].includes(k)) {
    e.preventDefault();
    if (k === "z") undo(e.shiftKey);
    else if (k === "y") undo(true);
    else if (k === "c") copy();
    else if (k === "v") paste();
    else
      download(
        JSON.stringify(project, null, 2),
        "application/json",
        ".fantasyperf.json",
      );
    return;
  }
  if (e.key === " ") {
    e.preventDefault();
    space = true;
    canvas.style.cursor = "grab";
    return;
  }
  if (e.key === "Escape") {
    cancel();
    state.tool = "select";
    state.selected.clear();
    refresh();
    return;
  }
  if (e.key === "Enter" && state.draft) {
    e.preventDefault();
    finishDraft();
    return;
  }
  if (e.key === "Tab" && state.draft) {
    e.preventDefault();
    state.draft.horizontal = !state.draft.horizontal;
    if (state.hover) draftPreview(state.hover);
    requestDraw();
    return;
  }
  if (["Delete", "Backspace"].includes(e.key)) {
    e.preventDefault();
    if (state.draft) {
      if (state.draft.points.length > 1) state.draft.points.pop();
      state.draft.preview = state.draft.points;
      requestDraw();
      return;
    }
    remove();
    return;
  }
  if (
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) &&
    state.selected.size
  ) {
    e.preventDefault();
    const amount = e.shiftKey ? 5 : 1;
    let dx =
        e.key === "ArrowLeft" ? -amount : e.key === "ArrowRight" ? amount : 0,
      dy = e.key === "ArrowUp" ? -amount : e.key === "ArrowDown" ? amount : 0;
    if (state.view === "back") dx = -dx;
    const d = constrainedDelta(selectedObjects(), dx, dy, project.board);
    commit(() => moveObjects(selectedObjects(), d.x, d.y));
    return;
  }
  if (cmd || e.altKey) return;
  if (k === "r") rotate();
  else if (k === "f") fit();
  else if (k === "v") setTool("select");
  else if (k === "c") setTool("component");
  else if (k === "s") setTool("solder");
  else if (k === "w") setTool("wire");
  else if (k === "l") setTool("logic");
});
document.addEventListener("keyup", (e) => {
  if (e.key === " ") {
    space = false;
    canvas.style.cursor = state.tool === "select" ? "default" : "crosshair";
  }
});
window.addEventListener("blur", () => {
  space = false;
  if (gesture) endGesture();
});
window.addEventListener("beforeunload", () => {
  if (!gesture && JSON.stringify(project) !== lastSave) flushSave();
});
window.addEventListener("storage", (e) => {
  if (e.key === STORE && e.newValue !== lastSave) {
    storageBlocked = true;
    clearTimeout(savedTimer);
    $("#save-status").textContent = "其他窗口已修改 · 请导出";
    toast("另一窗口修改了自动存档。本窗口已暂停保存，请先导出当前设计。");
  }
});
modal.addEventListener("close", () => {
  if (state.tool === "component" && !state.placement) {
    state.tool = "select";
    refresh();
  }
});
window.addEventListener("fantasyperf-theme-change", requestDraw);
window.addEventListener("fantasyperf-theme-storage-error", () =>
  toast("外观已切换，但浏览器无法保存外观偏好。"),
);
const resetViewerGestures = installViewerGestures(canvas, {
  enabled: () => readOnly,
  point: eventPoint,
  zoom,
  pan: (dx, dy) => {
    state.camera.panX += dx;
    state.camera.panY += dy;
  },
  changed: requestDraw,
  pick: (p) => {
    const hit = hitObjects(p, viewAt(p))[0];
    state.selected = new Set(hit ? [hit.id] : []);
    panel = "properties";
    refresh();
    document.body.classList.toggle("viewer-details-open", !!hit);
  },
});
mobileMedia.addEventListener("change", () => {
  const next = viewerQuery || mobileMedia.matches;
  if (next === readOnly) return;
  if (next) {
    cancel();
    closeDialog();
    flushSave();
    desktopSession = { project, history };
  } else if (desktopSession) {
    project = desktopSession.project;
    history = desktopSession.history;
    desktopSession = null;
  }
  readOnly = next;
  document.documentElement.dataset.readonly = String(readOnly);
  state.selected.clear();
  state.tool = "select";
  state.draft = null;
  state.placement = null;
  resetViewerGestures();
  document.body.classList.remove("viewer-details-open");
  refresh();
  requestAnimationFrame(fit);
});
new ResizeObserver(() => {
  requestDraw();
  if (readOnly) fit();
}).observe(canvas);
if (lastSave) $("#save-status").textContent = "已自动保存到本机";
refresh();
requestAnimationFrame(fit);

function nextNetName() {
  const names = new Set(terminals(project).map((t) => t.pin.net));
  let n = 1;
  while (names.has(`N${n}`)) n++;
  return `N${n}`;
}
function renderDesignProperties(root, o) {
  root.insertAdjacentHTML("beforeend", `<hr class="rule"><h2 class="section-heading">物理碰撞</h2><label class="check"><input id="ignore-collision" type="checkbox" ${o.ignoreCollision ? "checked" : ""}>忽略碰撞</label><p class="muted">特殊安装可豁免此对象的物理碰撞；电气连接检查仍然生效。</p>`);
  $("#ignore-collision").onchange = (e) => commit(() => { o.ignoreCollision = e.target.checked; }, { allowConflicts: true });
  if (o.type !== "component") return;
  const shell = o.shell ?? defaultShell(o);
  root.insertAdjacentHTML("beforeend", `<label class="check"><input id="shell-enabled" type="checkbox" ${o.shell?.enabled ? "checked" : ""}>开启外壳碰撞</label><p class="muted">边界相对元件基准孔，单位为孔距；随元件旋转。同面已启用外壳检查重叠，元件面自动检查跳线，焊盘面检查锡线穿过外壳。</p>${o.shell?.enabled ? `<div class="field-grid">${numberField("shell-x", "外壳左边界", shell.x, -100, 100, 0.05)}${numberField("shell-y", "外壳上边界", shell.y, -100, 100, 0.05)}${numberField("shell-w", "外壳宽度", shell.w, 0.1, 200, 0.05)}${numberField("shell-h", "外壳高度", shell.h, 0.1, 200, 0.05)}</div>` : ""}`);
  $("#shell-enabled").onchange = (e) => commit(() => { o.shell = { ...shell, enabled: e.target.checked }; }, { allowConflicts: true });
  for (const key of ["x", "y", "w", "h"])
    bindNumber(`#shell-${key}`, (n) => commit(() => { o.shell[key] = n; }, { allowConflicts: true }));
  const names = [...new Set(terminals(project).map((t) => t.pin.net).filter(Boolean))];
  root.insertAdjacentHTML("beforeend", `<hr class="rule"><h2 class="section-heading">逻辑关系 <small>${o.pins.length} 脚</small></h2><p class="muted">同组必须相连，不同组必须隔离。NC 不得连接其他引脚。全部引脚明确后，校验页自动检查连接。</p><datalist id="net-names">${names.map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist><div class="intent-list">${o.pins.map((pin, i) => `<div class="intent-row"><label for="pin-intent-${i}">${i + 1} · ${holeName(pinPosition(o, pin))}${pin.label ? ` · ${esc(pin.label)}` : ""}</label><div class="field-grid"><select id="pin-intent-${i}" aria-label="引脚 ${i + 1} 逻辑状态"><option value="unknown" ${!pin.net && !pin.nc ? "selected" : ""}>未声明</option><option value="net" ${pin.net ? "selected" : ""}>连接组</option><option value="nc" ${pin.nc ? "selected" : ""}>NC · 不连接</option></select><input id="pin-net-${i}" aria-label="引脚 ${i + 1} 连接组" maxlength="80" list="net-names" value="${esc(pin.net ?? "")}" placeholder="如 VCC、N1" ${pin.net ? "" : "disabled"}></div></div>`).join("")}</div><button class="wide" data-tool="logic">在画布上声明逻辑连接 · L</button>`);
  o.pins.forEach((pin, i) => {
    const select = $(`#pin-intent-${i}`), input = $(`#pin-net-${i}`);
    select.onchange = () => {
      const mode = select.value, net = pin.net || nextNetName();
      commit(() => {
        pin.id ??= uid();
        delete pin.net; delete pin.nc;
        if (mode === "net") pin.net = net;
        if (mode === "nc") pin.nc = true;
      }, { preserveInspector: true });
      input.disabled = mode !== "net";
      input.value = mode === "net" ? net : "";
    };
    input.onchange = () => {
      const value = input.value.trim();
      if (!value) { toast("连接组名称不能为空；不再分组时请选择未声明或 NC"); input.value = pin.net ?? ""; return; }
      commit(() => { pin.net = value; pin.id ??= uid(); delete pin.nc; }, { preserveInspector: true });
    };
  });
}
function renderChecks(root) {
  const physical = collisionIssues(project), result = analyzeConnections(project);
  const entries = [...physical, ...result.errors, ...result.warnings];
  const ignored = project.objects.filter((o) => o.ignoreCollision);
  const status = !result.total ? "添加元件并声明引脚逻辑关系后，可检查连通性。"
    : !result.enabled ? `连通性检查未开启：尚有 ${result.undeclared.length} / ${result.total} 个引脚未声明。`
      : result.errors.length ? `连通性检查：${result.errors.length} 个错误，${result.warnings.length} 个警告。`
        : `已声明的连接规则全部通过${result.warnings.length ? `，另有 ${result.warnings.length} 个警告` : ""}。`;
  root.innerHTML = `<h2 class="section-heading">设计校验</h2><div class="info-box" id="connection-status">${status}</div><p class="muted">${physical.length ? `${physical.length >= 200 ? "至少 " : ""}${physical.length} 个物理冲突` : "物理碰撞检查通过"}。警告不影响连接规则通过；外壳尺寸由你核对。</p><label class="check"><input id="show-logic" type="checkbox" ${state.showLogic ? "checked" : ""}>显示逻辑连接与 NC</label><p class="muted" id="ignored-collision-list">${ignored.length ? `忽略碰撞：${ignored.map((o) => esc(o.name)).join("、")}` : "没有对象忽略碰撞"}。</p>${!result.enabled && result.undeclared.length ? `<h3 class="section-heading">待声明引脚</h3>${result.undeclared.slice(0, 100).map((t, i) => `<button class="check-issue" data-undeclared="${i}">${esc(t.object.name)} · 第 ${t.index + 1} 脚 · ${holeName(t.point)}${t.pin.label ? ` · ${esc(t.pin.label)}` : ""}</button>`).join("")}${result.undeclared.length > 100 ? '<p class="muted">仅列出前 100 个，声明后列表继续更新。</p>' : ""}` : ""}<div id="check-issues">${entries.slice(0, 200).map((entry, i) => `<button class="check-issue ${entry.severity}" data-check-issue="${i}"><strong>${entry.severity === "warning" ? "警告" : "错误"}</strong> ${esc(entry.message)}</button>`).join("")}</div>${entries.length >= 200 ? '<p class="muted">最多显示 200 个问题，请先处理当前列表。</p>' : ""}<p class="muted">点击问题定位对象。逻辑线表示连接意图，不是实际导线，也不进入布线 PNG。</p>`;
  $("#show-logic").onchange = (e) => { state.showLogic = e.target.checked; requestDraw(); };
  root.querySelectorAll("[data-check-issue]").forEach((button) => button.onclick = () => focusCheck(entries[+button.dataset.checkIssue]));
  root.querySelectorAll("[data-undeclared]").forEach((button) => {
    button.onclick = () => {
      const t = result.undeclared[+button.dataset.undeclared];
      focusCheck({ ids: [t.object.id], points: [t.point] });
      $(`#pin-intent-${t.index}`)?.scrollIntoView({ block: "center" });
    };
  });
}
function focusCheck(issue) {
  state.selected = new Set(issue.ids);
  state.checkHighlight = issue.points;
  state.referenceSelected = false;
  state.tool = "select";
  const objects = selectedObjects(), faces = new Set(objects.map(objectFace));
  state.view = faces.size > 1 ? "split" : objectFace(objects[0]);
  panel = "properties";
  const b = bounds(objects), view = viewsFor(canvas.clientWidth, canvas.clientHeight, state.view)[0];
  const zoom = clamp(Math.min((view.w - 100) / ((b.maxX - b.minX + 4) * CELL),
    (view.h - 160) / ((b.maxY - b.minY + 4) * CELL)), 0.15, 3);
  state.camera = { zoom,
    panX: ((project.board.cols - 1) / 2 - (b.minX + b.maxX) / 2) * CELL * zoom * (state.view === "back" ? -1 : 1),
    panY: ((project.board.rows - 1) / 2 - (b.minY + b.maxY) / 2) * CELL * zoom };
  $("#zoom-label").textContent = Math.round(zoom * 100) + "%";
  refresh();
}
function pickLogicalPin(point, view) {
  const target = logicalPinAt(project, point, view, state.camera);
  if (!target) { toast("请点击元件引脚，逻辑连接不绑定空焊盘或跳线端点"); return; }
  if (target.pin.nc) { toast("该引脚已声明 NC，请先在属性中取消 NC"); return; }
  if (!state.logicalStart) {
    state.logicalStart = { id: target.object.id, index: target.index };
    refresh(); return;
  }
  const sourceObject = project.objects.find((o) => o.id === state.logicalStart.id);
  const source = sourceObject?.pins[state.logicalStart.index];
  if (!source || (sourceObject.id === target.object.id && source === target.pin)) {
    toast("请选择另一个引脚"); return;
  }
  const net = source.net || target.pin.net || nextNetName(), merged = target.pin.net;
  commit(() => {
    if (merged && merged !== net)
      terminals(project).filter((t) => t.pin.net === merged).forEach((t) => { t.pin.net = net; });
    for (const pin of [source, target.pin]) { pin.id ??= uid(); pin.net = net; delete pin.nc; }
  });
  state.logicalStart = null;
  refresh();
  toast(`已声明连接组「${net}」，请通过锡线或跳线实现实际连接`);
}
