import test from "node:test";
import assert from "node:assert/strict";
import { APP_VERSION, regularPins } from "../src/core.js";
import { COMPONENT_LIBRARY } from "../src/library.js";
import { COMPONENT_VERSION, createComponentFile, parseComponentFile, parseComponentVersion, upgradeComponentFile } from "../src/component-files.js";

test("元件文件往返保留引脚、标注位置和贴片属性，去除实例位置", () => {
  const items = [
    { name: "自定义", x: 7, y: 8, rotation: 90, pins: [
      { x: -2, y: 3, label: "VCC", labelDx: 1, labelDy: -2 },
      { x: 4, y: 5, label: "", labelDx: 0, labelDy: 0 },
    ] },
    { name: "电容", mounting: "smd", kind: "capacitor", pins: regularPins("single", 2) },
  ];
  const file = createComponentFile(items);
  const restored = parseComponentFile(JSON.parse(JSON.stringify(file)));
  assert.deepEqual(restored[0], { name: items[0].name, pins: items[0].pins });
  assert.deepEqual(restored[1], items[1]);
  restored[0].pins[0].label = "changed";
  assert.equal(items[0].pins[0].label, "VCC");
});

test("元件文件拒绝错误格式、未来版本、重复引脚和损坏的贴片", () => {
  const valid = createComponentFile([{ name: "J1", pins: regularPins("single", 2) }]);
  assert.throws(() => parseComponentFile({}), /不是.*元件文件/);
  assert.throws(() => parseComponentFile({ ...valid, version: 2 }), /版本/);
  for (const components of [[], Array(101).fill(valid.components[0]),
    [{ name: "bad", pins: [null] }],
    [{ name: "bad", pins: [valid.components[0].pins[0], valid.components[0].pins[0]] }],
    [{ ...valid.components[0], mounting: "smd", kind: "unknown" }],
    [{ name: "bad", pins: [{ x: 0.5, y: 0, label: "1" }] }],
    [{ name: "bad", pins: [{ x: 0, y: 0, label: "a".repeat(101) }] }],
  ]) assert.throws(() => parseComponentFile({ ...valid, components }));
});

test("常用 DIP 预设按物理排布分类且不绑定功能标注", () => {
  for (const [id, count] of [["ne555", 8], ["opamp-single-8", 8], ["opamp-dual-8", 8], ["opamp-quad-14", 14]]) {
    const item = COMPONENT_LIBRARY.find((entry) => entry.id === id);
    assert.equal(item.category, "双排 · 排距 3 孔");
    assert.deepEqual(item.pins, regularPins("double", count, 1, 3));
  }
});

test("旧整数版本与旧三段版本逐级升级，元件和导出信息不丢失", () => {
  for (const version of [1, "1.0.0", "1.0.9"]) {
    const old = {
      format: "FantasyPerfComponents", version,
      appVersion: "1.1.0", exportedAt: "2026-10-01T09:00:00.000Z",
      components: [{ name: "旧元件", pins: regularPins("double", 8, 1, 3) }],
    };
    const before = structuredClone(old);
    const migrated = upgradeComponentFile(old);
    assert.equal(migrated.version, COMPONENT_VERSION);
    assert.deepEqual(migrated.meta, {
      app: "FantasyPerf", appVersion: old.appVersion, savedAt: old.exportedAt,
    });
    assert.equal(Object.hasOwn(migrated, "exportedAt"), false);
    assert.deepEqual(parseComponentFile(old), old.components);
    assert.deepEqual(upgradeComponentFile(migrated), migrated);
    migrated.components[0].pins[0].label = "changed";
    assert.deepEqual(old, before);
  }
  const missingMeta = upgradeComponentFile({ format: "FantasyPerfComponents", version: 1, components: [] });
  assert.deepEqual(missingMeta.meta, { app: "FantasyPerf", appVersion: null, savedAt: null });
});

test("元件格式小版本兼容，高中版本和不同大版本拒绝导入", () => {
  const file = createComponentFile([{ name: "C1", mounting: "smd", kind: "capacitor", pins: regularPins("single", 2) }]);
  for (const version of ["1.1.0", "1.1.9"]) {
    const input = { ...file, version };
    assert.deepEqual(parseComponentFile(input), file.components);
    assert.equal(upgradeComponentFile(input).version, COMPONENT_VERSION);
    assert.equal(input.version, version);
  }
  assert.throws(() => parseComponentFile({ ...file, version: "1.2.0" }), /高于当前工具支持.*升级工具/);
  for (const version of ["0.9.0", "2.0.0"])
    assert.throws(() => parseComponentFile({ ...file, version }), /大版本/);
});

test("元件版本解析独立于项目旧版本，损坏旧文件升级后仍被拒绝", () => {
  const file = createComponentFile([{ name: "J1", pins: regularPins("single", 2) }]);
  assert.equal(parseComponentVersion(1), "1.0.0");
  for (const version of [undefined, null, true, 2, "2", "1.1", "1.1.0-beta", "9007199254740992.0.0"]) {
    assert.equal(parseComponentVersion(version), null);
    assert.throws(() => parseComponentFile({ ...file, version }), /有效的版本标识/);
  }
  const pin = file.components[0].pins[0];
  assert.throws(() => parseComponentFile({ ...file, version: 1, components: [{ name: "bad", pins: [pin, pin] }] }), /重复引脚/);
});

test("重新导出使用当前元件格式与工具版本，保留旧元件内容", () => {
  const old = { format: "FantasyPerfComponents", version: 1, components: [
    { name: "NE555", pins: regularPins("double", 8, 1, 3) },
  ] };
  const exported = createComponentFile(parseComponentFile(old));
  assert.equal(exported.version, COMPONENT_VERSION);
  assert.equal(typeof exported.version, "string");
  assert.equal(exported.meta.appVersion, APP_VERSION);
  assert.ok(Number.isFinite(Date.parse(exported.meta.savedAt)));
  assert.deepEqual(exported.components, old.components);
});
