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

test("新元件占孔被阻止，放置豁免可解除限制且旧冲突可报告", async ({ page }) => {
  await load(page, [component("A", 3, 3)]);
  await page.locator('.tools [data-tool="component"]').click();
  await page.locator('[data-library="header-2"]').click();
  await click(page, 3, 3);
  await expect(page.locator("#toast")).toContainText("插孔冲突");
  expect((await saved(page)).objects).toHaveLength(1);
  await page.locator("#placement-ignore").check();
  await click(page, 3, 3);
  expect((await saved(page)).objects[1].ignoreCollision).toBe(true);
  await page.locator("#ignore-collision").uncheck();
  await page.locator('[data-panel="checks"]').click();
  await expect(page.locator("#check-issues")).toContainText("D4 插孔冲突");
  await expect(page.locator("#connection-status")).toContainText("未开启");
  await page.locator("[data-check-issue]").click();
  await expect(page.locator("#inspector-content")).toContainText("已选 2 个对象");
});

test("旋转、键盘、属性、拖动及复制统一阻止新增占孔冲突", async ({ page }) => {
  await load(page, [component("A", 3, 3, 2), component("B", 3, 4), component("C", 4, 4)]);
  await choose(page, 3, 3);
  await page.keyboard.press("r");
  await expect(page.locator("#toast")).toContainText("插孔冲突");
  expect((await saved(page)).objects[0].rotation).toBe(0);
  await page.keyboard.press("ArrowDown");
  expect((await saved(page)).objects[0].y).toBe(3);
  await page.locator("#object-y").fill("5"); await page.locator("#object-y").press("Tab");
  expect((await saved(page)).objects[0].y).toBe(3);
  await page.locator("#board").focus();
  await page.keyboard.press("Control+c"); await page.keyboard.press("Control+v");
  expect((await saved(page)).objects).toHaveLength(3);
  const a = await point(page, 3, 3), b = await point(page, 3, 4);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
  expect((await saved(page)).objects[0].y).toBe(3);
  await expect(page.locator("#toast")).toContainText("本次移动已取消");
  await page.locator("#ignore-collision").check();
  await page.locator("#board").focus(); await page.keyboard.press("ArrowDown");
  expect((await saved(page)).objects[0].y).toBe(4);
});

test("跳线端点不能与引脚共孔，特殊跳线可豁免", async ({ page }) => {
  await load(page, [component("A", 3, 3)]);
  await page.locator('[data-panel="checks"]').click();
  await page.locator('.tools [data-tool="wire"]').click();
  await click(page, 3, 3); await click(page, 8, 6);
  await expect(page.locator("#toast")).toContainText("插孔冲突");
  expect((await saved(page)).objects).toHaveLength(1);
  await page.locator("#placement-ignore").check();
  await click(page, 8, 6);
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

test("直连跳线被拒绝后可重新选择终点，项目仍满足直连格式", async ({ page }) => {
  await load(page, [component("A", 8, 6)]);
  await page.locator('.tools [data-tool="wire"]').click();
  await click(page, 3, 3); await click(page, 8, 6);
  await expect(page.locator("#toast")).toContainText("插孔冲突");
  await click(page, 9, 6);
  const p = await saved(page);
  expect(p.objects[1].points).toEqual([{ x: 3, y: 3 }, { x: 9, y: 6 }]);
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
    return { editor: render(false), png: render(true), viewer: render(false, true) };
  });
  expect(counts.editor).toMatchObject({ logic: 3, highlight: 1, shell: 1 });
  expect(counts.png).toMatchObject({ logic: 0, highlight: 0, shell: 1 });
  expect(counts.viewer).toMatchObject({ logic: 0, highlight: 0, shell: 1 });
});
