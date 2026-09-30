import test from "node:test";
import assert from "node:assert/strict";
import {
  newProject,
  demoProject,
  validateProject,
  upgradeProject,
  lengthMM,
  cutLength,
  orthogonal,
  cleanPath,
  editVertex,
  screenX,
  pinPosition,
  constrainedDelta,
  moveObjects,
  fits,
  History,
  clone,
  objectsCSV,
  regularPins,
  columnName,
  FORMAT,
  FORMAT_VERSION,
  APP_VERSION,
  parseVersion,
  compareVersions,
  versionMajor,
} from "../src/core.js";
test("直连、直角跳线长度和两端余量", () => {
  assert.equal(
    lengthMM([
      { x: 0, y: 0 },
      { x: 3, y: 4 },
    ]),
    12.7,
  );
  assert.equal(
    lengthMM([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
    ]),
    17.78,
  );
  assert.equal(
    cutLength({
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 4 },
      ],
      allowanceStart: 3,
      allowanceEnd: 4,
    }),
    19.7,
  );
});
test("翻面映射可逆，同一孔位编号不变", () => {
  for (let x = 0; x < 30; x++)
    assert.equal(screenX(screenX(x, 30, "back"), 30, "back"), x);
  assert.equal(screenX(0, 30, "back"), 29);
  assert.equal(screenX(0, 30, "front"), 0);
  assert.equal(columnName(26), "AA");
});
test("直角预览切换与线路简化保留回折", () => {
  assert.deepEqual(orthogonal({ x: 0, y: 0 }, { x: 3, y: 4 }), [
    { x: 3, y: 0 },
    { x: 3, y: 4 },
  ]);
  assert.deepEqual(orthogonal({ x: 0, y: 0 }, { x: 3, y: 4 }, false), [
    { x: 0, y: 4 },
    { x: 3, y: 4 },
  ]);
  assert.deepEqual(
    cleanPath([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ]),
    [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ],
  );
  assert.equal(
    cleanPath([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 0 },
    ]).length,
    3,
  );
});
test("任意折点编辑始终保持横竖", () => {
  const points = [
    { x: 1, y: 1 },
    { x: 4, y: 1 },
    { x: 4, y: 5 },
    { x: 7, y: 5 },
  ];
  for (let i = 0; i < points.length; i++) {
    const edited = editVertex(points, i, { x: 3, y: 3 });
    assert.ok(
      edited.every(
        (p, j) => j === 0 || p.x === edited[j - 1].x || p.y === edited[j - 1].y,
      ),
    );
  }
  assert.deepEqual(points[0], { x: 1, y: 1 });
});
test("双排引脚、旋转、群组移动边界", () => {
  const pins = regularPins("double", 8, 1, 3);
  assert.deepEqual(
    pins.map((p) => [p.x, p.y]),
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [3, 3],
      [3, 2],
      [3, 1],
      [3, 0],
    ],
  );
  const c = { type: "component", x: 4, y: 4, rotation: 90, pins };
  assert.deepEqual(pinPosition(c, pins[3]), { x: 1, y: 4 });
  const p = newProject(10, 10);
  const d = constrainedDelta([c], -10, 20, p.board);
  moveObjects([c], d.x, d.y);
  assert.ok(fits([c], p.board));
});
test("内置示例保留已验证的 555 设计与参考图，每次打开独立编辑", () => {
  const p = demoProject();
  assert.equal(p.name, "基于555定时器的LED多谐振荡器");
  assert.deepEqual(p.board, { cols: 10, rows: 8, pitch: 2.54 });
  assert.deepEqual(
    ["component", "wire", "solder"].map(
      (type) => p.objects.filter((o) => o.type === type).length,
    ),
    [9, 2, 18],
  );
  assert.deepEqual(
    p.objects[0].pins.map((pin) => pin.label),
    ["GND", "TRIG", "OUT", "RESET", "CONT", "THRES", "DISCH", "VCC"],
  );
  assert.match(p.reference.dataUrl, /^data:image\/webp;base64,/);
  assert.equal(p.reference.name, "SCH.png");
  assert.equal(p.reference.naturalWidth, 854);
  assert.equal(p.reference.naturalHeight, 786);
  const original = clone(p);
  p.objects[0].pins[0].label = "编辑过的引脚";
  p.objects.find((o) => o.type === "wire").points[0].x++;
  p.reference.visible = false;
  assert.deepEqual(demoProject(), original);
});
test("元件单独移动不改变线路", () => {
  const p = demoProject(),
    w = clone(p.objects.filter((o) => o.type !== "component"));
  moveObjects([p.objects[0]], 1, 0);
  assert.deepEqual(
    p.objects.filter((o) => o.type !== "component"),
    w,
  );
});
test("项目完整往返及导入拒绝损坏数据", () => {
  const p = demoProject();
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))), p);
  for (const bad of [
    (p) => (p.board.cols = 1),
    (p) => (p.objects[0].pins[0].label = {}),
    (p) => (p.objects[0].id = p.objects[1].id),
    (p) => (p.objects.find((o) => o.type === "solder").points[1] = { x: 8, y: 8 }),
    (p) => (p.defaults.start = -1),
    (p) => (p.objects[0].pins[0].x = 100),
  ]) {
    const q = clone(p);
    bad(q);
    assert.throws(() => validateProject(q));
  }
});
test("版本号是三段式，可比较并识别早期整数版本", () => {
  assert.equal(FORMAT_VERSION, "1.1.0");
  assert.equal(versionMajor(FORMAT_VERSION), 1);
  assert.equal(compareVersions("1.0.0", "1.0.1"), -1);
  assert.equal(compareVersions("1.0.1", "1.1.0"), -1);
  assert.equal(compareVersions("1.1.0", "1.10.0"), -1);
  assert.equal(compareVersions("1.10.0", "2.0.0"), -1);
  assert.equal(compareVersions("1.1.0", "1.1.0"), 0);
  assert.equal(compareVersions("2.0.0", "1.9.9"), 1);
  assert.equal(parseVersion("1.1.0"), "1.1.0");
  assert.equal(parseVersion(1), "1.0.0");
  assert.equal(parseVersion(2), "1.1.0");
  for (const bad of ["1.1", "1.1.0.1", "v1.1.0", "constructor", "", null, {}])
    assert.equal(parseVersion(bad), null);
});

test("旧版本项目自动升级，不兼容版本被拒绝", () => {
  const current = newProject(),
    example = demoProject();
  current.objects = example.objects;
  current.reference = example.reference;
  assert.equal(current.version, FORMAT_VERSION);
  assert.deepEqual(current.meta, {
    app: FORMAT,
    appVersion: APP_VERSION,
    savedAt: null,
  });
  // 早期整数版本号 1 等同于 1.0.0，缺少 meta，需要升级。
  const legacy = clone(current);
  legacy.version = 1;
  delete legacy.meta;
  const upgraded = upgradeProject(legacy);
  assert.equal(upgraded.version, FORMAT_VERSION);
  assert.deepEqual(upgraded.meta, {
    app: FORMAT,
    appVersion: null,
    savedAt: null,
  });
  const strip = ({ meta, ...rest }) => ({ ...rest, version: "1.0.0" });
  assert.deepEqual(strip(upgraded), strip(current));
  assert.deepEqual(validateProject(legacy).objects, current.objects);
  // 早期的整数版本号 2 等同于 1.1.0，可直接使用。
  const numericTwo = clone(current);
  numericTwo.version = 2;
  assert.deepEqual(validateProject(numericTwo), current);
  // 小版本只做修复：更高的补丁号按当前版本读取，并归一化版本号。
  const laterPatch = clone(current);
  laterPatch.version = "1.1.7";
  assert.deepEqual(validateProject(laterPatch), current);
  // 数据步骤之前的小版本号（1.0.3）按同大版本内最近的低版本（1.0.0）升级。
  const legacyPatch = clone(current);
  legacyPatch.version = "1.0.3";
  delete legacyPatch.meta;
  assert.equal(validateProject(legacyPatch).version, FORMAT_VERSION);
  for (const bad of [
    (p) => (p.version = "1.2.0"),
    (p) => (p.version = "1.2.5"),
    (p) => (p.version = "2.0.0"),
    (p) => (p.version = "0.9.0"),
    (p) => (p.version = "1.1"),
    (p) => delete p.version,
    (p) => (p.format = "SomethingElse"),
    (p) => (p.meta = { app: "Other" }),
    (p) => (p.meta = { appVersion: 42 }),
    (p) => (p.meta = { appVersion: "1.1" }),
    (p) => (p.meta = { savedAt: "not a date" }),
  ]) {
    const q = clone(current);
    bad(q);
    assert.throws(() => validateProject(q));
  }
  assert.throws(
    () => validateProject({ ...clone(current), version: "1.2.0" }),
    /高于当前工具支持/,
  );
  assert.throws(
    () => validateProject({ ...clone(current), version: "2.0.0" }),
    /大版本/,
  );
  assert.throws(
    () => validateProject({ ...clone(current), version: "0.9.0" }),
    /升级步骤/,
  );
  const stamped = clone(current);
  stamped.meta.savedAt = "2026-09-29T10:00:00.000Z";
  assert.equal(
    validateProject(stamped).meta.savedAt,
    "2026-09-29T10:00:00.000Z",
  );
});

test("工具版本标识与 package.json 保持一致", async () => {
  const { readFile } = await import("node:fs/promises");
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(APP_VERSION, pkg.version);
});

test("撤销重做深拷贝且新操作清空重做", () => {
  const h = new History(),
    p = newProject();
  h.push(p);
  p.name = "编辑后";
  const old = h.undo(p);
  assert.equal(old.name, "未命名项目");
  const next = h.redo(old);
  assert.equal(next.name, "编辑后");
  h.undo(next);
  h.push(old);
  assert.equal(h.future.length, 0);
});
const parseCSVRow = (line) => {
  const out = [];
  let value = "",
    quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch !== '"') value += ch;
      else if (line[i + 1] === '"') (value += '"'), i++;
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") (out.push(value), (value = ""));
    else value += ch;
  }
  out.push(value);
  return out;
};
test("CSV 清单保留元件、贴片与跳线裁线信息，排除锡线并处理公式与引号", () => {
  const p = demoProject();
  const wire = p.objects.find((o) => o.type === "wire");
  wire.name = '=HYPERLINK("x")';
  for (const [kind, name, x] of [
    ["resistor", "贴片 R4", 1],
    ["capacitor", "贴片 C3", 2],
  ])
    p.objects.push({
      id: kind,
      type: "component",
      mounting: "smd",
      kind,
      name,
      x,
      y: 6,
      rotation: 0,
      pins: regularPins("single", 2),
    });
  const csv = objectsCSV(p);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(csv.includes(cutLength(wire).toFixed(1)));
  const rows = csv.slice(1).split("\r\n").map(parseCSVRow);
  assert.equal(rows.length, 14); // 表头 + 9 个元件 + 2 根跳线 + 2 个贴片
  const exportedNames = new Set(rows.slice(1).map((r) => r[0]));
  for (const solder of p.objects.filter((o) => o.type === "solder"))
    assert.equal(exportedNames.has(solder.name), false);
  assert.ok(rows.every((r) => r[1] !== "锡线"));
  const ne555 = rows[1];
  assert.deepEqual(ne555.slice(0, 4), ["NE555", "元件", "正面 · 元件面", "D4"]);
  assert.equal(ne555[5], "0"); // 旋转
  assert.equal(ne555[6], "8"); // 引脚数
  assert.ok(ne555[7].startsWith("D4=GND; D5=TRIG"));
  const w1 = rows.find((r) => r[0] === "'" + wire.name);
  assert.deepEqual(w1.slice(1, 4), ["跳线", "正面 · 元件面", "E7"]);
  assert.equal(w1[7], "直连 · 2 个路径点");
  assert.equal(w1[11], cutLength(wire).toFixed(1));
  const w2 = rows.find((r) => r[0] === "W2");
  assert.equal(w2[7], "直角 · 3 个路径点");
  assert.equal(w2[11], "41.6");
  assert.deepEqual(
    rows.find((r) => r[0] === "贴片 R4").slice(1, 5),
    ["贴片电阻", "背面 · 焊盘面", "B7", "C7"],
  );
  assert.deepEqual(
    rows.find((r) => r[0] === "贴片 C3").slice(1, 5),
    ["贴片电容", "背面 · 焊盘面", "C7", "D7"],
  );
});

test("自定义引脚组的基准孔始终可保存并导入", () => {
  const p = newProject(20, 15);
  p.objects = [
    {
      id: "custom",
      name: "J1",
      type: "component",
      x: 2,
      y: 2,
      rotation: 0,
      pins: [{ x: 3, y: 2, label: "A", labelDx: 0, labelDy: -0.55 }],
    },
  ];
  const d = constrainedDelta(p.objects, -20, -20, p.board);
  moveObjects(p.objects, d.x, d.y);
  assert.deepEqual(validateProject(p), p);
});

test("回折锡线编辑端点也不产生斜线", () => {
  const path = [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 5 },
  ];
  for (let i = 0; i < path.length; i++) {
    const edited = editVertex(path, i, { x: 2, y: 3 });
    assert.ok(
      edited.every(
        (p, j) => j === 0 || p.x === edited[j - 1].x || p.y === edited[j - 1].y,
      ),
    );
  }
});

test("参考图随项目往返，兼容旧项目并拒绝外部图片地址", () => {
  const old = newProject();
  delete old.reference;
  assert.equal(validateProject(old).reference, null);
  const p = newProject();
  p.reference = {
    name: "参考.png",
    dataUrl: "data:image/png;base64,aGVsbG8=",
    naturalWidth: 640,
    naturalHeight: 400,
    x: 24,
    y: 76,
    width: 360,
    opacity: 0.6,
    visible: true,
  };
  assert.deepEqual(validateProject(p), p);
  for (const change of [
    (r) => (r.dataUrl = "https://example.com/image.png"),
    (r) => (r.opacity = 0),
    (r) => (r.width = -1),
    (r) => (r.naturalWidth = 0),
    (r) => (r.visible = "yes"),
    (r) => (r.dataUrl = "data:image/svg+xml;base64,aGVsbG8="),
  ]) {
    const q = clone(p);
    change(q.reference);
    assert.throws(() => validateProject(q));
  }
});

test("贴片元件跨接相邻焊盘，旋转及文件往返保留面和类型", async () => {
  const { objectFace, smdPlacement } = await import("../src/core.js");
  const p = newProject(20, 15);
  const c = {
    id: "smd",
    type: "component",
    mounting: "smd",
    kind: "resistor",
    name: "R1 · 10k",
    x: 4,
    y: 5,
    rotation: 0,
    pins: regularPins("single", 2),
  };
  p.objects.push(c);
  assert.equal(objectFace(c), "back");
  assert.deepEqual(pinPosition(c, c.pins[1]), { x: 5, y: 5 });
  assert.deepEqual(smdPlacement({ x: 4.5, y: 5.1 }, 0), { x: 4, y: 5 });
  assert.deepEqual(smdPlacement({ x: 4.1, y: 5.5 }, 90), { x: 4, y: 5 });
  assert.deepEqual(smdPlacement({ x: 4.5, y: 5.1 }, 180), { x: 5, y: 5 });
  assert.deepEqual(smdPlacement({ x: 4.1, y: 5.5 }, 270), { x: 4, y: 6 });
  c.rotation = 90;
  assert.deepEqual(pinPosition(c, c.pins[1]), { x: 4, y: 6 });
  assert.deepEqual(validateProject(p), p);
  c.rotation = 180;
  c.x = 0;
  assert.equal(fits([c], p.board), false);
  c.x = 4;
  c.pins[1].x = 2;
  assert.throws(() => validateProject(p), /相邻焊盘/);
});

test("公共元件库放置实例相互独立，所有定义可保存", async () => {
  const { COMPONENT_LIBRARY, instantiateLibraryItem } =
    await import("../src/library.js");
  for (const item of COMPONENT_LIBRARY) {
    const p = newProject(100, 100),
      a = instantiateLibraryItem(item, "A"),
      b = instantiateLibraryItem(item, "B");
    p.objects.push(a, b);
    assert.notEqual(a.id, b.id);
    assert.deepEqual(validateProject(p), p);
    a.pins[0].label = "changed";
    assert.notEqual(b.pins[0].label, "changed");
    assert.notEqual(item.pins[0].label, "changed");
  }
});

test("只读触摸控制器支持双指缩放且拖动不会触发选中", async () => {
  const { installViewerGestures } = await import("../src/viewer.js");
  class Surface extends EventTarget {
    setPointerCapture() {}
  }
  const canvas = new Surface(),
    calls = { pan: [], zoom: [], pick: [] };
  let enabled = true;
  installViewerGestures(canvas, {
    enabled: () => enabled,
    point: (e) => ({ x: e.clientX, y: e.clientY }),
    pan: (x, y) => calls.pan.push([x, y]),
    zoom: (f) => calls.zoom.push(f),
    pick: (p) => calls.pick.push(p),
    changed: () => {},
  });
  const emit = (type, id, x, y) => {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, {
      pointerId: id,
      pointerType: "touch",
      clientX: x,
      clientY: y,
      button: 0,
    });
    canvas.dispatchEvent(e);
  };
  emit("pointerdown", 1, 50, 50);
  emit("pointerdown", 2, 100, 50);
  emit("pointermove", 2, 150, 50);
  emit("pointerup", 2, 150, 50);
  emit("pointerup", 1, 50, 50);
  assert.equal(calls.zoom[0], 2);
  assert.equal(calls.pick.length, 0);
  emit("pointerdown", 1, 50, 50);
  emit("pointerup", 1, 50, 50);
  assert.equal(calls.pick.length, 1);
  enabled = false;
  emit("pointerdown", 1, 50, 50);
  emit("pointermove", 1, 100, 100);
  emit("pointerup", 1, 100, 100);
  assert.equal(calls.pick.length, 1);
});
