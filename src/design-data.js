// Optional design rules are separate from geometry; old files keep their layout.
export function designAttributes(raw, component = false) {
  const result = {};
  if (raw.ignoreCollision !== undefined) {
    if (typeof raw.ignoreCollision !== "boolean") throw new Error("忽略碰撞选项无效");
    result.ignoreCollision = raw.ignoreCollision;
  }
  if (raw.shell !== undefined) {
    const s = raw.shell;
    if (!component || !s || typeof s.enabled !== "boolean" ||
      ![s.x, s.y].every((n) => Number.isFinite(n) && Math.abs(n) <= 100) ||
      ![s.w, s.h].every((n) => Number.isFinite(n) && n >= 0.1 && n <= 200))
      throw new Error("外壳边界无效");
    result.shell = { enabled: s.enabled, x: s.x, y: s.y, w: s.w, h: s.h };
  }
  return result;
}
export function pinIntent(raw) {
  const result = {};
  if (raw.net !== undefined) {
    if (typeof raw.net !== "string" || !raw.net.trim() || raw.net.length > 80)
      throw new Error("引脚逻辑连接组无效");
    result.net = raw.net.trim();
  }
  if (raw.nc !== undefined) {
    if (typeof raw.nc !== "boolean") throw new Error("NC 声明无效");
    result.nc = raw.nc;
  }
  if (raw.id !== undefined) {
    if (typeof raw.id !== "string" || !raw.id || raw.id.length > 100)
      throw new Error("引脚编号无效");
    result.id = raw.id;
  }
  if (result.net && result.nc) throw new Error("引脚不能同时属于连接组和 NC");
  return result;
}
