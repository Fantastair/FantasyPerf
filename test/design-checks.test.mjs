import test from "node:test";
import assert from "node:assert/strict";
import { newProject, validateProject, clone, pinPosition, FORMAT_VERSION, moveObjects, editVertex, cleanPath, isHole, regularPins } from "../src/core.js";
import { createComponentFile, parseComponentFile, COMPONENT_VERSION } from "../src/component-files.js";
import { instantiateLibraryItem } from "../src/library.js";
import { collisionIssues, firstNewCollision, analyzeConnections, declarationStatus, shellBounds, pendingLogicalConnections } from "../src/design-checks.js";
const component = (id, x, y, pins = [{ x: 0, y: 0, label: "", net: "A" }], extra = {}) =>
  ({ id, type: "component", name: id, x, y, rotation: 0, pins: pins.map((p) => ({ labelDx: 0, labelDy: -0.55, ...p })), ...extra });
const wire = (id, points, extra = {}) => ({ id, type: "wire", name: id, points, mode: "direct", color: "#3b8bc2", allowanceStart: 3, allowanceEnd: 3, ...extra });
const solder = (id, points) => ({ id, type: "solder", name: id, points });
function project(...objects) { const p = newProject(20, 20); p.objects = objects; return p; }
const kinds = (p) => analyzeConnections(p).errors.map((e) => e.kind);

test("插孔冲突包含元件与跳线端点，排除贴片、锡线及跳线路径中间", () => {
  const a = component("a", 2, 2), b = component("b", 2, 2);
  assert.equal(collisionIssues(project(a, b))[0].kind, "hole");
  const w = wire("w", [{ x: 2, y: 2 }, { x: 8, y: 2 }]);
  assert.equal(collisionIssues(project(a, w))[0].kind, "hole");
  assert.equal(collisionIssues(project(w, wire("w2", [{ x: 8, y: 2 }, { x: 9, y: 3 }]))).length, 1);
  assert.equal(collisionIssues(project(component("middle", 4, 2), w)).length, 0);
  const smd = component("smd", 2, 2, [{ x: 0, y: 0, label: "" }, { x: 1, y: 0, label: "" }], { mounting: "smd", kind: "resistor" });
  assert.equal(collisionIssues(project(a, smd, solder("s", [{ x: 2, y: 2 }, { x: 3, y: 2 }]))).length, 0);
});
test("忽略碰撞只豁免涉及该对象的冲突，不豁免其他对象，也不影响电气检查", () => {
  const a = component("a", 2, 2, [{ x: 0, y: 0, label: "", net: "A" }], { ignoreCollision: true });
  const b = component("b", 2, 2, [{ x: 0, y: 0, label: "", net: "B" }]);
  assert.equal(collisionIssues(project(a, b)).length, 0);
  assert.deepEqual(kinds(project(a, b)), ["short"]);
  assert.equal(collisionIssues(project(a, b, component("c", 2, 2))).length, 1);
});
test("旧冲突可读取与缓解，但新增占孔冲突被拦截；整体移动不与旧位置冲突", () => {
  const old = project(component("a", 2, 2), component("b", 2, 2));
  assert.doesNotThrow(() => validateProject(old));
  const next = clone(old); next.objects.push(component("c", 2, 2));
  assert.equal(firstNewCollision(old, next).kind, "hole");
  next.objects.pop(); next.objects.pop(); assert.equal(firstNewCollision(old, next), null);
  const carried = clone(old); moveObjects(carried.objects, 1, 1);
  assert.equal(firstNewCollision(old, carried), null);
  const extraPin = clone(old); extraPin.objects.forEach((o) => o.pins.push({ x: 1, y: 0, label: "" }));
  assert.equal(firstNewCollision(old, extraPin).kind, "hole");
  const moving = project(component("a", 2, 2), component("b", 3, 2));
  const moved = clone(moving); moveObjects(moved.objects, 1, 0);
  assert.equal(firstNewCollision(moving, moved), null);
  moved.objects[0].x = moved.objects[1].x;
  assert.equal(firstNewCollision(moving, moved).kind, "hole");
});
test("外壳跟随旋转，边界接触允许，同面重叠冲突且不同面隔离", () => {
  const a = component("a", 5, 5, undefined, { shell: { enabled: true, x: -1, y: -2, w: 3, h: 4 } });
  assert.deepEqual(shellBounds(a), { minX: 4, minY: 3, maxX: 7, maxY: 7 });
  a.rotation = 90;
  assert.deepEqual(shellBounds(a), { minX: 3, minY: 4, maxX: 7, maxY: 7 });
  const b = component("b", 8, 5, undefined, { shell: { enabled: true, x: -1, y: -1, w: 2, h: 2 } });
  assert.equal(collisionIssues(project(a, b)).length, 0);
  b.x = 7; assert.equal(collisionIssues(project(a, b))[0].kind, "shell");
  b.mounting = "smd";
  assert.equal(collisionIssues(project(a, b)).length, 0);
  b.mounting = undefined; b.ignoreCollision = true;
  assert.equal(collisionIssues(project(a, b)).length, 0);
});
test("焊盘面锡线穿过已启用贴片外壳被检测，端子接线允许", () => {
  const smd = component("r", 3, 3, [{ x: 0, y: 0, label: "" }, { x: 1, y: 0, label: "" }], {
    mounting: "smd", kind: "resistor", shell: { enabled: true, x: 0.15, y: -0.25, w: 0.7, h: 0.5 },
  });
  const crossing = solder("s", [{ x: 2, y: 3 }, { x: 5, y: 3 }]);
  assert.equal(collisionIssues(project(smd, crossing))[0].kind, "shell-solder");
  assert.equal(collisionIssues(project(smd, solder("s", [{ x: 2, y: 3 }, { x: 3, y: 3 }]))).length, 0);
  smd.ignoreCollision = true; assert.equal(collisionIssues(project(smd, crossing)).length, 0);
});
test("全部引脚明确才检查连接，NC 标签文字不等同于 NC 声明", () => {
  const p = project(component("a", 2, 2), component("b", 6, 2, [{ x: 0, y: 0, label: "NC" }]));
  const result = analyzeConnections(p);
  assert.equal(result.enabled, false); assert.equal(result.undeclared.length, 1); assert.deepEqual(result.errors, []);
  p.objects[1].pins[0].nc = true;
  assert.equal(analyzeConnections(p).enabled, true);
  assert.equal(declarationStatus(newProject()).enabled, false);
});
test("锡线沿途焊盘、T 接、交叉及重叠形成同一实际网络", () => {
  const p = project(component("a", 1, 3), component("b", 3, 3), component("c", 5, 5),
    solder("s1", [{ x: 1, y: 3 }, { x: 7, y: 3 }]),
    solder("s2", [{ x: 5, y: 1 }, { x: 5, y: 5 }]),
    solder("s3", [{ x: 2, y: 3 }, { x: 6, y: 3 }]));
  assert.deepEqual(kinds(p), []);
  assert.equal(analyzeConnections(p).warnings.length, 0);
});
test("跳线只连接两端，经过孔位、折点及交叉均不接入", () => {
  const p = project(component("a", 1, 3), component("b", 7, 3), component("middle", 4, 3, [{ x: 0, y: 0, label: "", net: "B" }]),
    wire("w", [{ x: 1, y: 3 }, { x: 7, y: 3 }]),
    wire("cross", [{ x: 4, y: 1 }, { x: 4, y: 5 }]));
  assert.deepEqual(kinds(p), []);
  assert.ok(analyzeConnections(p).warnings.some((e) => e.kind === "floating"));
  p.objects[3].mode = "orthogonal"; p.objects[3].points = [{ x: 1, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 6 }];
  p.objects[1].x = 4; p.objects[1].y = 6;
  assert.deepEqual(kinds(p), []);
});
test("电阻、电容及其他元件内部不合并网络，分别检测漏接和误短接", () => {
  const r = component("r", 3, 3, [{ x: 0, y: 0, label: "", net: "A" }, { x: 1, y: 0, label: "", net: "B" }], { mounting: "smd", kind: "resistor" });
  const p = project(r, component("a", 1, 3), component("b", 6, 3, [{ x: 0, y: 0, label: "", net: "B" }]),
    solder("s1", [{ x: 1, y: 3 }, { x: 3, y: 3 }]), solder("s2", [{ x: 4, y: 3 }, { x: 6, y: 3 }]));
  assert.deepEqual(kinds(p), []);
  r.kind = "capacitor"; assert.deepEqual(kinds(p), []);
  p.objects.pop(); assert.deepEqual(kinds(p), ["open"]);
  p.objects.push(solder("bridge", [{ x: 3, y: 3 }, { x: 6, y: 3 }]));
  assert.deepEqual(kinds(p), ["short"]);
});
test("NC 不可接其他端子，独立 NC 间也不可相连，独自焊接尾线可存在", () => {
  const p = project(component("a", 2, 2, [{ x: 0, y: 0, label: "", nc: true }]),
    component("b", 5, 2, [{ x: 0, y: 0, label: "", nc: true }]));
  assert.deepEqual(kinds(p), []);
  p.objects.push(solder("tail", [{ x: 2, y: 2 }, { x: 3, y: 2 }])); assert.deepEqual(kinds(p), []);
  p.objects.push(solder("s", [{ x: 3, y: 2 }, { x: 5, y: 2 }])); assert.deepEqual(kinds(p), ["nc", "nc"]);
});
test("警告不导致连接失败；独立声明组的孤立端子和跳线悬空端点可定位", () => {
  const p = project(component("a", 2, 2), wire("w", [{ x: 5, y: 5 }, { x: 8, y: 5 }]));
  const result = analyzeConnections(p);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.warnings.map((e) => e.kind), ["floating", "dangling", "dangling"]);
  assert.ok(result.warnings.every((e) => e.ids.length && e.points.length));
});
test("移动和旋转保留引脚身份及逻辑关系，物理线路保持原位后报告漏接", () => {
  const p = project(component("a", 2, 2, [{ id: "pin-a", x: 0, y: 0, label: "", net: "A" }]), component("b", 6, 2),
    solder("s", [{ x: 2, y: 2 }, { x: 6, y: 2 }]));
  assert.deepEqual(kinds(p), []);
  p.objects[0].y++; p.objects[0].rotation = 90;
  assert.equal(p.objects[0].pins[0].id, "pin-a"); assert.deepEqual(kinds(p), ["open"]);
});
test("项目往返保留规则；旧文件不自动声明；元件文件保留 NC 和物理规则而不携带原板网络", () => {
  const p = project(component("a", 3, 3, [{ id: "a", x: 0, y: 0, label: "VCC", net: "VCC" }, { id: "b", x: 1, y: 0, label: "NC", nc: true }],
    { ignoreCollision: true, shell: { enabled: true, x: -1, y: -1, w: 3, h: 2 } }));
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))), p);
  const old = project(component("old", 2, 2, [{ x: 0, y: 0, label: "NC" }])); old.version = "1.2.0";
  const restored = validateProject(old);
  assert.equal(restored.version, FORMAT_VERSION); assert.equal(declarationStatus(restored).enabled, false);
  const file = createComponentFile(p.objects);
  assert.equal(file.version, COMPONENT_VERSION);
  const item = parseComponentFile(file)[0];
  assert.equal(item.pins[0].net, undefined); assert.equal(item.pins[0].id, undefined); assert.equal(item.pins[1].nc, true);
  assert.deepEqual(item.shell, p.objects[0].shell); assert.equal(item.ignoreCollision, true);
  assert.deepEqual(instantiateLibraryItem(item, "new").shell, p.objects[0].shell);
});
test("损坏的外壳、豁免、重复身份及相互冲突的引脚声明被拒绝", () => {
  const p = project(component("a", 3, 3, [{ id: "a", x: 0, y: 0, label: "", net: "N1" }, { id: "b", x: 1, y: 0, label: "", nc: true }]));
  for (const mutate of [
    (o) => { o.ignoreCollision = "true"; }, (o) => { o.shell = { enabled: true, x: 0, y: 0, w: 0, h: 1 }; },
    (o) => { o.shell = { enabled: 1, x: 0, y: 0, w: 1, h: 1 }; },
    (o) => { o.pins[0].nc = true; }, (o) => { o.pins[0].net = " "; }, (o) => { o.pins[0].net = "N".repeat(81); },
    (o) => { o.pins[1].id = "a"; },
  ]) { const bad = clone(p); mutate(bad.objects[0]); assert.throws(() => validateProject(bad)); }
});

test("占孔提示不掩盖需要阻止的新外壳碰撞", () => {
  const old = project(component("a", 2, 2), component("b", 6, 2));
  const next = clone(old); next.objects[1].x = 2;
  assert.equal(firstNewCollision(old, next, { includeHoles: false }), null);
  for (const p of [old, next]) p.objects.forEach((o) => { o.shell = { enabled: true, x: -0.4, y: -0.4, w: 0.8, h: 0.8 }; });
  assert.equal(firstNewCollision(old, next, { includeHoles: false }).kind, "shell");
});
test("跳线自动与正面外壳比较，直连斜线和半格折线都检测，跨线及不同面允许", () => {
  const a = component("a", 5, 5, undefined, { shell: { enabled: true, x: -0.4, y: -0.4, w: 0.8, h: 0.8 } });
  const w = wire("w", [{ x: 2, y: 2 }, { x: 8, y: 8 }]);
  assert.equal(collisionIssues(project(a, w))[0].kind, "shell-wire");
  w.mode = "orthogonal"; w.points = [{ x: 2, y: 5 }, { x: 2, y: 4.5 }, { x: 8, y: 4.5 }, { x: 8, y: 5 }];
  assert.equal(collisionIssues(project(a, w)).length, 0);
  a.shell.y = -0.45; // the jumper body extends 0.07 pitches from its centerline
  assert.equal(collisionIssues(project(a, w))[0].kind, "shell-wire");
  a.mounting = "smd"; assert.equal(collisionIssues(project(a, w)).length, 0);
  a.mounting = undefined; w.ignoreCollision = true; assert.equal(collisionIssues(project(a, w)).length, 0);
  w.ignoreCollision = false; a.shell.enabled = false; assert.equal(collisionIssues(project(a, w)).length, 0);
  assert.equal(collisionIssues(project(w, wire("w2", [{ x: 5, y: 1 }, { x: 5, y: 9 }]))).length, 0);
});
test("直角跳线半格中间点可往返，端点、直连和锡线仍要求整数孔位", () => {
  const w = wire("w", [{ x: 2, y: 2 }, { x: 2, y: 2.5 }, { x: 8, y: 2.5 }, { x: 8, y: 6 }], { mode: "orthogonal" });
  assert.deepEqual(validateProject(project(w)).objects[0], w);
  for (const mutate of [
    (w) => { w.points[0].y = 1.5; }, (w) => { w.points.at(-1).y = 6.5; },
    (w) => { w.points[1].y = w.points[2].y = 2.25; },
    (w) => { w.type = "solder"; },
    (w) => { w.mode = "direct"; w.points = [{ x: 2, y: 2 }, { x: 8, y: 6.5 }]; },
    (w) => { w.points = [{ x: 2, y: 2 }, { x: 19.5, y: 2 }, { x: 19.5, y: 6 }, { x: 8, y: 6 }]; },
  ]) { const bad = clone(w); mutate(bad); assert.throws(() => validateProject(project(bad))); }
  const p = project(component("a", 2, 2), component("b", 8, 6), component("middle", 5, 3, [{ x: 0, y: 0, label: "", net: "B" }]), w);
  assert.deepEqual(kinds(p), []);
});
test("半格折点编辑保留真实插孔端点，自动补齐直角连接且可保存", () => {
  const points = [{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 8, y: 3 }, { x: 8, y: 6 }];
  for (const [index, target] of [[1, { x: 2.5, y: 3.5 }], [2, { x: 8.5, y: 3.5 }]]) {
    const changed = cleanPath(editVertex(points, index, target, true, true));
    assert.deepEqual(changed[0], points[0]); assert.deepEqual(changed.at(-1), points.at(-1));
    assert.ok(changed.some((p) => p.x === target.x && p.y === target.y));
    assert.ok(changed.every((p, i) => !i || p.x === changed[i - 1].x || p.y === changed[i - 1].y));
    assert.ok(isHole(changed[0]) && isHole(changed.at(-1)));
    assert.doesNotThrow(() => validateProject(project(wire("w", changed, { mode: "orthogonal" }))));
  }
});
test("逻辑显示按实际连通部分合并，局部连接隐藏局部虚线，完整声明不是前提", () => {
  const p = project(component("a", 2, 2), component("b", 6, 2), component("c", 9, 2),
    component("unknown", 2, 9, [{ x: 0, y: 0, label: "" }]));
  assert.equal(declarationStatus(p).enabled, false);
  assert.equal(pendingLogicalConnections(p).length, 2);
  p.objects.push(solder("s", [{ x: 2, y: 2 }, { x: 6, y: 2 }]));
  assert.deepEqual(pendingLogicalConnections(p), [{ net: "A", from: { x: 6, y: 2 }, to: { x: 9, y: 2 } }]);
  p.objects.push(wire("w", [{ x: 6, y: 2 }, { x: 9, y: 2 }]));
  assert.equal(pendingLogicalConnections(p).length, 0);
  p.objects.pop(); assert.equal(pendingLogicalConnections(p).length, 1);
  assert.ok(p.objects.slice(0, 3).every((o) => o.pins[0].net === "A"));
});
test("新引脚的标注偏移默认居中，已有显式偏移仍保留", () => {
  assert.ok(regularPins("double", 8).every((p) => p.labelDx === 0 && p.labelDy === 0));
  assert.ok(regularPins("single", 3).every((p) => p.labelDx === 0 && p.labelDy === 0));
  const a = component("a", 2, 2, [{ x: 0, y: 0, label: "A", labelDx: 1.5, labelDy: -2 }]);
  const p = project(a); p.version = "1.3.0";
  assert.deepEqual(validateProject(p).objects[0].pins[0], a.pins[0]);
});

test("逻辑线取最近端子构成最短连通树，不依赖元件列表顺序，不跨连接组", () => {
  const p = project(component("a", 0, 0), component("b", 9, 0), component("c", 8, 0), component("d", 8, 3),
    component("other", 8, 1, [{ x: 0, y: 0, label: "", net: "B" }]));
  const edges = (links) => links.map(({ from, to }) => [from, to].map((p) => `${p.x},${p.y}`).sort().join("/")).sort();
  const expected = ["0,0/8,0", "8,0/9,0", "8,0/8,3"].sort();
  assert.deepEqual(edges(pendingLogicalConnections(p)), expected);
  p.objects.reverse(); assert.deepEqual(edges(pendingLogicalConnections(p)), expected);
  // Joining the remote and near pins leaves the near member as the best remaining endpoint.
  p.objects.push(wire("w", [{ x: 0, y: 0 }, { x: 8, y: 0 }]));
  assert.deepEqual(edges(pendingLogicalConnections(p)), ["8,0/9,0", "8,0/8,3"].sort());
});

test("贴片直接接其他引脚的焊盘无需额外锡线，不误报悬空，仍检查漏接、短接和 NC", () => {
  const a = component("a", 3, 3), b = component("b", 4, 3, [{ x: 0, y: 0, label: "", net: "B" }]);
  const r = component("r", 3, 3, [{ x: 0, y: 0, label: "", net: "A" }, { x: 1, y: 0, label: "", net: "B" }],
    { mounting: "smd", kind: "resistor" });
  const p = project(a, b, r);
  assert.deepEqual(analyzeConnections(p).warnings, []);
  assert.deepEqual(kinds(p), []);
  assert.deepEqual(collisionIssues(p), []);
  p.objects.splice(1, 1);
  assert.deepEqual(analyzeConnections(p).warnings.map((w) => w.message), ["r 第 2 脚没有实际连线"]);
  a.pins[0].net = "B"; assert.ok(kinds(p).includes("short"));
  delete a.pins[0].net; a.pins[0].nc = true; assert.ok(kinds(p).includes("nc"));
  a.pins[0].nc = false; a.pins[0].net = "A"; a.x = 2;
  assert.ok(kinds(p).includes("open"));
  assert.equal(analyzeConnections(p).warnings.length, 3);
});
