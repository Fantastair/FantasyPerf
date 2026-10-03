import {
  APP_VERSION, FORMAT, VERSION_PATTERN, compareVersions, versionMajor,
  newProject, validateProject,
} from "./core.js";

export const COMPONENT_FORMAT = "FantasyPerfComponents";
// Independent of the project format version; follows the same compatibility rules.
export const COMPONENT_VERSION = "1.4.0";
const COMPONENT_MIGRATIONS = {
  "1.0.0": {
    to: "1.1.0",
    migrate: ({ appVersion, exportedAt, ...data }) => ({
      ...data,
      meta: {
        app: FORMAT,
        appVersion: appVersion ?? null,
        savedAt: exportedAt ?? null,
      },
    }),
  },
  "1.1.0": { to: "1.2.0", migrate: (data) => ({ ...data }) },
  "1.2.0": { to: "1.3.0", migrate: (data) => ({ ...data }) },
  "1.3.0": { to: "1.4.0", migrate: (data) => ({ ...data }) },
};

export function parseComponentVersion(value) {
  // The old component format only had integer version 1. Project integer 2
  // has a different meaning and must never be interpreted here.
  if (value === 1) return "1.0.0";
  if (typeof value !== "string" || !VERSION_PATTERN.test(value)) return null;
  return value.split(".").every((part) => Number.isSafeInteger(Number(part)))
    ? value : null;
}

export function upgradeComponentFile(raw) {
  if (!raw || raw.format !== COMPONENT_FORMAT)
    throw new Error("不是 FantasyPerf 元件文件，请从「元件 → 导入元件」选择导出的元件文件");
  const version = parseComponentVersion(raw.version);
  if (!version)
    throw new Error("元件文件缺少有效的版本标识（应形如 1.1.0）");
  if (versionMajor(version) !== versionMajor(COMPONENT_VERSION))
    throw new Error(`元件文件是大版本 ${versionMajor(version)}，当前工具只支持大版本 ${versionMajor(COMPONENT_VERSION)}，请换用对应版本的工具`);
  const minor = (v) => Number(v.split(".")[1]);
  if (minor(version) > minor(COMPONENT_VERSION))
    throw new Error(`元件文件版本 ${version} 高于当前工具支持的 ${COMPONENT_VERSION}，请升级工具后再导入`);

  let data = { ...structuredClone(raw), version };
  // Patch versions do not change the schema; both newer and older patches
  // in the current minor release can be read without a migration.
  while (minor(data.version) < minor(COMPONENT_VERSION)) {
    const from = Object.keys(COMPONENT_MIGRATIONS)
      .filter((v) => versionMajor(v) === versionMajor(data.version) &&
        minor(v) === minor(data.version) && compareVersions(v, data.version) <= 0)
      .sort(compareVersions).at(-1);
    const step = COMPONENT_MIGRATIONS[from];
    if (!step) throw new Error(`缺少元件格式 ${data.version} 的升级步骤`);
    if (compareVersions(step.to, data.version) <= 0 ||
        compareVersions(step.to, COMPONENT_VERSION) > 0)
      throw new Error(`元件格式 ${data.version} 的升级目标无效`);
    data = { ...step.migrate(data), version: step.to };
  }
  return { ...data, version: COMPONENT_VERSION };
}

// Reuse project validation so imported components obey the same pin and SMD rules.
export function validateComponent(raw) {
  if (!raw || !Array.isArray(raw.pins) || !raw.pins.length || raw.pins.length > 256)
    throw new Error("元件引脚无效");
  const project = newProject(100, 100);
  project.objects = [{
    id: "component-file", type: "component", name: raw.name,
    x: Math.max(0, -Math.min(...raw.pins.map((p) => p?.x))),
    y: Math.max(0, -Math.min(...raw.pins.map((p) => p?.y))),
    rotation: 0, pins: raw.pins.map(({ net, id, ...pin }) => pin),
    ...(raw.ignoreCollision !== undefined ? { ignoreCollision: raw.ignoreCollision } : {}),
    ...(raw.shell !== undefined ? { shell: raw.shell } : {}),
    ...(raw.nameDx !== undefined ? { nameDx: raw.nameDx } : {}),
    ...(raw.nameDy !== undefined ? { nameDy: raw.nameDy } : {}),
    ...(raw.mounting !== undefined ? { mounting: raw.mounting, kind: raw.kind } : {}),
  }];
  const component = validateProject(project).objects[0];
  return {
    name: component.name, pins: component.pins,
    ...(component.ignoreCollision !== undefined ? { ignoreCollision: component.ignoreCollision } : {}),
    ...(component.shell !== undefined ? { shell: component.shell } : {}),
    ...(component.nameDx !== undefined ? { nameDx: component.nameDx } : {}),
    ...(component.nameDy !== undefined ? { nameDy: component.nameDy } : {}),
    ...(component.mounting ? { mounting: component.mounting, kind: component.kind } : {}),
  };
}

export function parseComponentFile(raw) {
  const data = upgradeComponentFile(raw);
  if (!Array.isArray(data.components) || !data.components.length || data.components.length > 100)
    throw new Error("元件文件必须包含 1–100 个元件");
  return data.components.map(validateComponent);
}

export function createComponentFile(components) {
  const file = {
    format: COMPONENT_FORMAT, version: COMPONENT_VERSION,
    meta: { app: FORMAT, appVersion: APP_VERSION, savedAt: new Date().toISOString() },
    components,
  };
  return { ...file, components: parseComponentFile(file) };
}
