// A floating reference stays readable while the physical board is flipped or zoomed.
import { clamp } from "./core.js";

export function createReferenceLayer(
  stage,
  { getProject, commit, onSelect, onVisibilityChange, notify },
) {
  const layer = document.createElement("section");
  layer.className = "reference-image";
  layer.hidden = true;
  layer.setAttribute("aria-label", "原理图参考图");
  layer.innerHTML =
    '<div class="reference-head"><span title="拖动移动">原理图参考</span><button type="button" class="reference-hide" aria-label="临时隐藏参考图" title="临时隐藏参考图">隐藏</button></div><img alt="原理图布线参考" draggable="false">';
  stage.append(layer);
  const restore = document.createElement("button");
  restore.type = "button";
  restore.className = "reference-restore";
  restore.textContent = "显示参考图";
  restore.title = "恢复临时隐藏的原理图参考";
  restore.hidden = true;
  stage.append(restore);
  const img = layer.querySelector("img");
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp,image/gif,image/bmp";
  input.hidden = true;
  input.id = "reference-file-input";
  stage.append(input);
  let drag = null,
    loading = false,
    temporarilyHidden = false,
    source = null;

  function syncSource(ref) {
    const next = ref?.dataUrl ?? null;
    if (next !== source) temporarilyHidden = false;
    source = next;
  }
  function setTemporarilyHidden(hidden) {
    temporarilyHidden = hidden;
    render(layer.classList.contains("selected"));
    onVisibilityChange?.();
  }
  layer.querySelector(".reference-hide").onclick = () => setTemporarilyHidden(true);
  restore.onclick = () => setTemporarilyHidden(false);

  function layout(ref) {
    const maxWidth = Math.max(140, stage.clientWidth - 32);
    const maxHeight = Math.max(100, stage.clientHeight - 120);
    const width = Math.min(
      ref.width,
      maxWidth,
      ((maxHeight - 34) * ref.naturalWidth) / ref.naturalHeight,
    );
    const height = (width * ref.naturalHeight) / ref.naturalWidth + 34;
    return {
      width,
      height,
      x: clamp(ref.x, 8, Math.max(8, stage.clientWidth - width - 8)),
      y: clamp(ref.y, 60, Math.max(60, stage.clientHeight - height - 48)),
    };
  }
  function render(selected = false) {
    const ref = getProject().reference;
    syncSource(ref);
    layer.hidden = !ref || !ref.visible || temporarilyHidden;
    restore.hidden = !ref || !ref.visible || !temporarilyHidden;
    layer.classList.toggle("selected", selected);
    if (!ref) {
      img.removeAttribute("src");
      return;
    }
    if (img.getAttribute("src") !== ref.dataUrl) img.src = ref.dataUrl;
    layer.style.opacity = ref.opacity;
    layer.title = ref.name;
    const box = layout(ref);
    restore.style.left = box.x + "px";
    restore.style.top = box.y + "px";
    layer.style.width = box.width + "px";
    if (!drag) {
      layer.style.left = box.x + "px";
      layer.style.top = box.y + "px";
    }
  }
  layer.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    e.preventDefault();
    onSelect();
    const ref = getProject().reference;
    if (!ref) return;
    drag = { startX: e.clientX, startY: e.clientY, ...layout(ref) };
    layer.setPointerCapture(e.pointerId);
    layer.classList.add("dragging");
  });
  layer.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const x = clamp(
      drag.x + e.clientX - drag.startX,
      8,
      Math.max(8, stage.clientWidth - drag.width - 8),
    );
    const y = clamp(
      drag.y + e.clientY - drag.startY,
      60,
      Math.max(60, stage.clientHeight - drag.height - 48),
    );
    layer.style.left = x + "px";
    layer.style.top = y + "px";
  });
  layer.addEventListener("pointerup", () => {
    if (!drag) return;
    const x = parseFloat(layer.style.left),
      y = parseFloat(layer.style.top);
    drag = null;
    layer.classList.remove("dragging");
    commit(() => {
      if (getProject().reference)
        Object.assign(getProject().reference, { x, y });
    });
  });
  function cancelDrag() {
    drag = null;
    layer.classList.remove("dragging");
    render();
  }
  layer.addEventListener("pointercancel", cancelDrag);
  window.addEventListener("blur", cancelDrag);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drag) cancelDrag();
  });
  img.addEventListener("error", () =>
    notify("参考图片无法解码，请重新导入图片。"),
  );

  async function importFile(file) {
    if (loading || !file) return;
    if (
      ![
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "image/bmp",
      ].includes(file.type)
    ) {
      notify("请选择 PNG、JPEG、WebP、GIF 或 BMP 图片。");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      notify("图片不能超过 20 MB，请先压缩后导入。");
      return;
    }
    loading = true;
    const owner = getProject();
    const url = URL.createObjectURL(file);
    try {
      const source = new Image();
      source.src = url;
      await source.decode();
      if (
        !source.naturalWidth ||
        !source.naturalHeight ||
        source.naturalWidth * source.naturalHeight > 80_000_000
      )
        throw new Error("图片尺寸过大或无效");
      const scale = Math.min(
        1,
        2400 / Math.max(source.naturalWidth, source.naturalHeight),
      );
      const buffer = document.createElement("canvas");
      buffer.width = Math.max(1, Math.round(source.naturalWidth * scale));
      buffer.height = Math.max(1, Math.round(source.naturalHeight * scale));
      const ctx = buffer.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, buffer.width, buffer.height);
      ctx.drawImage(source, 0, 0, buffer.width, buffer.height);
      let dataUrl = buffer.toDataURL("image/webp", 0.9);
      if (dataUrl.length > 1_800_000)
        dataUrl = buffer.toDataURL("image/jpeg", 0.75);
      if (dataUrl.length > 1_800_000)
        throw new Error("图片压缩后仍过大，请使用更小的图片");
      // A project may have been replaced while the browser was decoding the image.
      if (getProject() !== owner) {
        notify("项目已切换，请在当前项目重新导入图片。");
        return;
      }
      commit(() => {
        temporarilyHidden = false;
        getProject().reference = {
          name: file.name.slice(0, 200),
          dataUrl,
          naturalWidth: buffer.width,
          naturalHeight: buffer.height,
          x: 24,
          y: 76,
          width: 360,
          opacity: 1,
          visible: true,
        };
      });
      onSelect();
      notify("已导入参考图，可拖动图片移动；右侧可调整大小与透明度。");
    } catch (error) {
      notify("无法导入图片：" + error.message);
    } finally {
      loading = false;
      URL.revokeObjectURL(url);
    }
  }
  input.addEventListener("change", () => {
    const file = input.files[0];
    input.value = "";
    importFile(file);
  });

  function properties(root) {
    const ref = getProject().reference;
    if (!ref) return;
    syncSource(ref);
    root.innerHTML = `<h2 class="section-heading">原理图参考</h2><p class="reference-filename"></p><div class="field"><label for="reference-width">显示宽度 <span id="reference-width-value">${ref.width}</span> px</label><input id="reference-width" type="range" min="140" max="1000" step="10" value="${ref.width}"></div><div class="field"><label for="reference-opacity">透明度 <span id="reference-opacity-value">${Math.round(ref.opacity * 100)}</span>%</label><input id="reference-opacity" type="range" min="15" max="100" value="${Math.round(ref.opacity * 100)}"></div><label class="check"><input id="reference-visible" type="checkbox" ${ref.visible ? "checked" : ""}>显示参考图</label><p class="muted">拖动图片调整位置。参考图保持正向，独立于板面缩放和翻转。图片随项目自动保存及导出项目文件。</p><div class="row-actions"><button id="replace-reference">替换图片</button><button id="remove-reference" class="danger">移除</button></div>`;
    root.querySelector(".reference-filename").textContent = ref.name;
    const toggle = document.createElement("button");
    toggle.id = "reference-temporary-visibility";
    toggle.className = "wide";
    toggle.textContent = temporarilyHidden ? "恢复显示参考图" : "临时隐藏参考图";
    toggle.disabled = !ref.visible;
    toggle.onclick = () => setTemporarilyHidden(!temporarilyHidden);
    root.querySelector(".row-actions").before(toggle);
    const hint = document.createElement("p");
    hint.className = "muted";
    hint.textContent = "临时隐藏后可在画布上恢复显示，刷新页面后恢复；临时隐藏不改变项目的显示设置。";
    toggle.after(hint);
    for (const [id, key, multiplier] of [
      ["width", "width", 1],
      ["opacity", "opacity", 0.01],
    ]) {
      const el = root.querySelector("#reference-" + id);
      el.addEventListener("input", () => {
        root.querySelector("#reference-" + id + "-value").textContent =
          el.value;
      });
      el.addEventListener("change", () =>
        commit(() => {
          getProject().reference[key] = Number(el.value) * multiplier;
        }),
      );
    }
    root.querySelector("#reference-visible").onchange = (e) =>
      commit(() => {
        getProject().reference.visible = e.target.checked;
      });
    root.querySelector("#replace-reference").onclick = () => input.click();
    root.querySelector("#remove-reference").onclick = () =>
      commit(() => {
        getProject().reference = null;
      });
  }
  return { render, properties, choose: () => input.click() };
}
