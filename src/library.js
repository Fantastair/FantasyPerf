import { regularPins, clone, uid } from "./core.js";

// Generic pin groups only. Named modules can be added once their exact pinouts are confirmed.
export const COMPONENT_LIBRARY = [
  ...[2, 3, 4, 6, 8, 10].map((count) => ({
    id: `header-${count}`,
    title: `单排 ${count} 脚排针`,
    category: "排针",
    description: "孔距 2.54 mm · 数字引脚标注",
    prefix: "J",
    pins: regularPins("single", count),
  })),
  ...[6, 8, 10].map((count) => ({
    id: `header-double-${count}`,
    title: `双排 ${count} 脚排针`,
    category: "排针",
    description: "两排间距 1 孔 · 同排间距 1 孔",
    prefix: "J",
    pins: regularPins("double", count, 1, 1),
  })),
  ...[8, 14, 16, 20].map((count) => ({
    id: `dual-${count}`,
    title: `双排 ${count} 脚引脚组`,
    category: "双排引脚组",
    description: "两排间距 3 孔 · 通用布局，使用前核对实物",
    prefix: "U",
    pins: regularPins("double", count, 1, 3),
  })),
  ...["resistor", "capacitor"].map((kind) => ({
    id: `smd-${kind}`,
    title: kind === "resistor" ? "贴片电阻" : "贴片电容",
    category: "贴片",
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
