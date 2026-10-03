import { test, expect } from "@playwright/test";
import { newProject, regularPins } from "../../src/core.js";
const store = "fantasyperf.project.v1";
const pageErrors = new WeakMap();
test.beforeEach(({ page }) => { const errors = []; pageErrors.set(page, errors); page.on("pageerror", (e) => errors.push(e.message)); });
test.afterEach(({ page }) => { expect(pageErrors.get(page)).toEqual([]); });
const component = (id, x, y, count = 1, extra = {}) => ({ id, type: "component", name: id,
  x, y, rotation: 0, pins: regularPins("single", count).map((p) => ({ ...p, label: "" })), ...extra });
async function load(page, objects) {
  await page.goto("/");
  const project = newProject(20, 15, "校验验收"); project.objects = objects;
  await page.locator("#file-input").setInputFiles({ name: "校验.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await page.locator("#confirm-import").click();
  await expect(page.locator("#save-status")).toContainText("已自动保存");
}
async function saved(page) {
  await expect(page.locator("#save-status")).toContainText("已自动保存");
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), store);
}
async function point(page, x, y, face = "front") {
  const box = await page.locator("#board").boundingBox();
  const view = await page.locator('[data-view].active').getAttribute("data-view");
  const w = view === "split" ? box.width / 2 : box.width, h = box.height;
  // Tests fit to the full board; avoid the rounded zoom label for precise hit positions.
  const fitZoom = Math.max(0.15, Math.min(3, (w - 100) / (21 * 28), (h - 160) / (16 * 28)));
  return { x: box.x + (view === "split" && face === "back" ? w : 0) + w / 2 + ((face === "back" ? 19 - x : x) - 9.5) * 28 * fitZoom,
    y: box.y + h / 2 + (y - 7) * 28 * fitZoom };
}
async function click(page, x, y, face = "front") {
  const p = await point(page, x, y, face); await page.mouse.click(p.x, p.y);
}
async function fit(page) { await page.locator('[data-action="fit"]').last().click(); }
async function choose(page, x, y, face = "front") {
  await page.locator('.tools [data-tool="select"]').click(); await fit(page); await click(page, x, y, face);
}
async function drawSolder(page, points) {
  await page.locator('.tools [data-tool="solder"]').click(); await fit(page);
  for (const [x, y] of points) await click(page, x, y);
  await page.keyboard.press("Enter"); await saved(page);
}

test("新元件允许共孔并报告冲突，碰撞豁免可解除提示", async ({ page }, testInfo) => {
  await load(page, [component("A", 3, 3)]);
  await page.locator('.tools [data-tool="component"]').click();
  await page.locator('[data-library="header-2"]').click();
  await click(page, 3, 3);
  expect((await saved(page)).objects).toHaveLength(2);
  await page.locator('[data-panel="checks"]').click();
  await expect(page.locator("#check-issues")).toContainText("D4 插孔冲突");
  await expect(page.locator("#connection-status")).toContainText("未开启");
  await page.screenshot({ path: testInfo.outputPath("hole-conflict.png") });
  await page.locator("[data-check-issue]").click();
  await expect(page.locator("#inspector-content")).toContainText("已选 2 个对象");
  await choose(page, 4, 3);
  await page.locator("#ignore-collision").check();
  await page.locator('[data-panel="checks"]').click();
  await expect(page.locator("#inspector-content")).toContainText("物理碰撞检查通过");
});

test("旋转、键盘、属性、拖动及复制均允许占孔冲突并支持撤销", async ({ page }) => {
  await load(page, [component("A", 3, 3, 2), component("B", 3, 4), component("C", 4, 4)]);
  await choose(page, 3, 3);
  await page.keyboard.press("r");
  expect((await saved(page)).objects[0].rotation).toBe(90);
  await page.keyboard.press("Control+z");
  await choose(page, 3, 3);
  await page.keyboard.press("ArrowDown");
  expect((await saved(page)).objects[0].y).toBe(4);
  await page.keyboard.press("Control+z");
  await choose(page, 3, 3);
  await page.locator("#object-y").fill("5"); await page.locator("#object-y").press("Tab");
  expect((await saved(page)).objects[0].y).toBe(4);
  await page.locator('[data-action="undo"]').click();
  await choose(page, 3, 3);
  await page.locator("#board").focus();
  await page.keyboard.press("Control+c"); await page.keyboard.press("Control+v");
  expect((await saved(page)).objects).toHaveLength(4);
  await page.keyboard.press("Control+z");
  await choose(page, 3, 3);
  const a = await point(page, 3, 3), b = await point(page, 3, 4);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
  expect((await saved(page)).objects[0].y).toBe(4);
  await page.locator('[data-panel="checks"]').click();
  await expect(page.locator("#check-issues")).toContainText("插孔冲突");
  await page.locator('[data-action="undo"]').click();
  expect((await saved(page)).objects[0].y).toBe(3);
});

test("跳线端点共孔显示冲突，特殊跳线可豁免", async ({ page }) => {
  await load(page, [component("A", 3, 3)]);
  await page.locator('[data-panel="checks"]').click();
  await page.locator('.tools [data-tool="wire"]').click();
  await click(page, 3, 3); await click(page, 8, 6);
  expect((await saved(page)).objects).toHaveLength(2);
  await page.locator('[data-panel="checks"]').click();
  await expect(page.locator("#check-issues")).toContainText("D4 插孔冲突");
  await choose(page, 5, 4.2);
  await page.locator("#ignore-collision").check();
  const p = await saved(page); expect(p.objects).toHaveLength(2); expect(p.objects[1].ignoreCollision).toBe(true);
  await page.locator('[data-panel="checks"]').click();
  await expect(page.locator("#ignored-collision-list")).toContainText("W1");
});

test("外壳可启用和手动调整，旋转边界随对象保存且移动碰撞被阻止", async ({ page }, testInfo) => {
  await load(page, [component("A", 3, 3), component("B", 6, 3, 1, { shell: { enabled: true, x: -0.4, y: -0.4, w: 0.8, h: 0.8 } })]);
  await choose(page, 3, 3);
  await page.locator("#shell-enabled").check();
  await page.locator("#shell-w").fill("2"); await page.locator("#shell-w").press("Tab");
  expect((await saved(page)).objects[0].shell).toMatchObject({ enabled: true, x: -0.4, w: 2 });
  await page.locator("#object-x").fill("6"); await page.locator("#object-x").press("Tab");
  await expect(page.locator("#toast")).toContainText("外壳重叠");
  expect((await saved(page)).objects[0].x).toBe(3);
  await page.locator("#board").focus(); await page.keyboard.press("r");
  expect((await saved(page)).objects[0].rotation).toBe(90);
  await page.screenshot({ path: testInfo.outputPath("shell-boundary.png") });
  await page.reload(); await choose(page, 3, 3);
  await expect(page.locator("#shell-enabled")).toBeChecked();
  await expect(page.locator("#shell-w")).toHaveValue("2");
});

test("画布逻辑连接与 NC 完整声明后检查漏接、通过和 NC 错接；撤销及重载保留", async ({ page }, testInfo) => {
  await load(page, [component("A", 2, 3, 2), component("B", 7, 3, 2)]);
  await page.locator('.tools [data-tool="logic"]').click();
  await click(page, 2, 3); await click(page, 7, 3);
  let p = await saved(page);
  expect(p.objects[0].pins[0].net).toBe("N1"); expect(p.objects[1].pins[0].net).toBe("N1");
  await choose(page, 7.5, 3); await page.locator("#pin-intent-1").selectOption("nc");
  await choose(page, 2, 3); await page.locator("#pin-intent-1").selectOption("nc");
  await page.locator('[data-panel="checks"]').click();
  await expect(page.locator("#connection-status")).toContainText("1 个错误");
  await expect(page.locator("#check-issues")).toContainText("漏接");
  await drawSolder(page, [[2, 3], [2, 4], [7, 4], [7, 3]]);
  await page.locator('[data-panel="checks"]').click();
  await expect(page.locator("#connection-status")).toContainText("全部通过");
  await page.screenshot({ path: testInfo.outputPath("logical-check-passed.png") });
  await drawSolder(page, [[7, 3], [8, 3]]);
  await page.locator('[data-panel="checks"]').click();
  await expect(page.locator("#check-issues")).toContainText("NC");
  await page.locator("#board").focus(); await page.keyboard.press("Control+z");
  await expect(page.locator("#connection-status")).toContainText("全部通过");
  await page.reload(); await page.locator('[data-panel="checks"]').click();
  await expect(page.locator("#connection-status")).toContainText("全部通过");
  await choose(page, 7.5, 3); await page.locator("#pin-intent-1").selectOption("unknown");
  await page.locator('[data-panel="checks"]').click();
  await expect(page.locator("#connection-status")).toContainText("尚有 1 / 4 个引脚未声明");
});

test("碰撞豁免不豁免误短接；复制与元件文件不沿用原板连接组", async ({ page }) => {
  const a = component("A", 2, 3, 1, { ignoreCollision: true }); a.pins[0].net = "A";
  const b = component("B", 2, 3); b.pins[0].net = "B";
  await load(page, [a, b]);
  await page.locator('[data-panel="checks"]').click();
  await expect(page.locator("#check-issues")).toContainText("误短接");
  await expect(page.locator("#inspector-content")).toContainText("物理碰撞检查通过");
  await choose(page, 2, 3);
  const pending = page.waitForEvent("download");
  await page.locator('[data-action="export-component"]').click();
  const download = await pending;
  const { readFile } = await import("node:fs/promises");
  const file = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(file.components[0].pins[0].net).toBeUndefined();
  await page.locator('[data-action="duplicate"]').click();
  expect((await saved(page)).objects[2].pins[0].net).toBeUndefined();
  await page.locator('[data-panel="checks"]').click();
  await expect(page.locator("#connection-status")).toContainText("未开启");
});

test("跨面逻辑连接合并两组，撤销恢复原分组", async ({ page }) => {
  const a = component("A", 3, 3, 2); a.pins.forEach((p) => { p.net = "Left"; });
  const b = component("R", 8, 4, 2, { mounting: "smd", kind: "resistor" }); b.pins.forEach((p) => { p.net = "Right"; });
  await load(page, [a, b]);
  await page.locator('.tools [data-tool="logic"]').click();
  await click(page, 3, 3);
  await page.locator('.tools [data-tool="select"]').click();
  await page.locator('.tools [data-tool="logic"]').click();
  await click(page, 4, 3);
  expect((await saved(page)).objects[0].pins.map((p) => p.net)).toEqual(["Left", "Left"]);
  await expect(page.locator('#status-hint')).toContainText("点击第二个引脚");
  await page.locator('[data-view="back"]').click();
  await click(page, 8, 4, "back");
  expect((await saved(page)).objects.flatMap((o) => o.pins.map((p) => p.net))).toEqual(["Left", "Left", "Left", "Left"]);
  await page.locator("#board").focus(); await page.keyboard.press("Control+z");
  expect((await saved(page)).objects.flatMap((o) => o.pins.map((p) => p.net))).toEqual(["Left", "Left", "Right", "Right"]);
});

test("直连跳线外壳碰撞被拒绝后可重选终点，项目仍满足直连格式", async ({ page }) => {
  await load(page, [component("A", 8, 6, 1, { shell: { enabled: true, x: -0.4, y: -0.4, w: 0.8, h: 0.8 } })]);
  await page.locator('.tools [data-tool="wire"]').click();
  await click(page, 3, 3); await click(page, 8, 6);
  await expect(page.locator("#toast")).toContainText("外壳碰撞");
  await click(page, 9, 2);
  const p = await saved(page);
  expect(p.objects[1].points).toEqual([{ x: 3, y: 3 }, { x: 9, y: 2 }]);
  const { validateProject } = await import("../../src/core.js");
  expect(() => validateProject(p)).not.toThrow();
});

test("逻辑虚线、NC 和校验高亮不进入 PNG，外壳边界可导出", async ({ page }) => {
  await load(page, []);
  const counts = await page.evaluate(async () => {
    const { newProject } = await import("/src/core.js");
    const { drawScene } = await import("/src/renderer.js");
    const project = newProject(10, 10);
    project.objects = [
      { id: "a", type: "component", name: "A", x: 2, y: 2, rotation: 0,
        shell: { enabled: true, x: -0.4, y: -0.4, w: 1, h: 1 }, pins: [{ x: 0, y: 0, label: "", net: "N1" }] },
      { id: "b", type: "component", name: "B", x: 6, y: 2, rotation: 0,
        pins: [{ x: 0, y: 0, label: "", net: "N1" }, { x: 1, y: 0, label: "", nc: true }] },
    ];
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    const stroke = ctx.stroke.bind(ctx), strokeRect = ctx.strokeRect.bind(ctx);
    let count = {};
    const add = () => { const c = ctx.strokeStyle; count[c] = (count[c] || 0) + 1; };
    ctx.stroke = (...args) => { add(); stroke(...args); };
    ctx.strokeRect = (...args) => { add(); strokeRect(...args); };
    const render = (exporting, readOnly = false) => {
      count = {};
      drawScene(canvas, project, { view: "front", camera: { zoom: 1, panX: 0, panY: 0 },
        selected: new Set(), showLogic: true, readOnly, checkHighlight: [{ x: 2, y: 2 }] },
      { width: 600, height: 600, exporting });
      return { logic: count["#9967bd"] || 0, highlight: count["#dc6654"] || 0, shell: count["#cc8b32"] || 0 };
    };
    const result = { editor: render(false), png: render(true), viewer: render(false, true) };
    project.objects.push({ id: "conflict", type: "component", name: "C", x: 2, y: 2, rotation: 0,
      pins: [{ x: 0, y: 0, label: "" }] });
    return { ...result, conflictEditor: render(false), conflictPNG: render(true) };
  });
  expect(counts.editor).toMatchObject({ logic: 3, highlight: 1, shell: 1 });
  expect(counts.png).toMatchObject({ logic: 0, highlight: 0, shell: 1 });
  expect(counts.viewer).toMatchObject({ logic: 0, highlight: 0, shell: 1 });
  expect(counts.conflictEditor.highlight).toBe(4); // highlight circle + conflict circle and two cross strokes
  expect(counts.conflictPNG.highlight).toBe(0);
});

test("单行顶栏显示当前版本，桌面窄屏和手机查看器均无横向溢出", async ({ page }, testInfo) => {
  await load(page, []);
  const { APP_VERSION } = await import("../../src/core.js");
  for (const width of [1440, 1280, 1000]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator("#app-version")).toHaveText(`v${APP_VERSION}`);
    await expect(page.locator(".commandbar")).toHaveCount(0);
    const boxes = await page.locator(".header").evaluate((header) => {
      const h = header.getBoundingClientRect();
      return [...header.children].map((node) => {
        const b = node.getBoundingClientRect();
        return { inside: b.left >= h.left && b.right <= h.right && b.top >= h.top && b.bottom <= h.bottom,
          center: (b.top + b.bottom) / 2 };
      });
    });
    expect(boxes.every((b) => b.inside)).toBe(true);
    expect(Math.max(...boxes.map((b) => b.center)) - Math.min(...boxes.map((b) => b.center))).toBeLessThan(2);
  }
  await page.screenshot({ path: testInfo.outputPath("single-header-1000.png") });
  await page.setViewportSize({ width: 430, height: 896 });
  await page.goto("/?view=1");
  await expect(page.locator("#app-version")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(430);
  await page.screenshot({ path: testInfo.outputPath("viewer-header.png") });
});

test("新标注居中于元件及引脚，镜像、旋转及已有显式偏移正确", async ({ page }) => {
  await load(page, []);
  const centers = await page.evaluate(async () => {
    const { regularPins, pinPosition, newProject } = await import("/src/core.js");
    const { componentNameBox, labelBox, toScreen } = await import("/src/renderer.js");
    const { COMPONENT_LIBRARY } = await import("/src/library.js");
    const ctx = document.createElement("canvas").getContext("2d"), board = newProject(20, 15).board;
    const camera = { zoom: 1, panX: 0, panY: 0 }, result = [];
    for (const rotation of [0, 90, 180, 270]) for (const face of ["front", "back"]) {
      const view = { face, x: 0, y: 0, w: 600, h: 600 };
      const c = { type: "component", x: 8, y: 6, rotation, name: "U1", pins: regularPins("double", 8) };
      const ps = c.pins.map((p) => pinPosition(c, p));
      const expected = toScreen({ x: (Math.min(...ps.map((p) => p.x)) + Math.max(...ps.map((p) => p.x))) / 2,
        y: (Math.min(...ps.map((p) => p.y)) + Math.max(...ps.map((p) => p.y))) / 2 }, board, view, camera);
      const box = componentNameBox(ctx, c, board, view, camera);
      const pin = labelBox(ctx, c, c.pins[0], board, view, camera), pinPoint = toScreen(ps[0], board, view, camera);
      result.push([box.tx - expected.x, box.ty - expected.y, pin.tx - pinPoint.x, pin.ty - pinPoint.y]);
    }
    const c = { type: "component", x: 8, y: 6, rotation: 0, name: "U1", pins: regularPins("double", 8), nameDx: 1, nameDy: -2 };
    const moved = componentNameBox(ctx, c, board, { face: "front", x: 0, y: 0, w: 600, h: 600 }, camera);
    return { result, moved: moved.position, presets: COMPONENT_LIBRARY.every((c) => c.pins.every((p) => p.labelDx === 0 && p.labelDy === 0)) };
  });
  expect(centers.result.every((deltas) => deltas.every((d) => d === 0))).toBe(true);
  expect(centers.moved).toEqual({ x: 10.5, y: 4 });
  expect(centers.presets).toBe(true);
});

test("直角跳线支持半格通道与折点拖动，终点须落在焊盘且导入导出保留", async ({ page }, testInfo) => {
  await load(page, []);
  await page.locator('.tools [data-tool="wire"]').click();
  await page.locator("#wire-mode").selectOption("orthogonal");
  await click(page, 2, 2); await click(page, 2, 2.5); await click(page, 8, 2.5);
  await page.keyboard.press("Enter");
  await expect(page.locator("#toast")).toContainText("跳线两端必须落在焊盘");
  expect((await saved(page)).objects).toHaveLength(0);
  await click(page, 8, 6); await page.keyboard.press("Enter");
  let w = (await saved(page)).objects[0];
  expect(w.points).toEqual([{ x: 2, y: 2 }, { x: 2, y: 2.5 }, { x: 8, y: 2.5 }, { x: 8, y: 6 }]);
  await page.locator('.tools [data-tool="select"]').click(); await fit(page); await click(page, 5, 2.5);
  const a = await point(page, 2, 2.5), b = await point(page, 2.5, 3.5);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
  w = (await saved(page)).objects[0];
  expect(w.points[0]).toEqual({ x: 2, y: 2 }); expect(w.points.at(-1)).toEqual({ x: 8, y: 6 });
  expect(w.points).toContainEqual({ x: 2.5, y: 3.5 });
  const { validateProject, cutLength } = await import("../../src/core.js");
  expect(() => validateProject(projectForWire(w))).not.toThrow();
  await expect(page.locator(".metric strong")).toHaveText(cutLength(w).toFixed(1));
  await page.locator('[data-action="export"]').click();
  const pending = page.waitForEvent("download"); await page.locator('[data-export="project"]').click();
  const { readFile } = await import("node:fs/promises");
  const buffer = await readFile(await (await pending).path());
  await page.locator("#file-input").setInputFiles({ name: "半格.json", mimeType: "application/json", buffer });
  await page.locator("#confirm-import").click();
  expect((await saved(page)).objects[0].points).toEqual(w.points);
  await page.reload(); expect((await saved(page)).objects[0].points).toEqual(w.points);
  await page.screenshot({ path: testInfo.outputPath("half-grid-wire.png") });
});

function projectForWire(wire) { const p = newProject(20, 15); p.objects = [wire]; return p; }

test("实际连接后逻辑线逐段隐藏，删除线路与撤销恢复显示，声明不丢失", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const proto = CanvasRenderingContext2D.prototype, stroke = proto.stroke, clear = proto.clearRect;
    proto.clearRect = function (...args) { if (this.canvas.id === "board") window.logicStrokes = 0; return clear.apply(this, args); };
    proto.stroke = function (...args) {
      if (this.canvas.id === "board" && this.strokeStyle === "#9967bd") window.logicStrokes++;
      return stroke.apply(this, args);
    };
  });
  const a = component("A", 3, 3), b = component("B", 8, 3), c = component("C", 12, 3), unknown = component("D", 3, 7);
  for (const o of [a, b, c]) o.pins[0].net = "N1";
  await load(page, [a, b, c, unknown]);
  await page.locator('[data-panel="checks"]').click(); await page.locator("#show-logic").check();
  await expect.poll(() => page.evaluate(() => window.logicStrokes)).toBe(2);
  await drawSolder(page, [[3, 3], [8, 3]]);
  await expect.poll(() => page.evaluate(() => window.logicStrokes)).toBe(1);
  await drawSolder(page, [[8, 3], [12, 3]]);
  await expect.poll(() => page.evaluate(() => window.logicStrokes)).toBe(0);
  await expect(page.locator("#connection-status")).toContainText("未开启");
  await page.locator("#board").focus(); await page.keyboard.press("Delete");
  await expect.poll(() => page.evaluate(() => window.logicStrokes)).toBe(1);
  await page.keyboard.press("Control+z");
  await expect.poll(() => page.evaluate(() => window.logicStrokes)).toBe(0);
  expect((await saved(page)).objects.slice(0, 3).map((o) => o.pins[0].net)).toEqual(["N1", "N1", "N1"]);
  await page.screenshot({ path: testInfo.outputPath("connected-logic-hidden.png") });
});

test("正面直接声明贴片逻辑连接并移动、旋转，翻面与重载保持同一元件", async ({ page }, testInfo) => {
  const a = component("A", 3, 3), r = component("R", 8, 4, 2, { mounting: "smd", kind: "resistor" });
  await load(page, [a, r]);
  // Logic mode exposes both faces even when ordinary opposite-face reference is hidden.
  await page.locator("#ghost").uncheck();
  await page.locator('.tools [data-tool="logic"]').click();
  await click(page, 3, 3); await click(page, 8, 4);
  let p = await saved(page);
  expect(p.objects[0].pins[0].net).toBe("N1"); expect(p.objects[1].pins[0].net).toBe("N1");
  await expect(page.locator('[data-view="front"]')).toHaveClass("active");
  await page.locator('.tools [data-tool="select"]').click();
  await click(page, 16, 10); await page.locator("#ghost").check();
  await choose(page, 8, 4);
  await expect(page.locator("#inspector-content")).toContainText("贴片电阻");
  const from = await point(page, 8, 4), to = await point(page, 10, 6);
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up();
  await page.locator("#board").focus(); await page.keyboard.press("r");
  p = await saved(page); expect(p.objects[1]).toMatchObject({ x: 10, y: 6, rotation: 90 });
  expect(p.objects[1].pins[0].net).toBe("N1");
  await page.screenshot({ path: testInfo.outputPath("front-smd-edit.png") });
  await page.locator('[data-view="back"]').click(); await choose(page, 10, 6, "back");
  await expect(page.locator("#inspector-content")).toContainText("K7 ↔ K8");
  await page.locator("#board").focus(); await page.keyboard.press("ArrowRight");
  expect((await saved(page)).objects[1].x).toBe(9); // back-face motion uses mirrored board coordinates
  await page.keyboard.press("Control+z");
  expect((await saved(page)).objects[1].x).toBe(10);
  await page.reload(); await choose(page, 10, 6);
  await expect(page.locator("#inspector-content")).toContainText("贴片电阻");
  expect((await saved(page)).objects).toEqual(p.objects);
});

test("逻辑引脚高亮与点击范围在放大、缩小时一致，空焊盘不显示可选高亮", async ({ page }) => {
  await load(page, [component("A", 8, 7), component("B", 11, 7)]);
  for (const steps of [0, 4, -8]) {
    await fit(page);
    const a = await point(page, 8, 7), b = await point(page, 11, 7);
    const box = await page.locator("#board").boundingBox();
    const fitZoom = Math.max(0.15, Math.min(3, (box.width - 100) / (21 * 28), (box.height - 160) / (16 * 28)));
    const factor = 1.2 ** steps, center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const scaled = (p) => ({ x: center.x + (p.x - center.x) * factor, y: center.y + (p.y - center.y) * factor });
    for (let i = 0; i < Math.abs(steps); i++) await page.locator(`[data-action="zoom-${steps > 0 ? "in" : "out"}"]`).click();
    const { pinHitRadius } = await import("../../src/renderer.js");
    const radius = pinHitRadius({ zoom: fitZoom * factor }), aa = scaled(a), bb = scaled(b);
    await page.locator('.tools [data-tool="logic"]').click();
    // Leave a pixel margin for WebKit's integer mouse-event coordinates at small zoom levels.
    await page.mouse.move(aa.x + radius * 1.4, aa.y);
    await expect(page.locator("#hole-position")).toHaveText("—");
    await page.mouse.click(aa.x + radius * 1.4, aa.y);
    await expect(page.locator("#toast")).toContainText("请点击元件引脚");
    await page.mouse.move(aa.x + radius * 0.7, aa.y);
    await expect(page.locator("#hole-position")).toHaveText("I8");
    await page.mouse.click(aa.x + radius * 0.7, aa.y);
    await expect(page.locator("#status-hint")).toContainText("点击第二个引脚");
    await page.mouse.move(bb.x, bb.y + radius * 0.7);
    await expect(page.locator("#hole-position")).toHaveText("L8");
    await page.mouse.click(bb.x, bb.y + radius * 0.7);
    expect((await saved(page)).objects.map((o) => o.pins[0].net)).toEqual(["N1", "N1"]);
    await page.locator('[data-action="undo"]').click();
  }
});

test("逻辑线连接最近端子，实际连接后仍选取连通部分中最近的端子", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const proto = CanvasRenderingContext2D.prototype, stroke = proto.stroke, clear = proto.clearRect;
    const move = proto.moveTo, line = proto.lineTo, begin = proto.beginPath;
    proto.beginPath = function (...args) { this.logicPath = []; return begin.apply(this, args); };
    proto.moveTo = function (x, y) { this.logicPath?.push({ x, y }); return move.call(this, x, y); };
    proto.lineTo = function (x, y) { this.logicPath?.push({ x, y }); return line.call(this, x, y); };
    proto.clearRect = function (...args) { if (this.canvas.id === "board") window.logicPaths = []; return clear.apply(this, args); };
    proto.stroke = function (...args) {
      if (this.canvas.id === "board" && this.strokeStyle === "#9967bd" && this.getLineDash().length) window.logicPaths.push(this.logicPath);
      return stroke.apply(this, args);
    };
  });
  const objects = [component("A", 3, 3), component("B", 9, 3), component("C", 8, 3), component("D", 8, 6)];
  objects.forEach((o) => { o.pins[0].net = "N1"; });
  await load(page, objects);
  await page.locator('[data-panel="checks"]').click(); await page.locator("#show-logic").check();
  const paths = async () => {
    const box = await page.locator("#board").boundingBox();
    const coords = await Promise.all([[3, 3], [9, 3], [8, 3], [8, 6]].map(([x, y]) => point(page, x, y)));
    return page.evaluate(({ coords, box }) => window.logicPaths.map((path) => path.map((p) =>
      coords.findIndex((q) => Math.hypot(p.x + box.x - q.x, p.y + box.y - q.y) < 0.1)).sort().join("/")).sort(), { coords, box });
  };
  await expect.poll(paths).toEqual(["0/2", "1/2", "2/3"]);
  await drawSolder(page, [[3, 3], [8, 3]]);
  await expect.poll(paths).toEqual(["1/2", "2/3"]);
  await page.screenshot({ path: testInfo.outputPath("nearest-logic.png") });
});

test("贴片与插件引脚直连焊盘没有悬空警告，移动断开后恢复警告", async ({ page }) => {
  const a = component("A", 3, 3), b = component("B", 4, 3);
  const r = component("R", 3, 3, 2, { mounting: "smd", kind: "resistor" });
  a.pins[0].net = r.pins[0].net = "Left"; b.pins[0].net = r.pins[1].net = "Right";
  await load(page, [a, b, r]);
  await page.locator('[data-panel="checks"]').click();
  await expect(page.locator("#connection-status")).toContainText("全部通过");
  await expect(page.locator("#check-issues")).toBeEmpty();
  await page.locator('[data-view="back"]').click(); await choose(page, 3, 3, "back");
  await page.locator("#board").focus(); await page.keyboard.press("ArrowDown");
  await page.locator('[data-panel="checks"]').click();
  await expect(page.locator("#check-issues")).toContainText("漏接");
  await expect(page.locator("#check-issues")).toContainText("R 第 1 脚没有实际连线");
  await page.locator('[data-action="undo"]').click();
  await expect(page.locator("#check-issues")).toBeEmpty();
});
