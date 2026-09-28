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
  face = "back",
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
      (face === "front" ? cols - 1 - x : x) * 28 * zoom +
      (split && !readOnly && face === "front" ? w : 0),
    y:
      box.y +
      (split && readOnly && face === "front" ? h : 0) +
      h / 2 -
      ((rows - 1) * 28 * zoom) / 2 +
      y * 28 * zoom,
  };
}
async function clickHole(page, x, y, face = "back", cols = 20, rows = 15) {
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
  await page.locator("#component-name").fill(name);
  await page.locator("#pin-kind").selectOption(kind);
  await page.locator("#pin-count").fill(count);
  await page.locator("#pin-count").press("Tab");
  await page.locator("#place-component").click();
  await clickHole(page, x, y);
}
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
  await page.locator('[data-view="front"]').click();
  await page.locator('.tools [data-tool="solder"]').click();
  await clickHole(page, 2, 3, "front");
  await clickHole(page, 7, 4, "front");
  await page.keyboard.press("Enter");
  await page.locator('[data-view="front"]').click();
  await page.locator('.tools [data-tool="solder"]').click();
  await clickHole(page, 3, 3, "front");
  await clickHole(page, 7, 7, "front");
  await page.keyboard.press("Enter");
  await page.locator('.tools [data-tool="wire"]').click();
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
  await page.locator('[data-view="front"]').click();
  const a1 = await hole(page, 0, 0, "front");
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
  expect(p).toEqual(snapshot);
  expect(errors).toEqual([]);
});
test("模板、引脚标注拖动、独立移动与保护板尺寸", async ({ page }) => {
  await newBoard(page);
  await addComponent(page, "U1", 7, 4);
  await page.locator('[data-pin="0"]').fill("VCC");
  await page.locator('[data-pin="0"]').press("Tab");
  await page.locator('[data-action="save-template"]').click();
  const start = await hole(page, 7, 4),
    left = await hole(page, 6, 4);
  await page.mouse.move(start.x - (start.x - left.x) * 0.65, start.y);
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
  await page.locator('[data-action="templates"]').click();
  await page.locator('[data-template="0"]').click();
  await page.locator("#place-component").click();
  await clickHole(page, 13, 4);
  p = await saved(page);
  expect(p.objects).toHaveLength(2);
  expect(p.objects[1].pins[0].label).toBe("VCC");
});
test("取消绘制不落盘，自定义元件可建立并重开", async ({ page }) => {
  await newBoard(page);
  await page.locator('[data-view="front"]').click();
  await page.locator('.tools [data-tool="solder"]').click();
  await clickHole(page, 1, 1, "front");
  await clickHole(page, 4, 4, "front");
  await page.keyboard.press("Escape");
  let p = await saved(page);
  expect(p.objects).toHaveLength(0);
  await page.locator('.tools [data-tool="component"]').click();
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
  await page.goto("/");
  await page.locator('.tools [data-action="demo"]').click();
  await page.locator("#create-project").click();
  const original = await saved(page);
  await page.locator('[data-view="split"]').click();
  const box = await page.locator("#board").boundingBox();
  await page.mouse.move(box.x + 5, box.y + 75);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 5, box.y + box.height - 60, {
    steps: 10,
  });
  await page.mouse.up();
  await expect(page.locator("#selection-hint")).toContainText("已选 8 个对象");
  await page.keyboard.press("ArrowRight");
  let moved = await saved(page);
  expect(moved.objects[0].x).toBe(original.objects[0].x + 1);
  expect(moved.objects[3].points[0].x).toBe(
    original.objects[3].points[0].x + 1,
  );
  await page.locator('[data-action="undo"]').click();
  await page.locator('[data-view="back"]').click();
  await clickHole(page, 8, 5);
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
  await page.locator('[data-view="front"]').click();
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
  expect(p.objects[0].pins[19].label).toBe("20");
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
  await expect(page.locator('[data-view="front"]')).toHaveClass("active");
  await clickHole(page, 4.5, 4, "front");
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
  const from = await hole(page, 4, 4.5, "front"),
    to = await hole(page, 6, 6.5, "front");
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
  await clickHole(page, 10, 8.5, "front");
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
  await expect(page.locator('[data-view="front"]')).toHaveClass("active");
  await page.locator('[data-action="undo"]').click();
  p = await saved(page);
  expect(p.objects).toHaveLength(2);
  await page.locator('[data-view="back"]').click();
  await clickHole(page, 6, 6.5);
  await expect(page.locator("#inspector-content")).toContainText("洞洞板");
  await page.locator('[data-view="front"]').click();
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
  await page.locator('[data-view="front"]').click();
  await clickHole(page, 6, 6.5, "front");
  await page.locator('[data-action="edit-component"]').click();
  await expect(page.locator("#smd-kind")).toHaveValue("resistor");
  await page.locator("#smd-name").fill("R1 · 22k");
  await page.locator("#place-smd").click();
  expect((await saved(page)).objects[0].name).toBe("R1 · 22k");
  expect(errors).toEqual([]);
});

test("元件面直接绘制和编辑锡线，翻面保持同一条线路", async ({ page }) => {
  await newBoard(page);
  await addComponent(page, "U1", 7, 4);
  await page.locator('.tools [data-tool="solder"]').click();
  await expect(page.locator('[data-view="back"]')).toHaveClass("active");
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
  await page.locator('[data-view="front"]').click();
  await clickHole(page, 4, 2, "front");
  await expect(page.locator("#object-name")).toHaveValue("T1");
  expect((await saved(page)).objects).toEqual(p.objects);
  await page.locator('[data-view="back"]').click();
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

test("公共元件库搜索、分类、直接放置及实例独立", async ({ page }) => {
  await newBoard(page);
  await page.locator('[data-action="library"]').click();
  await page.locator("#library-search").fill("单排 4");
  await expect(page.locator("[data-library]")).toHaveCount(1);
  await page.locator('[data-library="header-4"]').click();
  await clickHole(page, 3, 3);
  let p = await saved(page);
  expect(p.objects[0]).toMatchObject({ name: "J1", type: "component" });
  expect(p.objects[0].pins).toHaveLength(4);
  await page.locator('[data-pin="0"]').fill("VCC");
  await page.locator('[data-pin="0"]').press("Tab");
  await page.locator('[data-action="library"]').click();
  await page.locator('[data-library="header-4"]').click();
  await clickHole(page, 3, 6);
  p = await saved(page);
  expect(p.objects[1].pins[0].label).toBe("1");
  expect(p.objects[1].name).toBe("J2");
  await page.locator('[data-action="library"]').click();
  await page.locator("#library-category").selectOption("贴片");
  await expect(page.locator("[data-library]")).toHaveCount(2);
  await page.locator('[data-library="smd-resistor"]').click();
  await clickHole(page, 8.5, 5, "front");
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
    "双排模块 · 布线示例",
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
  const target = await hole(page, 8, 5);
  await page.touchscreen.tap(target.x, target.y);
  await expect(page.locator(".inspector")).toBeVisible();
  await expect(page.locator("#inspector-content")).toContainText("U1");
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
