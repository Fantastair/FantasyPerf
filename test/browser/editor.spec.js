import { test, expect } from "@playwright/test";
const store = "fantasyperf.project.v1";
async function saved(page) {
  await expect(page.locator("#save-status")).toContainText("已自动保存");
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), store);
}
async function hole(
  page,
  x,
  y,
  face = "front",
  cols = 20,
  rows = 15,
  split = false,
) {
  const box = await page.locator("#board").boundingBox();
  const readOnly =
    (await page.locator("html").getAttribute("data-readonly")) === "true";
  const w = box.width / (split && !readOnly ? 2 : 1),
    h = (box.height - (readOnly ? 96 : 0)) / (split && readOnly ? 2 : 1),
    zoom = Math.max(
      0.15,
      Math.min(
        3,
        (w - (readOnly ? 56 : 100)) / ((cols + 1) * 28),
        (h - (readOnly ? 100 : 160)) / ((rows + 1) * 28),
      ),
    );
  return {
    x:
      box.x +
      w / 2 -
      ((cols - 1) * 28 * zoom) / 2 +
      (face === "back" ? cols - 1 - x : x) * 28 * zoom +
      (split && !readOnly && face === "back" ? w : 0),
    y:
      box.y +
      (split && readOnly && face === "back" ? h : 0) +
      h / 2 -
      ((rows - 1) * 28 * zoom) / 2 +
      y * 28 * zoom,
  };
}
async function clickHole(page, x, y, face = "front", cols = 20, rows = 15) {
  const p = await hole(page, x, y, face, cols, rows);
  await page.mouse.click(p.x, p.y);
}
async function newBoard(page) {
  await page.goto("/");
  await page.locator('[data-action="new"]').click();
  await page.locator("#new-cols").fill("20");
  await page.locator("#new-rows").fill("15");
  await page.locator("#new-name").fill("验收项目");
  await page.locator("#create-project").click();
}
async function addComponent(page, name, x, y, kind = "double", count = "8") {
  await page.locator('.tools [data-tool="component"]').click();
  await page.locator("#library-custom").click();
  await page.locator("#component-name").fill(name);
  await page.locator("#pin-kind").selectOption(kind);
  await page.locator("#pin-count").fill(count);
  await page.locator("#pin-count").press("Tab");
  await page.locator("#place-component").click();
  await clickHole(page, x, y);
}
async function dragBetween(page, start, end) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
}

test("名称与引脚标注按半格吸附，支持撤销、取消、编辑和文件复用", async ({ page }) => {
  const { readFile } = await import("node:fs/promises");
  await newBoard(page);
  await addComponent(page, "U1", 7, 4);
  await page.locator('[data-pin="0"]').fill("VCC");
  await page.locator('[data-pin="0"]').press("Tab");
  const original = (await saved(page)).objects[0];
  // Clicking a label alone must not snap or move it.
  await clickHole(page, 7, 4);
  expect((await saved(page)).objects[0]).toEqual(original);
  await dragBetween(page, await hole(page, 7, 4), await hole(page, 5.6, 2.9));
  const movedPin = (await saved(page)).objects[0];
  expect(movedPin.pins[0]).toMatchObject({ labelDx: -1.5, labelDy: -1 });
  expect(movedPin).toMatchObject({ x: 7, y: 4, rotation: 0 });
  // A name can be grabbed directly even when its component is unselected.
  await clickHole(page, 17, 11);
  await dragBetween(page, await hole(page, 8.5, 5.5), await hole(page, 10.1, 1.9));
  const movedName = (await saved(page)).objects[0];
  expect(movedName).toMatchObject({ x: 7, y: 4, nameDx: 1.5, nameDy: -2 });
  expect(movedName.pins).toEqual(movedPin.pins);
  await page.locator('[data-action="undo"]').click();
  expect((await saved(page)).objects[0]).toEqual(movedPin);
  await page.locator('[data-action="redo"]').click();
  expect((await saved(page)).objects[0]).toEqual(movedName);

  await clickHole(page, 7, 5);
  const start = await hole(page, 10, 2), end = await hole(page, 12, 1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect((await saved(page)).objects[0]).toEqual(movedName);
  await clickHole(page, 7, 5);
  await page.locator('[data-action="edit-component"]').click();
  await page.locator("#component-name").fill("测试芯片");
  await page.locator("#place-component").click();
  let current = (await saved(page)).objects[0];
  expect(current).toMatchObject({ name: "测试芯片", nameDx: 1.5, nameDy: -2 });
  await page.locator('[data-action="rotate"]').click();
  current = (await saved(page)).objects[0];
  expect(current).toMatchObject({ rotation: 90, nameDx: 1.5, nameDy: -2 });
  await page.screenshot({ path: "artifacts/annotation-positions.png" });

  const pending = page.waitForEvent("download");
  await page.locator('[data-action="export-component"]').click();
  const buffer = await readFile(await (await pending).path());
  expect(JSON.parse(buffer).components[0]).toMatchObject({ nameDx: 1.5, nameDy: -2 });
  await page.reload();
  expect((await saved(page)).objects[0]).toEqual(current);
  await page.locator("#component-file-input").setInputFiles({
    name: "位置.json", mimeType: "application/json", buffer,
  });
  await page.locator('[data-imported="0"]').click();
  await clickHole(page, 13, 7);
  expect((await saved(page)).objects[1]).toMatchObject({
    name: "测试芯片", x: 13, y: 7, nameDx: 1.5, nameDy: -2, pins: movedPin.pins,
  });
});

test("贴片名称在镜像和并排视图中拖动吸附，不改变焊盘", async ({ page }) => {
  await newBoard(page);
  await page.locator('.tools [data-tool="component"]').click();
  await page.locator('[data-library="smd-resistor"]').click();
  await clickHole(page, 4.5, 4, "back");
  const original = (await saved(page)).objects[0];
  await dragBetween(page,
    await hole(page, 4.5, 4, "back"), await hole(page, 2.8, 2.2, "back"));
  const moved = (await saved(page)).objects[0];
  expect(moved).toMatchObject({ x: 4, y: 4, nameDx: -1.5, nameDy: -2 });
  expect(moved.pins).toEqual(original.pins);
  await page.locator('[data-view="split"]').click();
  await dragBetween(page,
    await hole(page, 3, 2, "back", 20, 15, true),
    await hole(page, 2.3, 1.4, "back", 20, 15, true));
  expect((await saved(page)).objects[0]).toMatchObject({
    x: 4, y: 4, nameDx: -2, nameDy: -2.5, pins: original.pins,
  });
  await page.locator('[data-action="edit-component"]').click();
  await page.locator("#smd-name").fill("10 kΩ");
  await page.locator("#place-smd").click();
  expect((await saved(page)).objects[0]).toMatchObject({ name: "10 kΩ", nameDx: -2, nameDy: -2.5 });
});

test("标注连线只在选中时显示，包含默认位置且不进入导出或淡显面", async ({ page }) => {
  await newBoard(page);
  await page.locator("#theme-mode").selectOption("light");
  const counts = await page.evaluate(async () => {
    const { newProject } = await import("/src/core.js");
    const { drawScene } = await import("/src/renderer.js");
    const project = newProject(10, 10);
    project.objects = [{
      id: "labels", type: "component", name: "U1", x: 4, y: 4, rotation: 0,
      pins: [
        { x: 0, y: 0, label: "默认" },
        { x: 1, y: 0, label: "移动", labelDx: 2, labelDy: -2 },
        { x: 2, y: 0, label: "" },
      ],
    }];
    const state = {
      view: "front", camera: { zoom: 1, panX: 0, panY: 0 },
      selected: new Set(["labels"]), showLabels: true, showGhost: true,
    };
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    let count = 0;
    const stroke = ctx.stroke.bind(ctx);
    ctx.stroke = (...args) => {
      if (ctx.strokeStyle === "#8fa9a1" && Math.abs(ctx.lineWidth - 0.7) < 1e-6) count++;
      stroke(...args);
    };
    const render = (overrides = {}, exporting = false) => {
      count = 0;
      drawScene(canvas, project, { ...state, ...overrides }, { width: 600, height: 600, exporting });
      return count;
    };
    return {
      selected: render(), unselected: render({ selected: new Set() }),
      export: render({}, true), ghost: render({ view: "back" }),
      labelsHidden: render({ showLabels: false }),
    };
  });
  expect(counts).toEqual({ selected: 3, unselected: 0, export: 0, ghost: 0, labelsHidden: 1 });
});

test("参考图临时隐藏可从画布和属性恢复，不保存或占用撤销，刷新恢复", async ({ page }) => {
  const { readFile } = await import("node:fs/promises");
  await newBoard(page);
  await page.locator('.tools [data-action="demo"]').click();
  await page.locator("#create-project").click();
  const baseline = await saved(page);
  await page.locator('.tools [data-tool="wire"]').click();
  await page.locator(".reference-image").click({ button: "right" });
  await expect(page.locator('.tools [data-tool="select"]')).toHaveClass(/active/);
  await page.getByRole("button", { name: "临时隐藏参考图", exact: true }).click();
  await expect(page.locator(".reference-image")).toBeHidden();
  await expect(page.locator(".reference-restore")).toBeVisible();
  await page.locator('[data-view="back"]').click();
  await page.locator('.tools [data-action="fit"]').click();
  await expect(page.locator(".reference-image")).toBeHidden();
  expect(await saved(page)).toEqual(baseline);
  await page.locator(".reference-restore").click();
  await expect(page.locator(".reference-image")).toBeVisible();
  await page.locator('[data-action="reference"]').click();
  await page.locator("#reference-temporary-visibility").click();
  await expect(page.locator(".reference-image")).toBeHidden();
  await expect(page.locator("#reference-visible")).toBeChecked();
  await expect(page.locator("#reference-temporary-visibility")).toHaveText("恢复显示参考图");
  await page.locator("#reference-temporary-visibility").click();
  await expect(page.locator(".reference-image")).toBeVisible();
  await page.locator("#reference-temporary-visibility").click();

  await page.locator('[data-action="export"]').click();
  const pending = page.waitForEvent("download");
  await page.locator('[data-export="project"]').click();
  const exported = JSON.parse(await readFile(await (await pending).path(), "utf8"));
  expect(exported.reference).toEqual(baseline.reference);
  await page.locator("[data-close]").click();
  await page.locator('[data-action="undo"]').click();
  expect((await saved(page)).reference).toBeNull();
  await expect(page.locator(".reference-restore")).toBeHidden();
  await page.locator('[data-action="redo"]').click();
  await expect(page.locator(".reference-image")).toBeVisible();
  await page.getByRole("button", { name: "临时隐藏参考图", exact: true }).first().click();
  await page.reload();
  await expect(page.locator(".reference-image")).toBeVisible();
  expect((await saved(page)).reference).toEqual(baseline.reference);
  await page.locator('[data-action="reference"]').click();
  await page.locator("#reference-visible").uncheck();
  await saved(page);
  await expect(page.locator(".reference-restore")).toBeHidden();
  await page.reload();
  await expect(page.locator(".reference-image")).toBeHidden();
});

test("右键退出元件预览、锡线和两种跳线工具，仅取消未完成操作", async ({ page }) => {
  await newBoard(page);
  await addComponent(page, "保留元件", 7, 4);
  const baseline = await saved(page), p = await hole(page, 12, 8);
  const exit = async () => {
    await page.mouse.click(p.x, p.y, { button: "right" });
    await expect(page.locator('.tools [data-tool="select"]')).toHaveClass(/active/);
    expect(await saved(page)).toEqual(baseline);
    await clickHole(page, 12, 8);
    expect(await saved(page)).toEqual(baseline);
  };
  await page.locator('.tools [data-tool="component"]').click();
  await page.locator('[data-library="ne555"]').click();
  await page.mouse.move(p.x, p.y);
  await exit();
  for (const [tool, mode] of [["solder", null], ["wire", "direct"], ["wire", "orthogonal"]]) {
    await page.locator(`.tools [data-tool="${tool}"]`).click();
    if (mode) await page.locator("#wire-mode").selectOption(mode);
    await clickHole(page, 9, 7);
    if (mode !== "direct") await clickHole(page, 11, 9);
    await page.mouse.move(p.x, p.y);
    await exit();
  }
  // Cancelled drafts create no history entries.
  await page.locator('[data-action="undo"]').click();
  expect((await saved(page)).objects).toHaveLength(0);
  await page.locator('[data-action="redo"]').click();
  expect(await saved(page)).toEqual(baseline);
  await page.locator('.tools [data-tool="wire"]').click();
  await page.locator("#wire-mode").selectOption("direct");
  await clickHole(page, 9, 7);
  await clickHole(page, 12, 8);
  const completed = await saved(page);
  expect(completed.objects).toHaveLength(2);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await expect(page.locator('.tools [data-tool="select"]')).toHaveClass(/active/);
  expect(await saved(page)).toEqual(completed);
});
test("已验证的 555 示例保留完整设计，两个清单入口均不导出锡线", async ({
  page,
}) => {
  const { demoProject } = await import("../../src/core.js");
  const { readFile } = await import("node:fs/promises");
  const example = demoProject(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator('.tools [data-action="demo"]').click();
  await expect(page.locator("#modal .info-box")).toContainText("10 × 8 孔");
  await page.locator("#create-project").click();
  expect(await saved(page)).toEqual(example);
  await expect(page.locator("#project-name")).toHaveValue(example.name);
  await expect(page.locator("#summary")).toContainText("10 × 8 孔");
  await expect(page.locator(".reference-image")).toBeVisible();
  await expect
    .poll(() =>
      page.locator(".reference-image img").evaluate((image) => image.naturalWidth),
    )
    .toBe(example.reference.naturalWidth);
  const downloadCSV = async (selector) => {
    const pending = page.waitForEvent("download");
    await page.locator(selector).click();
    const download = await pending;
    return readFile(await download.path(), "utf8");
  };
  await page.locator('[data-action="export"]').click();
  await expect(page.locator('[data-export="csv"]')).not.toContainText("锡线");
  const csv = await downloadCSV('[data-export="csv"]');
  expect(csv.startsWith("\uFEFF")).toBe(true);
  expect(csv.split("\r\n")).toHaveLength(12); // 表头 + 9 个元件 + 2 根跳线
  expect(csv).not.toContain('"锡线"');
  for (const object of example.objects.filter((o) => o.type !== "solder"))
    expect(csv).toContain('"' + object.name + '"');
  const pendingProject = page.waitForEvent("download");
  await page.locator('[data-export="project"]').click();
  const exported = JSON.parse(
    await readFile(await (await pendingProject).path(), "utf8"),
  );
  expect(exported.objects).toEqual(example.objects);
  expect(exported.board).toEqual(example.board);
  expect(exported.reference).toEqual(example.reference);
  await page.locator("[data-close]").click();
  await page.locator('[data-panel="wires"]').click();
  expect(await downloadCSV('[data-action="csv"]')).toBe(csv);
  await page.screenshot({ path: "artifacts/555-example.png" });
  expect(errors).toEqual([]);
});
test("完整验收：元件、标注、布线、镜像、编辑、撤销、保存、导出", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await newBoard(page);
  await addComponent(page, "U1", 7, 4);
  await addComponent(page, "J1", 2, 3, "single", "2");
  await addComponent(page, "J2", 14, 10, "single", "3");
  let p = await saved(page);
  expect(p.objects.filter((o) => o.type === "component")).toHaveLength(3);
  expect(p.objects[0].pins).toHaveLength(8);
  await page.locator('[data-view="back"]').click();
  await page.locator('.tools [data-tool="solder"]').click();
  await clickHole(page, 2, 3, "back");
  await clickHole(page, 7, 4, "back");
  await page.keyboard.press("Enter");
  await page.locator('[data-view="back"]').click();
  await page.locator('.tools [data-tool="solder"]').click();
  await clickHole(page, 3, 3, "back");
  await clickHole(page, 7, 7, "back");
  await page.keyboard.press("Enter");
  await page.locator('.tools [data-tool="wire"]').click();
  // This legacy acceptance intentionally shares holes with component pins.
  await page.locator("#placement-ignore").check();
  await clickHole(page, 10, 5);
  await clickHole(page, 14, 10);
  await page.locator('.tools [data-tool="wire"]').click();
  await page.locator("#wire-mode").selectOption("orthogonal");
  await clickHole(page, 10, 6);
  await clickHole(page, 12, 10);
  await clickHole(page, 15, 10);
  await page.keyboard.press("Enter");
  p = await saved(page);
  expect(p.objects).toHaveLength(7);
  expect(p.objects.at(-1).points).toEqual([
    { x: 10, y: 6 },
    { x: 12, y: 6 },
    { x: 12, y: 10 },
    { x: 15, y: 10 },
  ]);
  await page.locator("#allow-start").fill("5");
  await page.locator("#allow-start").press("Tab");
  await expect(page.locator(".metric strong")).toHaveText("30.9");
  await page.locator('.tools [data-tool="select"]').click();
  await clickHole(page, 12, 8);
  const from = await hole(page, 12, 10),
    to = await hole(page, 13, 11);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  p = await saved(page);
  const wire = p.objects.at(-1);
  expect(wire.points[1]).toEqual({ x: 13, y: 6 });
  expect(wire.points[2]).toEqual({ x: 13, y: 11 });
  expect(wire.points[3]).toEqual({ x: 15, y: 11 });
  await page.locator('[data-action="undo"]').click();
  p = await saved(page);
  expect(p.objects.at(-1).points[2]).toEqual({ x: 12, y: 10 });
  await page.locator('[data-action="redo"]').click();
  await page.locator('[data-view="back"]').click();
  const a1 = await hole(page, 0, 0, "back");
  await page.mouse.move(a1.x, a1.y);
  await expect(page.locator("#hole-position")).toHaveText("A1");
  await page.locator('[data-view="split"]').click();
  await page.screenshot({ path: "artifacts/editor-split.png" });
  await page.locator('[data-action="export"]').click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator('[data-export="project"]').click();
  const download = await downloadPromise;
  await download.saveAs("artifacts/acceptance.fantasyperf.json");
  const pngPromise = page.waitForEvent("download");
  await page.locator('[data-export="split"]').click();
  await (await pngPromise).saveAs("artifacts/acceptance.png");
  const csvPromise = page.waitForEvent("download");
  await page.locator('[data-export="csv"]').click();
  await (await csvPromise).saveAs("artifacts/acceptance.csv");
  await page.locator("[data-close]").click();
  const snapshot = await saved(page);
  await page.reload();
  p = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    store,
  );
  expect(p).toEqual(snapshot);
  await expect(page.locator("#project-name")).toHaveValue("验收项目");
  await page
    .locator("#file-input")
    .setInputFiles("artifacts/acceptance.fantasyperf.json");
  await page.locator("#confirm-import").click();
  p = await saved(page);
  // 导出文件比自动存档多一个导出时间戳，其余数据必须完全一致。
  expect(Number.isNaN(Date.parse(p.meta.savedAt))).toBe(false);
  expect({ ...p, meta: null }).toEqual({ ...snapshot, meta: null });
  expect(errors).toEqual([]);
});
test("元件文件复用、引脚标注拖动、独立移动与保护板尺寸", async ({ page }) => {
  await newBoard(page);
  await addComponent(page, "U1", 7, 4);
  await page.locator('[data-pin="0"]').fill("VCC");
  await page.locator('[data-pin="0"]').press("Tab");
  const pending = page.waitForEvent("download");
  await page.locator('[data-action="export-component"]').click();
  const componentPath = await (await pending).path();
  const start = await hole(page, 7, 4),
    left = await hole(page, 6, 4);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 60, start.y - 35, { steps: 6 });
  await page.mouse.up();
  let p = await saved(page);
  expect(p.objects[0].pins[0].label).toBe("VCC");
  expect(p.objects[0].pins[0].labelDy).toBeLessThan(-0.5);
  await page.locator('[data-action="rotate"]').click();
  p = await saved(page);
  expect(p.objects[0].rotation).toBe(90);
  await page.locator('[data-action="duplicate"]').click();
  p = await saved(page);
  expect(p.objects).toHaveLength(2);
  await page.locator('[data-action="delete"]').click();
  p = await saved(page);
  expect(p.objects).toHaveLength(1);
  await page.locator('.tools [data-tool="select"]').click();
  await page.locator("#cols").fill("4");
  await page.locator("#cols").press("Tab");
  await expect(page.locator("#cols")).toHaveValue("20");
  await page.locator("#component-file-input").setInputFiles(componentPath);
  await page.locator('[data-imported="0"]').click();
  await clickHole(page, 13, 4);
  p = await saved(page);
  expect(p.objects).toHaveLength(2);
  expect(p.objects[1].pins[0].label).toBe("VCC");
});
test("取消绘制不落盘，自定义元件可建立并重开", async ({ page }) => {
  await newBoard(page);
  await page.locator('[data-view="back"]').click();
  await page.locator('.tools [data-tool="solder"]').click();
  await clickHole(page, 1, 1, "back");
  await clickHole(page, 4, 4, "back");
  await page.keyboard.press("Escape");
  let p = await saved(page);
  expect(p.objects).toHaveLength(0);
  await page.locator('.tools [data-tool="component"]').click();
  await page.locator("#library-custom").click();
  await page.locator("#pin-kind").selectOption("custom");
  await page.locator('[data-grid="5"]').click();
  await page.locator("#place-component").click();
  await clickHole(page, 2, 2);
  p = await saved(page);
  expect(p.objects[0].pins).toHaveLength(9);
  await page.reload();
  await page.screenshot({ path: "artifacts/custom-component.png" });
});

test("并排框选能跨面整体移动，元件单独移动时线路不变", async ({ page }) => {
  const { demoProject } = await import("../../src/core.js");
  const example = demoProject();
  // 示例占满板边，验收时留出整体移动空间，参考图不遮挡框选。
  Object.assign(example.board, { cols: 12, rows: 10 });
  example.reference = null;
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({
    name: "group-move.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(example)),
  });
  await page.locator("#confirm-import").click();
  const original = await saved(page);
  await page.locator('[data-view="split"]').click();
  const box = await page.locator("#board").boundingBox();
  await page.mouse.move(box.x + 5, box.y + 75);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 5, box.y + box.height - 60, {
    steps: 10,
  });
  await page.mouse.up();
  await expect(page.locator("#selection-hint")).toContainText(
    "已选 " + original.objects.length + " 个对象",
  );
  await page.keyboard.press("ArrowRight");
  let moved = await saved(page);
  expect(moved.objects[0].x).toBe(original.objects[0].x + 1);
  expect(moved.objects.find((o) => o.type === "solder").points[0].x).toBe(
    original.objects.find((o) => o.type === "solder").points[0].x + 1,
  );
  await page.locator('[data-action="undo"]').click();
  await page.locator('[data-view="front"]').click();
  await clickHole(page, 4, 3, "front", 12, 10);
  // Moving this chip alone would collide with W1/R1; explicitly use the special-installation exemption.
  await page.locator("#ignore-collision").check();
  await page.locator("#board").focus();
  await page.keyboard.press("ArrowRight");
  moved = await saved(page);
  expect(moved.objects[0].x).toBe(original.objects[0].x + 1);
  expect(moved.objects.filter((o) => o.type !== "component")).toEqual(
    original.objects.filter((o) => o.type !== "component"),
  );
});

test("参考图导入、拖动、缩放、隐藏、撤销和项目往返", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await newBoard(page);
  const image = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 400;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 640, 400);
    ctx.fillStyle = "#234";
    ctx.font = "24px sans-serif";
    ctx.fillText("Schematic reference · U1 / VCC / GND", 30, 50);
    ctx.strokeStyle = "#345";
    ctx.lineWidth = 3;
    ctx.strokeRect(220, 110, 180, 170);
    ctx.beginPath();
    ctx.moveTo(60, 150);
    ctx.lineTo(220, 150);
    ctx.moveTo(400, 240);
    ctx.lineTo(570, 240);
    ctx.stroke();
    ctx.font = "20px sans-serif";
    ctx.fillText("VCC", 65, 135);
    ctx.fillText("U1", 290, 200);
    ctx.fillText("GND", 480, 270);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#reference-file-input").setInputFiles({
    name: "schematic.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  });
  await expect(page.locator(".reference-image")).toBeVisible();
  let p = await saved(page);
  expect(p.reference.name).toBe("schematic.png");
  expect(p.reference.naturalWidth).toBe(640);
  const box = await page.locator(".reference-image").boundingBox();
  await page.mouse.move(box.x + 60, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + 210, box.y + 150, { steps: 5 });
  await page.mouse.up();
  p = await saved(page);
  expect(p.reference.x).toBe(174);
  expect(p.reference.y).toBe(176);
  await page.locator('[data-action="undo"]').click();
  p = await saved(page);
  expect(p.reference.x).toBe(24);
  await page.locator('[data-action="redo"]').click();
  await saved(page);
  await page.locator("#reference-width").fill("500");
  await page.locator("#reference-width").dispatchEvent("change");
  await page.locator("#reference-opacity").fill("65");
  await page.locator("#reference-opacity").dispatchEvent("change");
  p = await saved(page);
  expect(p.reference.width).toBe(500);
  expect(p.reference.opacity).toBe(0.65);
  await expect(page.locator(".reference-image")).toHaveCSS("opacity", "0.65");
  await page.locator("#reference-visible").uncheck();
  await expect(page.locator(".reference-image")).toBeHidden();
  await page.locator("#reference-visible").check();
  await saved(page);
  await page.locator('[data-view="back"]').click();
  await expect(page.locator(".reference-image")).toBeVisible();
  await expect(page.locator(".reference-image")).toHaveCSS("transform", "none");
  await page.reload();
  await expect(page.locator(".reference-image")).toBeVisible();
  await page.locator('[data-action="reference"]').click();
  await expect(page.locator("#reference-width")).toHaveValue("500");
  await page.screenshot({ path: "artifacts/reference-image.png" });
  await page.locator('[data-action="export"]').click();
  const promise = page.waitForEvent("download");
  await page.locator('[data-export="project"]').click();
  await (await promise).saveAs("artifacts/reference.fantasyperf.json");
  await page.locator("[data-close]").click();
  await page.locator("#remove-reference").click();
  await expect(page.locator(".reference-image")).toBeHidden();
  await saved(page);
  await page
    .locator("#file-input")
    .setInputFiles("artifacts/reference.fantasyperf.json");
  await page.locator("#confirm-import").click();
  await expect(page.locator(".reference-image")).toBeVisible();
  p = await saved(page);
  expect(p.reference.name).toBe("schematic.png");
  expect(p.reference.opacity).toBe(0.65);
  await expect(page.locator(".reference-image")).toHaveCSS("opacity", "0.65");
  await page.locator("#reference-file-input").setInputFiles({
    name: "invalid.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.locator("#toast")).toContainText("无法导入图片");
  expect((await saved(page)).reference).toEqual(p.reference);
  expect(errors).toEqual([]);
});

test("编辑靠后的引脚保留滚动位置并可连续 Tab 或点击编辑", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 760 });
  await newBoard(page);
  await addComponent(page, "U24", 7, 1, "double", "24");
  const pin = page.locator('[data-pin="18"]');
  await pin.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await pin.fill("DATA18");
  const scroll = () =>
    page.evaluate(() => ({
      list: document.querySelector(".pin-list").scrollTop,
      panel: document.querySelector("#inspector-content").scrollTop,
    }));
  const before = await scroll();
  expect(before.list).toBeGreaterThan(0);
  expect(before.panel).toBeGreaterThan(0);
  await pin.press("Tab");
  await expect(page.locator('[data-pin="19"]')).toBeFocused();
  expect(await scroll()).toEqual(before);
  await page.locator('[data-pin="19"]').fill("DATA19");
  await page.locator('[data-pin="20"]').click();
  await expect(page.locator('[data-pin="20"]')).toBeFocused();
  expect(await scroll()).toEqual(before);
  let p = await saved(page);
  expect(p.objects[0].pins[18].label).toBe("DATA18");
  expect(p.objects[0].pins[19].label).toBe("DATA19");
  await page.locator('[data-action="undo"]').click();
  p = await saved(page);
  expect(p.objects[0].pins[19].label).toBe("");
  expect(p.objects[0].pins[18].label).toBe("DATA18");
  await page.locator('[data-action="redo"]').click();
  p = await saved(page);
  expect(p.objects[0].pins[19].label).toBe("DATA19");
});

test("深浅色切换、跟随系统、刷新恢复及浅色图片导出", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("#theme-mode")).toHaveValue("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const corner = () =>
    page
      .locator("#board")
      .evaluate((c) =>
        Array.from(c.getContext("2d").getImageData(0, 0, 1, 1).data).slice(
          0,
          3,
        ),
      );
  await expect.poll(corner).toEqual([21, 29, 36]);
  await page.locator('.tools [data-action="demo"]').click();
  await page.locator("#create-project").click();
  const original = await saved(page);
  await page.locator("#theme-mode").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(corner).toEqual([243, 246, 247]);
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator("#theme-mode").selectOption("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("#theme-mode")).toHaveValue("dark");
  await expect.poll(corner).toEqual([21, 29, 36]);
  await page.locator('[data-view="split"]').click();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.screenshot({ path: "artifacts/theme-dark.png" });
  await page.locator('[data-action="help"]').click();
  await page.screenshot({ path: "artifacts/theme-dark-dialog.png" });
  await page.locator("[data-close]").first().click();
  await page.locator('[data-action="export"]').click();
  const promise = page.waitForEvent("download");
  await page.locator('[data-export="back"]').click();
  const download = await promise;
  const { readFile } = await import("node:fs/promises");
  const data = (await readFile(await download.path())).toString("base64");
  const exportedCorner = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = "data:image/png;base64," + data;
    await image.decode();
    const c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(image, 0, 0);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
  }, data);
  expect(exportedCorner).toEqual([243, 246, 247]);
  await page.locator("[data-close]").click();
  await page.locator("#theme-mode").selectOption("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(corner).toEqual([21, 29, 36]);
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(corner).toEqual([243, 246, 247]);
  expect(await saved(page)).toEqual(original);
  expect(errors).toEqual([]);
});

test("贴片电阻电容在焊盘间放置、旋转、复制并完整恢复", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await newBoard(page);
  await page.locator('[data-action="smd"]').click();
  await expect(page.locator("#modal")).toContainText("0603 / 0805");
  await page.locator("#smd-name").fill("R1 · 10k");
  await page.locator("#place-smd").click();
  await expect(page.locator('[data-view="back"]')).toHaveClass("active");
  await clickHole(page, 4.5, 4, "back");
  let p = await saved(page);
  expect(p.objects[0]).toMatchObject({
    type: "component",
    mounting: "smd",
    kind: "resistor",
    x: 4,
    y: 4,
    rotation: 0,
  });
  await expect(page.locator("#inspector-content")).toContainText("E5 ↔ F5");
  await page.locator('[data-action="rotate"]').click();
  p = await saved(page);
  expect(p.objects[0].rotation).toBe(90);
  await expect(page.locator("#inspector-content")).toContainText("E5 ↔ E6");
  // The name now occupies the body center; drag the physical object from its pad.
  const from = await hole(page, 4, 4, "back"),
    to = await hole(page, 6, 6, "back");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  p = await saved(page);
  expect(p.objects[0]).toMatchObject({ x: 6, y: 6 });
  await page.locator('[data-action="smd"]').click();
  await page.locator("#smd-kind").selectOption("capacitor");
  await expect(page.locator("#smd-name")).toHaveValue("C1");
  await page.locator("#place-smd").click();
  await page.keyboard.press("r");
  await clickHole(page, 10, 8.5, "back");
  p = await saved(page);
  expect(p.objects[1]).toMatchObject({
    kind: "capacitor",
    x: 10,
    y: 8,
    rotation: 90,
  });
  await page.locator('[data-action="duplicate"]').click();
  p = await saved(page);
  expect(p.objects[2]).toMatchObject({
    name: "C1",
    mounting: "smd",
    kind: "capacitor",
  });
  await expect(page.locator('[data-view="back"]')).toHaveClass("active");
  await page.locator('[data-action="undo"]').click();
  p = await saved(page);
  expect(p.objects).toHaveLength(2);
  await page.locator('[data-view="front"]').click();
  await clickHole(page, 6, 6.5);
  await expect(page.locator("#inspector-content")).toContainText("洞洞板");
  await page.locator('[data-view="back"]').click();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.screenshot({ path: "artifacts/smd-components.png" });
  await page.locator('[data-action="export"]').click();
  const result = page.waitForEvent("download");
  await page.locator('[data-export="project"]').click();
  await (await result).saveAs("artifacts/smd.fantasyperf.json");
  await page.locator("[data-close]").click();
  await page
    .locator("#file-input")
    .setInputFiles("artifacts/smd.fantasyperf.json");
  await page.locator("#confirm-import").click();
  expect((await saved(page)).objects).toEqual(p.objects);
  await page.reload();
  await page.locator('[data-view="back"]').click();
  await clickHole(page, 6, 6.5, "back");
  await page.locator('[data-action="edit-component"]').click();
  await expect(page.locator("#smd-kind")).toHaveValue("resistor");
  await page.locator("#smd-name").fill("R1 · 22k");
  await page.locator("#place-smd").click();
  expect((await saved(page)).objects[0].name).toBe("R1 · 22k");
  expect(errors).toEqual([]);
});

test("元件面查看时可直接绘制并编辑背面锡线，翻面保持同一条线路", async ({ page }) => {
  await newBoard(page);
  await addComponent(page, "U1", 7, 4);
  await page.locator('.tools [data-tool="solder"]').click();
  await expect(page.locator('[data-view="front"]')).toHaveClass("active");
  await clickHole(page, 2, 3);
  await clickHole(page, 7, 4);
  await page.keyboard.press("Enter");
  let p = await saved(page);
  expect(p.objects[1]).toMatchObject({
    type: "solder",
    points: [
      { x: 2, y: 3 },
      { x: 7, y: 3 },
      { x: 7, y: 4 },
    ],
  });
  await page.locator('.tools [data-tool="select"]').click();
  await clickHole(page, 4, 3);
  await expect(page.locator("#object-name")).toHaveValue("T1");
  const from = await hole(page, 2, 3),
    to = await hole(page, 2, 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  p = await saved(page);
  expect(p.objects[1].points).toEqual([
    { x: 2, y: 2 },
    { x: 7, y: 2 },
    { x: 7, y: 4 },
  ]);
  await page.locator('[data-view="back"]').click();
  await clickHole(page, 4, 2, "back");
  await expect(page.locator("#object-name")).toHaveValue("T1");
  expect((await saved(page)).objects).toEqual(p.objects);
  await page.locator('[data-view="front"]').click();
  await page.locator('.tools [data-tool="solder"]').click();
  await clickHole(page, 5, 2);
  await clickHole(page, 5, 6);
  await page.keyboard.press("Enter");
  p = await saved(page);
  expect(p.objects.filter((o) => o.type === "solder")).toHaveLength(2);
  await page.locator('[data-action="undo"]').click();
  expect(
    (await saved(page)).objects.filter((o) => o.type === "solder"),
  ).toHaveLength(1);
  await page.locator('[data-action="redo"]').click();
  await saved(page);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.screenshot({ path: "artifacts/back-solder.png" });
});

test("旧版本项目文件导入时自动升级，不兼容版本被拒绝", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const { demoProject, FORMAT_VERSION } = await import("../../src/core.js");
  const storedOf = () =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key)), store);
  const open = (name, project) =>
    page.locator("#file-input").setInputFiles({
      name,
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
  const legacy = demoProject();
  legacy.name = "旧版项目";
  legacy.version = "1.0.0";
  delete legacy.meta;
  await open("legacy.json", legacy);
  await expect(page.locator("#modal")).toContainText(
    `将自动升级为 v${FORMAT_VERSION}`,
  );
  await page.locator("#confirm-import").click();
  await expect(page.locator("#toast")).toContainText(
    `格式已从 v1.0.0 升级到 v${FORMAT_VERSION}`,
  );
  await expect(page.locator("#project-name")).toHaveValue("旧版项目");
  // 等自动保存落盘后再检查升级后的数据。
  await expect
    .poll(async () => (await storedOf())?.objects?.length)
    .toBe(legacy.objects.length);
  const stored = await storedOf();
  expect(stored.version).toBe(FORMAT_VERSION);
  expect(stored.meta).toEqual({
    app: "FantasyPerf",
    appVersion: null,
    savedAt: null,
  });
  expect(stored.objects).toEqual(legacy.objects);
  // 更高的小版本只包含修复，直接打开并归一到当前格式版本。
  const patch = demoProject();
  patch.name = "补丁项目";
  patch.version = "1.4.9";
  await open("patch.json", patch);
  await expect(page.locator("#modal")).not.toContainText("升级");
  await page.locator("#confirm-import").click();
  await expect
    .poll(async () => (await storedOf())?.name)
    .toBe("补丁项目");
  expect((await storedOf()).version).toBe(FORMAT_VERSION);
  const current = await storedOf();
  // 更高的中版本与大版本都被拒绝，当前项目不受影响。
  for (const [file, version, message] of [
    ["minor.json", "1.5.0", "高于当前工具支持"],
    ["major.json", "2.0.0", "大版本"],
  ]) {
    const future = demoProject();
    future.version = version;
    await open(file, future);
    await expect(page.locator("#toast")).toContainText(message);
  }
  expect(await storedOf()).toEqual(current);
  expect(errors).toEqual([]);
});
test("公共元件库搜索、分类、直接放置及实例独立", async ({ page }) => {
  await newBoard(page);
  await page.locator('.tools [data-tool="component"]').click();
  await page.locator("#library-search").fill("单排 4");
  await expect(page.locator("[data-library]")).toHaveCount(1);
  await page.locator('[data-library="header-4"]').click();
  await clickHole(page, 3, 3);
  let p = await saved(page);
  expect(p.objects[0]).toMatchObject({ name: "J1", type: "component" });
  expect(p.objects[0].pins).toHaveLength(4);
  await page.locator('[data-pin="0"]').fill("VCC");
  await page.locator('[data-pin="0"]').press("Tab");
  await page.locator('.tools [data-tool="component"]').click();
  await page.locator('[data-library="header-4"]').click();
  await clickHole(page, 3, 6);
  p = await saved(page);
  expect(p.objects[1].pins[0].label).toBe("");
  expect(p.objects[1].name).toBe("J2");
  await page.locator('.tools [data-tool="component"]').click();
  await page.locator("#library-category").selectOption("两焊盘 · 贴片");
  await expect(page.locator("[data-library]")).toHaveCount(2);
  await page.locator('[data-library="smd-resistor"]').click();
  await clickHole(page, 8.5, 5, "back");
  p = await saved(page);
  expect(p.objects[2]).toMatchObject({ mounting: "smd", kind: "resistor" });
});

test("手机只读打开、详情、平移缩放及编辑隔离", async ({
  browser,
  browserName,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-readonly", "true");
  await expect(page.locator(".tools")).toBeHidden();
  await expect(page.locator('[data-action="new"]')).toBeHidden();
  await expect(page.locator("#project-name")).toHaveAttribute("readonly", "");
  await page.locator('[data-action="viewer-demo"]').click();
  await expect(page.locator("#project-name")).toHaveValue(
    "基于555定时器的LED多谐振荡器",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("fantasyperf.project.v1")),
  ).toBeNull();
  const box = await page.locator("#board").boundingBox();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 155, box.y + 135, { steps: 5 });
  await page.mouse.up();
  await page.locator('[data-action="zoom-in"]').click();
  await page.locator('[data-action="fit"]').last().click();
  if (browserName === "chromium") {
    const cdp = await context.newCDPSession(page);
    const y = box.y + box.height / 2;
    const before = await page.locator("#zoom-label").textContent();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: 145, y },
        { x: 245, y },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: 95, y },
        { x: 295, y },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(page.locator("#zoom-label")).not.toHaveText(before);
    await page.locator('[data-action="fit"]').last().click();
  }
  const target = await hole(page, 4, 3, "front", 10, 8);
  await page.touchscreen.tap(target.x, target.y);
  await expect(page.locator(".inspector")).toBeVisible();
  await expect(page.locator("#inspector-content")).toContainText("NE555");
  await expect(page.locator("#inspector-content input")).toHaveCount(0);
  await page.locator('[data-action="viewer-close"]').click();
  await page.locator('[data-action="viewer-wires"]').click();
  await page.locator("[data-viewer-wire]").first().click();
  await expect(page.locator("#inspector-content")).toContainText(
    "建议裁线长度",
  );
  await page.locator('[data-action="viewer-close"]').click();
  await page.keyboard.press("Delete");
  await page.keyboard.press("r");
  await page.keyboard.press("Control+v");
  await page.locator('[data-view="front"]').click();
  await page.locator('[data-view="split"]').click();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.screenshot({ path: `artifacts/mobile-${browserName}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  expect(
    await page.evaluate(() => localStorage.getItem("fantasyperf.project.v1")),
  ).toBeNull();
  const { demoProject } = await import("../../src/core.js");
  const imported = demoProject();
  imported.name = "验收项目";
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 40;
    c.height = 20;
    return c.toDataURL("image/png");
  });
  imported.reference = {
    name: "reference.png",
    dataUrl: png,
    naturalWidth: 40,
    naturalHeight: 20,
    x: 24,
    y: 76,
    width: 360,
    opacity: 1,
    visible: true,
  };
  await page.locator("#file-input").setInputFiles({
    name: "viewer.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await expect(page.locator("#project-name")).toHaveValue("验收项目");
  await page.locator('[data-action="viewer-reference"]').click();
  await expect(page.locator(".viewer-reference img")).toBeVisible();
  await page.locator("[data-close]").first().click();
  expect(
    await page.evaluate(() => localStorage.getItem("fantasyperf.project.v1")),
  ).toBeNull();
  expect(errors).toEqual([]);
  await context.close();
});

test("统一元件入口、常用排布与清除网站数据后的文件恢复", async ({ page }) => {
  const { readFile } = await import("node:fs/promises");
  await newBoard(page);
  await expect(page.locator('[data-action="library"]')).toHaveCount(0);
  await page.keyboard.press("c");
  await expect(page.locator("#modal h2")).toHaveText("元件");
  await page.keyboard.press("Escape");
  await expect(page.locator('.tools [data-tool="select"]')).toHaveClass(/active/);
  await page.keyboard.press("c");
  await page.locator("#library-category").selectOption("双排 · 中间 2 个空孔");
  await page.locator("#library-search").fill("运放");
  await expect(page.locator("[data-library]")).toHaveCount(3);
  await page.screenshot({ path: "artifacts/component-library.png" });
  await page.locator("#library-search").fill("ne555");
  await page.locator('[data-library="ne555"]').click();
  await clickHole(page, 3, 3);
  const before = (await saved(page)).objects[0];
  const pending = page.waitForEvent("download");
  await page.locator('[data-action="export-component"]').click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("U1.fantasyperf-components.json");
  const buffer = await readFile(await download.path());
  expect(JSON.parse(buffer).components[0].pins).toEqual(before.pins);
  expect(before.pins.map((pin) => pin.label)).toEqual(["GND", "TRIG", "OUT", "RESET", "CONT", "THRES", "DISCH", "VCC"]);
  expect(await page.evaluate(() => localStorage.getItem("fantasyperf.templates.v1"))).toBeNull();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator("#component-file-input").setInputFiles({ name: "恢复.json", mimeType: "application/json", buffer });
  await page.locator('[data-imported="0"]').click();
  await clickHole(page, 2, 2, "front", 30, 20);
  expect((await saved(page)).objects[0].pins).toEqual(before.pins);
  const stored = await saved(page);
  await page.locator("#component-file-input").setInputFiles({ name: "损坏.json", mimeType: "application/json", buffer: Buffer.from('{"format":"wrong"}') });
  await expect(page.locator("#toast")).toContainText("元件导入失败");
  expect(await saved(page)).toEqual(stored);
});

test("旧模板可导出迁移，贴片文件恢复后仍在焊盘面", async ({ page }) => {
  const { readFile } = await import("node:fs/promises");
  const { regularPins } = await import("../../src/core.js");
  const legacy = [{ name: "旧排针", pins: regularPins("single", 3) }];
  await newBoard(page);
  await page.evaluate((items) => localStorage.setItem("fantasyperf.templates.v1", JSON.stringify(items)), legacy);
  await page.reload();
  await page.locator('.tools [data-tool="component"]').click();
  await expect(page.locator("#modal")).toContainText("发现 1 个旧模板");
  const pending = page.waitForEvent("download");
  await page.locator("#export-legacy").click();
  const exported = JSON.parse(await readFile(await (await pending).path(), "utf8"));
  expect(exported.components).toEqual(legacy);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("fantasyperf.templates.v1")))).toEqual(legacy);
  await page.locator('[data-library="smd-capacitor"]').click();
  await clickHole(page, 4.5, 4, "back");
  await saved(page);
  await page.locator('[data-action="rotate"]').click();
  await saved(page);
  const smdPending = page.waitForEvent("download");
  await page.locator('[data-action="export-component"]').click();
  const smdPath = await (await smdPending).path();
  await page.locator("#component-file-input").setInputFiles(smdPath);
  await page.locator('[data-imported="0"]').click();
  await expect(page.locator('[data-view="back"]')).toHaveClass("active");
  await clickHole(page, 8.5, 4, "back");
  expect((await saved(page)).objects[1]).toMatchObject({ mounting: "smd", kind: "capacitor", rotation: 0 });
});

test("元件旧文件自动升级，补丁兼容且未来版本不覆盖已导入元件", async ({ page }) => {
  const { COMPONENT_VERSION, createComponentFile } = await import("../../src/component-files.js");
  const { regularPins } = await import("../../src/core.js");
  const { readFile } = await import("node:fs/promises");
  await newBoard(page);
  const item = { name: "旧元件", pins: regularPins("double", 8, 1, 3) };
  const open = (file) => page.locator("#component-file-input").setInputFiles({
    name: "元件.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)),
  });
  for (const version of [1, "1.0.9"]) {
    await open({ format: "FantasyPerfComponents", version, components: [item] });
    await expect(page.locator("#toast")).toContainText(`升级到 v${COMPONENT_VERSION}`);
    await expect(page.locator('[data-imported="0"]')).toContainText("旧元件");
  }
  const patch = { ...createComponentFile([item]), version: "1.4.9" };
  await open(patch);
  await expect(page.locator("#toast")).toContainText("已导入 1 个元件");
  await expect(page.locator("#toast")).not.toContainText("升级到");
  const before = await saved(page);
  for (const [version, message] of [["1.5.0", "升级工具"], ["2.0.0", "大版本"]]) {
    await open({ ...patch, version, components: [{ ...item, name: "不应导入" }] });
    await expect(page.locator("#toast")).toContainText(message);
    await expect(page.locator('[data-imported="0"]')).toContainText("旧元件");
    expect(await saved(page)).toEqual(before);
  }
  await page.locator('[data-imported="0"]').click();
  await clickHole(page, 3, 3);
  expect((await saved(page)).objects[0].pins).toEqual(item.pins);
  const pending = page.waitForEvent("download");
  await page.locator('[data-action="export-component"]').click();
  const exported = JSON.parse(await readFile(await (await pending).path(), "utf8"));
  expect(exported.version).toBe(COMPONENT_VERSION);
  expect(exported.components).toEqual([item]);
  expect(exported.meta.appVersion).toBeTruthy();
});

test("旧模板导出后可删除，取消不变且刷新后不会复现", async ({ page }) => {
  const { regularPins } = await import("../../src/core.js");
  const key = "fantasyperf.templates.v1";
  const invalid = { name: "无法识别的旧记录", data: "保留" };
  const items = [invalid, { name: "待删除", pins: regularPins("single", 2) }, { name: "保留模板", pins: regularPins("single", 3) }];
  await newBoard(page);
  await page.evaluate(({ key, items }) => localStorage.setItem(key, JSON.stringify(items)), { key, items });
  await page.reload();
  await page.locator('.tools [data-tool="component"]').click();
  const pending = page.waitForEvent("download");
  await page.locator('[data-export-legacy="0"]').click();
  const file = await (await pending).path();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "删除旧模板 待删除", exact: true }).click();
  await expect(page.locator("[data-delete-legacy]")).toHaveCount(2);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除旧模板 待删除", exact: true }).click();
  await expect(page.locator("[data-delete-legacy]")).toHaveCount(1);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key)).toEqual([invalid, items[2]]);
  await page.reload();
  await page.locator('.tools [data-tool="component"]').click();
  await expect(page.getByRole("button", { name: "删除旧模板 待删除", exact: true })).toHaveCount(0);
  await page.locator("#component-file-input").setInputFiles(file);
  await expect(page.locator('[data-imported="0"]')).toContainText("待删除");
  await page.locator('[data-imported="0"]').click();
  await clickHole(page, 3, 3);
  expect((await saved(page)).objects[0].name).toBe("待删除");
  await page.locator('.tools [data-tool="component"]').click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除旧模板 保留模板", exact: true }).click();
  await expect(page.locator("#modal")).not.toContainText("旧版浏览器模板");
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key)).toEqual([invalid]);
});

test("旧模板删除遇到存储失败或其他窗口变更不会丢失数据", async ({ page }) => {
  const { regularPins } = await import("../../src/core.js");
  const key = "fantasyperf.templates.v1";
  const items = [{ name: "原模板", pins: regularPins("single", 2) }];
  await newBoard(page);
  await page.evaluate(({ key, items }) => localStorage.setItem(key, JSON.stringify(items)), { key, items });
  await page.reload();
  await page.locator('.tools [data-tool="component"]').click();
  await page.evaluate((key) => {
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (k) {
      if (k === key) throw new Error("storage unavailable");
      return remove.call(this, k);
    };
  }, key);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('[data-delete-legacy="0"]').click();
  await expect(page.locator("#toast")).toContainText("删除失败");
  await expect(page.locator("[data-delete-legacy]")).toHaveCount(1);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key)).toEqual(items);
  await page.reload();
  await page.locator('.tools [data-tool="component"]').click();
  const changed = [{ ...items[0], name: "其他窗口的新模板" }];
  await page.evaluate(({ key, changed }) => localStorage.setItem(key, JSON.stringify(changed)), { key, changed });
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('[data-delete-legacy="0"]').click();
  await expect(page.locator("#toast")).toContainText("其他窗口变更");
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key)).toEqual(changed);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('[data-delete-legacy="0"]').click();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBeNull();
  await expect(page.locator("#modal")).not.toContainText("旧版浏览器模板");
});

test("双排按中间空孔数预览和放置，零空孔为相邻两排", async ({ page }) => {
  await newBoard(page);
  await page.keyboard.press("c");
  await page.locator("#library-category").selectOption("双排 · 中间 2 个空孔");
  await expect(page.locator('[data-library="ne555"]')).toContainText("中心距 7.62 mm");
  await expect(page.locator('[data-library="ne555"] .preview-hole')).toHaveCount(16);
  await page.locator("#library-custom").click();
  await expect(page.getByLabel("两排之间空孔数", { exact: true })).toHaveValue("2");
  await expect(page.locator("#pin-gap-help")).toContainText("中心距 3 个孔距（7.62 mm）");
  await expect(page.locator("#component-pin-preview .preview-hole")).toHaveCount(16);
  await page.screenshot({ path: "artifacts/pin-gap-default.png" });
  await page.locator("#place-component").click();
  await clickHole(page, 3, 3);
  const first = (await saved(page)).objects[0];
  expect([...new Set(first.pins.map((pin) => pin.x))]).toEqual([0, 3]);
  await page.keyboard.press("c");
  await page.locator("#library-custom").click();
  await page.locator("#pin-gap").fill("0");
  await expect(page.locator("#pin-gap-help")).toContainText("中心距 1 个孔距（2.54 mm）");
  await expect(page.locator("#component-pin-preview .preview-hole")).toHaveCount(8);
  await page.locator("#pin-gap").fill("-1");
  await page.locator("#place-component").click();
  await expect(page.locator("#dialog-error")).toContainText("请填写有效");
  expect((await saved(page)).objects).toHaveLength(1);
  await page.locator("#pin-gap").fill("0");
  await page.locator("#place-component").click();
  await clickHole(page, 9, 3);
  const second = (await saved(page)).objects[1];
  expect([...new Set(second.pins.map((pin) => pin.x))]).toEqual([0, 1]);
  // Editing an existing component keeps its physical pin positions.
  await page.locator('[data-action="edit-component"]').click();
  await page.locator("#place-component").click();
  expect((await saved(page)).objects[1].pins).toEqual(second.pins);
});

test("编辑画布无重复板面标题，查看器和 PNG 保留方向信息", async ({ page }) => {
  await newBoard(page);
  await saved(page);
  const titles = await page.evaluate(async () => {
    const { newProject } = await import("/src/core.js");
    const { drawScene } = await import("/src/renderer.js");
    const project = newProject(10, 8);
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    const original = ctx.fillText.bind(ctx);
    let texts = [];
    ctx.fillText = (value, ...args) => { texts.push(value); original(value, ...args); };
    const render = (view, readOnly = false, exporting = false) => {
      texts = [];
      drawScene(canvas, project, {
        view, readOnly, camera: { zoom: 1, panX: 0, panY: 0 }, selected: new Set(),
      }, { width: 800, height: 600, exporting });
      return texts.filter((value) => /元件面|焊盘面/.test(value));
    };
    return {
      front: render("front"), back: render("back"), split: render("split"),
      viewer: render("split", true), png: render("split", false, true),
    };
  });
  expect(titles).toEqual({
    front: [], back: [], split: [],
    viewer: ["元件面 · A1 左上", "焊盘面 · A1 右上"],
    png: ["正面 · 元件面  /  A1 左上", "背面 · 焊盘面  /  A1 右上"],
  });
  await expect(page.locator('[data-view="front"]')).toHaveClass("active");
  await expect(page.locator("#view-label")).toBeHidden();
  await page.screenshot({ path: "artifacts/editor-without-view-title.png" });
  await page.locator('[data-view="back"]').click();
  await expect(page.locator('[data-view="back"]')).toHaveClass("active");
  await expect(page.locator("#view-label")).toBeHidden();
  await page.locator('[data-view="split"]').click();
  await expect(page.locator('[data-view="split"]')).toHaveClass("active");
  await expect(page.locator("#view-label")).toBeHidden();
  await page.goto("/?view=1");
  await expect(page.locator("#view-label")).toBeVisible();
});
