// Pointer gestures change only the viewport. No project data is passed into this controller.
export function installViewerGestures(
  canvas,
  { enabled, point, pan, zoom, pick, changed },
) {
  const pointers = new Map();
  let start = null,
    previous = null,
    moved = false;
  const geometry = () => {
    const ps = [...pointers.values()];
    return ps.length > 1
      ? {
          x: (ps[0].x + ps[1].x) / 2,
          y: (ps[0].y + ps[1].y) / 2,
          d: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y),
        }
      : { ...ps[0], d: 0 };
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (!enabled() || (e.button !== 0 && e.pointerType === "mouse")) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, point(e));
    if (pointers.size === 1) {
      start = point(e);
      moved = false;
    } else moved = true;
    previous = geometry();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!enabled() || !pointers.has(e.pointerId)) return;
    e.preventDefault();
    pointers.set(e.pointerId, point(e));
    const next = geometry();
    if (pointers.size > 1) {
      if (previous.d > 0 && next.d > 0) zoom(next.d / previous.d, previous);
      moved = true;
    } else if (start && Math.hypot(next.x - start.x, next.y - start.y) > 6)
      moved = true;
    if (moved) {
      pan(next.x - previous.x, next.y - previous.y);
      changed();
    }
    previous = next;
  });
  function release(e, cancelled = false) {
    if (!pointers.has(e.pointerId)) return;
    if (enabled() && !cancelled && !moved && pointers.size === 1)
      pick(point(e));
    pointers.delete(e.pointerId);
    previous = pointers.size ? geometry() : null;
    if (!pointers.size) start = null;
  }
  canvas.addEventListener("pointerup", (e) => release(e));
  canvas.addEventListener("pointercancel", (e) => release(e, true));
  return () => {
    pointers.clear();
    start = null;
    previous = null;
    moved = false;
  };
}
