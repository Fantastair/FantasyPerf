import { regularPins, clone, uid } from "./core.js";

// Generic layouts carry no labels. Named presets use the cited PDIP pinouts.
export function unlabeledPins(...args) {
  return regularPins(...args).map((pin) => ({ ...pin, label: "" }));
}
export const COMPONENT_LIBRARY = [
  ...[2, 3, 4, 6, 8, 10].map((count) => ({
    id: `header-${count}`,
    title: `单排 ${count} 脚排针`,
    group: "generic",
    category: "单排",
    description: "相邻引脚中心距 1 个孔距 · 2.54 mm",
    prefix: "J",
    pins: unlabeledPins("single", count),
  })),
  ...[6, 8, 10].map((count) => ({
    id: `header-double-${count}`,
    title: `双排 ${count} 脚排针`,
    group: "generic",
    category: "双排 · 中间 0 个空孔",
    description: "两排相邻，中间无空孔 · 中心距 2.54 mm",
    prefix: "J",
    pins: unlabeledPins("double", count, 1, 1),
  })),
  ...[8, 14, 16, 20].map((count) => ({
    id: `dual-${count}`,
    title: `双排 ${count} 脚引脚组`,
    group: "generic",
    category: "双排 · 中间 2 个空孔",
    description: "两排之间 2 个空孔 · 中心距 7.62 mm · 使用前核对实物",
    prefix: "U",
    pins: unlabeledPins("double", count, 1, 3),
  })),
  ...[
    {
      id: "ne555", title: "NE555 · DIP-8", model: "NE555", keywords: "555 定时器",
      labels: ["GND", "TRIG", "OUT", "RESET", "CONT", "THRES", "DISCH", "VCC"],
      source: "https://www.ti.com/lit/ds/symlink/ne555.pdf",
    },
    {
      id: "opamp-single-8", title: "8 脚单运放 · TL071", model: "TL071", keywords: "单运算放大器",
      // Current TL071 P (PDIP) package: pins 1 and 5 are NC; PS differs.
      labels: ["NC", "IN−", "IN+", "V−", "NC", "OUT", "V+", "NC"],
      source: "https://www.ti.com/lit/ds/symlink/tl071.pdf",
    },
    {
      id: "opamp-dual-8", title: "8 脚双运放 · LM358", model: "LM358", keywords: "双运算放大器",
      labels: ["OUT1", "IN1−", "IN1+", "V−", "IN2+", "IN2−", "OUT2", "V+"],
      source: "https://www.ti.com/lit/ds/symlink/lm358.pdf",
    },
    {
      id: "opamp-quad-14", title: "14 脚四运放 · LM324", model: "LM324", keywords: "四运算放大器 4运放",
      labels: ["OUT1", "IN1−", "IN1+", "V+", "IN2+", "IN2−", "OUT2", "OUT3", "IN3−", "IN3+", "V−", "IN4+", "IN4−", "OUT4"],
      source: "https://www.ti.com/lit/ds/symlink/lm324.pdf",
    },
  ].map(({ labels, model, ...item }) => ({
    ...item,
    group: "named",
    category: "双排 · 中间 2 个空孔",
    description: `两排之间 2 个空孔 · 中心距 7.62 mm · ${model} 功能标注`,
    prefix: "U",
    pins: regularPins("double", labels.length, 1, 3).map((pin, index) => ({
      ...pin, label: labels[index],
    })),
  })),
  ...["resistor", "capacitor"].map((kind) => ({
    id: `smd-${kind}`,
    title: kind === "resistor" ? "贴片电阻" : "贴片电容",
    group: "named",
    category: "两焊盘 · 贴片",
    description: "0603 / 0805 示意 · 焊盘面两孔之间",
    prefix: kind === "resistor" ? "R" : "C",
    mounting: "smd",
    kind,
    pins: unlabeledPins("single", 2),
  })),
];
export function instantiateLibraryItem(item, name) {
  const result = {
    id: uid(),
    type: "component",
    name,
    x: 0,
    y: 0,
    rotation: 0,
    pins: clone(item.pins),
    ...(item.ignoreCollision !== undefined ? { ignoreCollision: item.ignoreCollision } : {}),
    ...(item.shell !== undefined ? { shell: clone(item.shell) } : {}),
    ...(item.nameDx !== undefined ? { nameDx: item.nameDx } : {}),
    ...(item.nameDy !== undefined ? { nameDy: item.nameDy } : {}),
  };
  if (item.mounting)
    Object.assign(result, { mounting: item.mounting, kind: item.kind });
  return result;
}
