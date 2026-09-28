import test from "node:test";
import assert from "node:assert/strict";
import {
  newProject,
  demoProject,
  validateProject,
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
  wireCSV,
  regularPins,
  columnName,
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
    assert.equal(screenX(screenX(x, 30, "front"), 30, "front"), x);
  assert.equal(screenX(0, 30, "front"), 29);
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
    (p) => (p.objects[3].points[1] = { x: 8, y: 8 }),
    (p) => (p.defaults.start = -1),
    (p) => (p.objects[0].pins[0].x = 100),
  ]) {
    const q = clone(p);
    bad(q);
    assert.throws(() => validateProject(q));
  }
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
test("CSV 包含正确线长，并处理公式与引号", () => {
  const p = demoProject();
  p.objects.at(-1).name = '=HYPERLINK("x")';
  const csv = wireCSV(p);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(csv.includes(cutLength(p.objects.at(-1)).toFixed(1)));
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
  assert.equal(objectFace(c), "front");
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
