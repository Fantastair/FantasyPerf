import { regularPins, clone, uid } from "./core.js";

// Presets describe physical pin arrangements; labels are generic pin numbers.
export const COMPONENT_LIBRARY = [
  ...[2, 3, 4, 6, 8, 10].map((count) => ({
    id: `header-${count}`,
    title: `单排 ${count} 脚排针`,
    category: "单排",
    description: "同排间距 1 孔 · 2.54 mm",
    prefix: "J",
    pins: regularPins("single", count),
  })),
  ...[6, 8, 10].map((count) => ({
    id: `header-double-${count}`,
    title: `双排 ${count} 脚排针`,
    category: "双排 · 排距 1 孔",
    description: "两排间距 1 孔 · 同排间距 1 孔",
    prefix: "J",
    pins: regularPins("double", count, 1, 1),
  })),
  ...[8, 14, 16, 20].map((count) => ({
    id: `dual-${count}`,
    title: `双排 ${count} 脚引脚组`,
    category: "双排 · 排距 3 孔",
    description: "两排间距 3 孔 · 通用布局，使用前核对实物",
    prefix: "U",
    pins: regularPins("double", count, 1, 3),
  })),
  ...[
    ["ne555", "NE555 · DIP-8", 8, "555 定时器"],
    ["opamp-single-8", "8 脚单运放 · DIP-8", 8, "单运算放大器"],
    ["opamp-dual-8", "8 脚双运放 · DIP-8", 8, "双运算放大器"],
    ["opamp-quad-14", "14 脚四运放 · DIP-14", 14, "四运算放大器 4运放"],
  ].map(([id, title, count, keywords]) => ({
    id, title, keywords,
    category: "双排 · 排距 3 孔",
    description: "同排间距 1 孔 · 排距 3 孔（7.62 mm）",
    prefix: "U",
    pins: regularPins("double", count, 1, 3),
  })),
  ...["resistor", "capacitor"].map((kind) => ({
    id: `smd-${kind}`,
    title: kind === "resistor" ? "贴片电阻" : "贴片电容",
    category: "两焊盘 · 贴片",
    description: "0603 / 0805 示意 · 焊盘面两孔之间",
    prefix: kind === "resistor" ? "R" : "C",
    mounting: "smd",
    kind,
    pins: regularPins("single", 2),
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
  };
  if (item.mounting)
    Object.assign(result, { mounting: item.mounting, kind: item.kind });
  return result;
}
