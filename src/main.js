import "./style.css";
import { createSound } from "./sound.js";
import { connectDesktop, isDesktop } from "./desktop.js";
import { paperFor } from "./paper.js";
import { createShredderEngine, loadImageAsync } from "./shredder-engine.js";
import { demoThumbnailFor, extractBrowserPreview } from "./thumbnail.js";

const machine = document.querySelector("#machine");
const dockEar = document.querySelector(".dock-ear");
const throatBack = document.querySelector(".throat-back");
const shredderHead = document.querySelector(".shredder-head");
const wasteBin = document.querySelector("#waste-bin");
const statusEl = document.querySelector("#status");
const oledStateEl = document.querySelector("#oled-state");
const oledCounterEl = document.querySelector("#oled-counter");
const pile = document.querySelector("#pile");
const lamp = document.querySelector("#lamp");
const skinToggleBtn = document.querySelector("#skin-toggle");
const skinLabelEl = document.querySelector("#skin-label");
const pick = document.querySelector("#pick");
const dumpBtn = document.querySelector("#dump");
const dumpTextEl = document.querySelector("#dump-text");
const modeStripBtn = document.querySelector("#mode-strip");
const modeCrossBtn = document.querySelector("#mode-cross");
const modeBurnBtn = document.querySelector("#mode-burn");
const demoBatchBtn = document.querySelector("#demo-batch");
const demoMatrixBtn = document.querySelector("#demo-matrix");
const canvas = document.querySelector("#shred-canvas");

const sound = createSound();
const preview = !isDesktop();
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let desktop = null;
let passThrough = true;
let shredding = false;
let picking = false;
let draggingPos = false;
let holdUntil = 0;
let summary = "拖入文件 · 放入废纸篓";
let shreddedTotal = Number.parseInt(localStorage.getItem("shredder-count") || "0", 10) || 0;
let binFiles = 0;
let binBytes = 0;
const savedMode = localStorage.getItem("shredder-mode");
let cutMode = savedMode === "cross" || savedMode === "burn" ? savedMode : "strip";
const savedSkin = localStorage.getItem("shredder-skin");
let currentSkin = savedSkin === "white" || savedSkin === "braun" ? "white" : "dark";

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 KB";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function haptic(pattern = 1) {
  desktop?.haptic?.(pattern);
}

const engine = createShredderEngine(canvas, {
  onCountChange(count, fillRatio = 0) {
    const hasScraps = count > 0;
    const pct = Math.min(100, Math.round(fillRatio * 100));
    const isFull = pct >= 82;
    machine.classList.toggle("has-scraps", hasScraps);
    machine.classList.toggle("bin-full", hasScraps && isFull);
    dumpBtn.hidden = !hasScraps;
    if (hasScraps) {
      dumpTextEl.textContent = isFull ? `满仓 · 清空` : pct >= 8 ? `倒掉纸屑 · ${pct}%` : "倒掉纸屑";
    }
  },
});
engine.resize(244, 224);

if (preview) document.documentElement.classList.add("preview");
syncLamp();
syncSkin(currentSkin, { silent: true });
syncMode(cutMode, { silent: true });
syncCounter();
setOled("STANDBY", summary);

function syncSkin(nextSkin, { silent = false } = {}) {
  currentSkin = nextSkin === "white" || nextSkin === "braun" ? "white" : "dark";
  localStorage.setItem("shredder-skin", currentSkin);
  machine.dataset.skin = currentSkin;
  if (skinLabelEl) {
    skinLabelEl.textContent = currentSkin === "white" ? "WHITE" : "DARK";
  }
  if (!silent) {
    sound.click();
    haptic(1);
    if (!shredding) {
      const skinDesc = currentSkin === "white" ? "纯白极简" : "黑曜石暗黑";
      setOled("SKIN APPLIED", `已切换 · ${skinDesc}`);
    }
    engine.impulse(0, 14, 0.025);
  }
}

function toggleSkin() {
  syncSkin(currentSkin === "white" ? "dark" : "white");
}

skinToggleBtn?.addEventListener("click", () => toggleSkin());

function syncLamp() {
  const on = !sound.muted;
  lamp.setAttribute("aria-pressed", on ? "true" : "false");
  lamp.setAttribute("aria-label", on ? "声音已开启" : "声音已静音");
  machine.classList.toggle("muted", !on);
}

function syncMode(nextMode, { silent = false } = {}) {
  cutMode = nextMode === "cross" || nextMode === "burn" ? nextMode : "strip";
  localStorage.setItem("shredder-mode", cutMode);
  machine.dataset.mode = cutMode;
  modeStripBtn.classList.toggle("is-active", cutMode === "strip");
  modeCrossBtn.classList.toggle("is-active", cutMode === "cross");
  modeBurnBtn.classList.toggle("is-active", cutMode === "burn");
  if (!silent) {
    sound.click();
    haptic(1);
    if (!shredding) {
      const labelMap = {
        strip: ["STRIP-CUT", "已切换 · 经典条状切碎"],
        cross: ["CROSS-CUT", "已切换 · 粒状粉碎模式"],
        burn: ["INCINERATE", "已切换 · 碳化焚毁模式"],
      };
      setOled(labelMap[cutMode][0], labelMap[cutMode][1]);
    }
  }
}

function syncCounter() {
  oledCounterEl.textContent = String(shreddedTotal).padStart(3, "0");
}

function setOled(state, text) {
  oledStateEl.textContent = state;
  statusEl.textContent = text;
}

function isHeavyItem(item) {
  return !!item.isDir || (item.bytes || 0) >= 2_400_000;
}

function shredMs(item) {
  if (reduce) return 240;
  const paper = paperFor(item);
  const mb = Math.max(0, (item.bytes || 0) / (1024 * 1024));
  const heavyExtra = isHeavyItem(item) ? 260 : 0;
  const ms = (760 + Math.sqrt(mb) * 340) * (paper.speed || 1) + heavyExtra;
  return Math.round(Math.min(2800, Math.max(520, ms)));
}

function labelOf(item) {
  return item.isDir ? `${item.name}/` : item.name;
}

function pointInRect(x, y, rect, pad = 0) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  return x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;
}

function hitVisibleBody(x, y) {
  const isOpen = machine.classList.contains("open");
  if (!isOpen) {
    return pointInRect(x, y, dockEar.getBoundingClientRect(), 12);
  }
  if (pointInRect(x, y, throatBack.getBoundingClientRect(), 10)) return true;
  if (pointInRect(x, y, shredderHead.getBoundingClientRect(), 10)) return true;
  const binVisible =
    machine.classList.contains("bin-open") ||
    machine.classList.contains("shredding") ||
    machine.classList.contains("has-scraps");
  if (binVisible && pointInRect(x, y, wasteBin.getBoundingClientRect(), 8)) return true;
  return false;
}

function wantsOpen() {
  return draggingPos || shredding || picking || engine.count > 0 || Date.now() < holdUntil;
}

async function syncChrome(x, y) {
  const overBody = draggingPos || hitVisibleBody(x, y);
  if (overBody) holdUntil = Date.now() + 700;
  const open = overBody || wantsOpen();
  machine.classList.toggle("open", open);

  const pass = !overBody && !picking && !draggingPos;
  if (desktop && pass !== passThrough) {
    passThrough = pass;
    await desktop.setPassThrough(pass);
  }
}

function makeSheet(item) {
  const paper = paperFor(item);
  const el = document.createElement("div");
  el.className = "sheet";
  el.dataset.kind = paper.kind;
  el.style.setProperty("--tone", paper.tone);
  el.style.setProperty("--ink", paper.ink);
  el.style.setProperty("--accent", paper.accent);

  if (item.thumbnail) {
    el.classList.add("has-thumb");
    const img = document.createElement("img");
    img.className = "sheet-thumb";
    img.src = item.thumbnail;
    img.alt = labelOf(item);
    img.draggable = false;
    el.appendChild(img);
  }

  const head = document.createElement("div");
  head.className = "sheet-head";

  const name = document.createElement("strong");
  name.textContent = labelOf(item);

  const ext = document.createElement("span");
  ext.className = "sheet-ext";
  ext.textContent = item.isDir ? "DIR" : (item.ext || "FILE").slice(0, 4);

  head.appendChild(name);
  head.appendChild(ext);
  el.appendChild(head);

  if (!item.thumbnail && item.snippet) {
    const pre = document.createElement("pre");
    pre.className = "sheet-snippet";
    pre.textContent = item.snippet;
    el.appendChild(pre);
  }

  return el;
}

function placeSheet(el, index) {
  const side = index === 0 ? 0 : index % 2 === 0 ? -1 : 1;
  el.style.setProperty("--x", `${side * index * 5}px`);
  el.style.setProperty("--y", `${-index * 16}px`);
  el.style.setProperty("--r", `${side * index * 1.1}deg`);
  el.style.setProperty("--s", `${Math.max(0.88, 1 - index * 0.035)}`);
  el.style.zIndex = String(10 - index);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 统一强制复位碎纸机运转状态（避免任何未捕获异常导致滚轴无限空转）
function resetShreddingState() {
  shredding = false;
  sound.preheat(false);
  machine.classList.remove("shredding", "heavy-load", "is-matrix", "drag-over");
  pile.replaceChildren();
  pile.hidden = true;
}

// 帧级同步进纸 + 大文件吃力顿挫 + 真实切片/焚毁/彩蛋幽绿代码雨 + 各类文件专属视听
async function feedFront(front, item, { speedScale = 1 } = {}) {
  const paper = paperFor(item);
  const heavy = isHeavyItem(item);
  const isMatrix = paper.kind === "matrix";
  const thumbImg = item.thumbnail ? await loadImageAsync(item.thumbnail) : null;

  const baseMs = shredMs(item);
  const ms = Math.max(220, Math.round(baseMs * speedScale));
  const travelY = 130;

  machine.classList.add("shredding", "bin-open");
  if (cutMode === "burn") front.classList.add("is-burning");
  if (isMatrix) machine.classList.add("is-matrix");

  // 根据各类文件类型定制鲜明的 OLED 仪表盘状态与标签
  if (isMatrix) {
    setOled("MATRIX PROTOCOL", `> PURGE [${labelOf(item)}] 0x7F`);
    haptic(2);
  } else if (cutMode === "burn") {
    setOled("INCINERATE", labelOf(item));
    haptic(1);
  } else {
    const kindInfo = {
      photo: ["[EXPOSURE]", "图像切片"],
      design: ["[CMYK VECTOR]", "矢量拆解"],
      grid: ["[SPREADSHEET]", "表格抹除"],
      wave: ["[AUDIO TRACK]", "音轨切断"],
      film: ["[VIDEO REEL]", "胶卷粉碎"],
      kraft: ["[ARCHIVE]", "重度碾压"],
      folder: ["[DIRECTORY]", "目录封存"],
      pdf: ["[CONFIDENTIAL]", "公文销毁"],
      word: ["[DOCUMENT]", "文档销毁"],
      notes: ["[MEMO NOTE]", "便签碎纸"],
    }[paper.kind] || ["[FILE]", "粉碎处理"];
    setOled(kindInfo[0], `${kindInfo[1]} · ${labelOf(item)}`);
    haptic(1);
  }

  front.classList.add("is-feeding");
  sound.play(ms, paper, cutMode, { heavy, fillRatio: engine.fillRatio });
  const session = engine.beginFeed(paper, cutMode, thumbImg);

  if (reduce) {
    front.style.transform = `translate3d(0, ${travelY}px, 0)`;
    session.update(1);
    session.finish();
    return wait(ms);
  }

  return new Promise((resolve) => {
    const start = performance.now();
    let heavyTriggered = false;
    let heavyBroken = false;
    let resolved = false;

    const done = () => {
      if (resolved) return;
      resolved = true;
      machine.classList.remove("heavy-load");
      try {
        session.finish();
      } catch {
        /* ignore */
      }
      resolve();
    };

    // 绝对安全防死锁定时器：保证即便 requestAnimationFrame 因后台节流延迟，也必定准时结束
    const safetyTimer = setTimeout(done, ms + 320);

    function step(now) {
      if (resolved) return;
      const elapsed = now - start;
      const raw = Math.min(1, elapsed / ms);

      // 计算真实进纸进度曲线：大文件/文件夹在 34%~54% 出现吃力微顿挫，随后猛地咬破加速吞完！
      let progress = raw;
      if (raw < 0.08) {
        progress = (raw / 0.08) * (raw / 0.08) * 0.08;
      } else if (heavy && cutMode !== "burn") {
        if (raw >= 0.34 && raw < 0.54) {
          if (!heavyTriggered) {
            heavyTriggered = true;
            machine.classList.add("heavy-load");
            setOled("HEAVY LOAD", labelOf(item));
            haptic(0);
          }
          // 吃力减速卡顿段
          progress = 0.34 + (raw - 0.34) * 0.28;
        } else if (raw >= 0.54) {
          if (!heavyBroken) {
            heavyBroken = true;
            machine.classList.remove("heavy-load");
            setOled("SHREDDING", labelOf(item));
            haptic(2); // 咬破瞬间给一次爽快的触感反馈！
          }
          const t = (raw - 0.54) / 0.46;
          // 猛地加速绞碎剩余部分
          progress = 0.396 + Math.pow(t, 0.85) * 0.604;
        }
      }

      const jitterAmp = heavyTriggered && !heavyBroken ? 2.6 : 1.3;
      const jitterX = raw < 1 ? (Math.random() - 0.5) * jitterAmp : 0;
      const y = progress * travelY;
      front.style.transform = `translate3d(${jitterX.toFixed(2)}px, ${y.toFixed(2)}px, 0) scaleX(${(1 - progress * 0.025).toFixed(4)})`;

      session.update(progress);

      if (raw < 1) {
        requestAnimationFrame(step);
      } else {
        clearTimeout(safetyTimer);
        done();
      }
    }

    requestAnimationFrame(step);
  });
}

async function playPile(items, { rapid = false } = {}) {
  const waiting = items.slice();
  pile.replaceChildren();
  waiting.splice(0, Math.min(4, waiting.length)).forEach((item) => {
    const el = makeSheet(item);
    el.style.setProperty("--x", "0px");
    el.style.setProperty("--y", "-110px");
    el.style.setProperty("--r", "0deg");
    el.style.setProperty("--s", "1");
    pile.appendChild(el);
  });

  pile.hidden = false;
  void pile.offsetHeight;
  [...pile.children].forEach((el, index) => placeSheet(el, index));
  sound.slideIn();

  if (!reduce) {
    if (items.length > 1) {
      setOled(rapid ? "RAPID FEED" : "QUEUE", `共 ${items.length} 份 · ${rapid ? "极速点钞连续进纸" : "逐张进纸"}`);
      await wait(rapid ? 120 : 260);
    } else {
      await wait(120);
    }
  }

  const speedScale = rapid ? 0.42 : 1;
  const interWait = rapid ? 45 : 140;

  for (const item of items) {
    const front = pile.firstElementChild;
    if (!front) break;
    await feedFront(front, item, { speedScale });
    front.remove();
    shreddedTotal += 1;
    binFiles += 1;
    binBytes += item.bytes || 0;
    localStorage.setItem("shredder-count", String(shreddedTotal));
    syncCounter();

    if (waiting.length) {
      const el = makeSheet(waiting.shift());
      placeSheet(el, pile.children.length);
      pile.appendChild(el);
    }
    [...pile.children].forEach((el, index) => placeSheet(el, index));
    if (pile.children.length && !reduce) {
      sound.slideIn();
      await wait(interWait);
    }
  }
}

let queue = Promise.resolve();

function enqueue(job) {
  queue = queue.then(job, job);
  return queue;
}

async function runReports(items, { simulated }) {
  const ok = items.filter((item) => item.trashed);
  const bad = items.filter((item) => !item.trashed);

  if (!ok.length) {
    resetShreddingState();
    machine.classList.add("open", "error");
    setOled("REJECTED", bad[0]?.error || "无法移入废纸篓");
    holdUntil = Date.now() + 2200;
    return;
  }

  // 限制最大连续视觉纸张数为 8 张，其余在后台静默累计，避免用户被长时间挂在动画中
  const visual = ok.slice(0, 8);
  const isRapidBatch = ok.length >= 4;
  shredding = true;
  sound.preheat(false);
  machine.classList.add("open", "bin-open");
  machine.classList.remove("error", "drag-over");

  try {
    await playPile(visual, { rapid: isRapidBatch });
  } finally {
    resetShreddingState();
  }

  if (simulated) {
    summary = "预览完成 · 原文件未变动";
  } else if (bad.length) {
    summary = `已进废纸篓 ${ok.length} 个，${bad.length} 个跳过`;
  } else if (ok.length > visual.length) {
    summary = `已进废纸篓 ${ok.length} 个`;
  } else if (ok.length === 1) {
    summary = "已安全放入废纸篓";
  } else {
    summary = `已安全放入废纸篓 · 共 ${ok.length} 个`;
  }

  setOled("DONE", summary);
  holdUntil = Date.now() + 1800;
}

async function shredPaths(paths) {
  if (!paths.length) return;

  // 0ms 即时响应：松手瞬间立刻咬合启动
  holdUntil = Date.now() + 1600;
  machine.classList.add("open", "shredding");
  sound.preheat(true);
  const count = paths.length;
  setOled("INGESTING", count === 1 ? "正在咬入文件..." : `正在咬入 ${count} 份文件...`);

  try {
    if (!desktop) {
      const items = paths.map((path) => {
        const name = path.split(/[/\\]/).pop() || path;
        const ext = name.includes(".") ? name.split(".").pop() : "";
        const item = { path, name, ext, bytes: 950000, isDir: false, trashed: true };
        return { ...item, thumbnail: demoThumbnailFor(item) };
      });
      await runReports(items, { simulated: true });
      return;
    }

    let items = [];
    try {
      items = await desktop.trash(paths);
    } catch (error) {
      machine.classList.add("open", "error");
      setOled("ERROR", "没能放进废纸篓");
      console.error(error);
      return;
    }
    await runReports(items, { simulated: false });
  } finally {
    resetShreddingState();
  }
}

function pretend(list) {
  return enqueue(() =>
    runReports(
      list.map((it) => {
        const base = {
          name: it.name,
          ext: it.ext || "",
          bytes: it.bytes || 900000,
          isDir: !!it.isDir,
          trashed: true,
          thumbnail: it.thumbnail || null,
          snippet: it.snippet || null,
        };
        if (!base.thumbnail && !base.snippet) {
          base.thumbnail = demoThumbnailFor(base);
        }
        return base;
      }),
      { simulated: true },
    ),
  );
}

// ================================
// 悬浮窗垂直位置拖动调整 + 记忆
// ================================

const DEFAULT_DOCK_RATIO = preview ? 0.5 : 0.44;
let dockRatio = Number.parseFloat(localStorage.getItem("shredder-dock-y") || "");
if (!Number.isFinite(dockRatio)) dockRatio = DEFAULT_DOCK_RATIO;

function clampDockPx(px) {
  const vh = window.innerHeight || 800;
  // 留出顶部进纸舞台与底部机头安全边距
  const minPx = preview ? 210 : 152;
  const maxPx = Math.max(minPx, vh - (preview ? 140 : 190));
  return Math.max(minPx, Math.min(maxPx, px));
}

function applyDockRatio(ratio, { save = false } = {}) {
  const vh = window.innerHeight || 800;
  const px = clampDockPx(ratio * vh);
  dockRatio = px / vh;
  machine.style.setProperty("--dock-y", `${Math.round(px)}px`);
  if (save) {
    localStorage.setItem("shredder-dock-y", dockRatio.toFixed(4));
  }
}

applyDockRatio(dockRatio);
window.addEventListener("resize", () => applyDockRatio(dockRatio));

function setupVerticalDrag(handleEl) {
  let startClientY = 0;
  let startTopPx = 0;
  let lastDragY = 0;
  let moved = false;

  handleEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest("button")) return;
    draggingPos = true;
    moved = false;
    startClientY = event.clientY;
    lastDragY = event.clientY;
    startTopPx = Number.parseFloat(getComputedStyle(machine).top) || (window.innerHeight || 800) * dockRatio;
    handleEl.setPointerCapture(event.pointerId);
    machine.classList.add("dragging");
    event.preventDefault();
  });

  handleEl.addEventListener("pointermove", (event) => {
    if (!draggingPos) return;
    const dy = event.clientY - startClientY;
    const instantDy = event.clientY - lastDragY;
    lastDragY = event.clientY;
    if (Math.abs(dy) > 3) moved = true;
    if (Math.abs(instantDy) > 0.4) {
      // 上下拖拽位移反向作用于透明仓纸堆，注入真实阻尼晃动
      engine.impulse(0, -instantDy * 1.5, -instantDy * 0.0015);
    }
    const nextPx = clampDockPx(startTopPx + dy);
    const vh = window.innerHeight || 800;
    dockRatio = nextPx / vh;
    machine.style.setProperty("--dock-y", `${Math.round(nextPx)}px`);
  });

  const endDrag = (event) => {
    if (!draggingPos) return;
    draggingPos = false;
    machine.classList.remove("dragging");
    if (handleEl.hasPointerCapture(event.pointerId)) {
      handleEl.releasePointerCapture(event.pointerId);
    }
    // 松手时惯性沉底与弹性回弹
    engine.impulse((Math.random() - 0.5) * 6, 15, (Math.random() - 0.5) * 0.035);
    if (moved) {
      localStorage.setItem("shredder-dock-y", dockRatio.toFixed(4));
      haptic(1);
      if (!shredding) setOled("POSITION", "已保存停靠位置");
    }
  };

  handleEl.addEventListener("pointerup", endDrag);
  handleEl.addEventListener("pointercancel", endDrag);

  handleEl.addEventListener("dblclick", (event) => {
    if (event.target.closest("button")) return;
    applyDockRatio(DEFAULT_DOCK_RATIO, { save: true });
    sound.click();
    haptic(1);
    engine.impulse(0, 16, 0.02);
    if (!shredding) setOled("POSITION", "已重置默认位置");
  });
}

setupVerticalDrag(shredderHead);
setupVerticalDrag(throatBack);
setupVerticalDrag(dockEar);

// 亚克力集纸仓物理交互：划过仓体扰动纸堆，轻敲果冻回弹
let lastBinX = 0;
let lastBinY = 0;
wasteBin.addEventListener("pointerenter", (event) => {
  lastBinX = event.clientX;
  lastBinY = event.clientY;
});
wasteBin.addEventListener("pointermove", (event) => {
  const dx = event.clientX - lastBinX;
  const dy = event.clientY - lastBinY;
  lastBinX = event.clientX;
  lastBinY = event.clientY;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    engine.impulse(dx * 0.26, dy * 0.16, dx * 0.0022);
  }
});
wasteBin.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button")) return;
  engine.impulse((Math.random() - 0.5) * 12, 16, (Math.random() - 0.5) * 0.04);
  haptic(0);
});

// ================================
// 事件绑定
// ================================

lamp.addEventListener("click", () => {
  sound.setMuted(!sound.muted);
  syncLamp();
  if (!sound.muted) sound.click();
});

modeStripBtn.addEventListener("click", () => syncMode("strip"));
modeCrossBtn.addEventListener("click", () => syncMode("cross"));
modeBurnBtn.addEventListener("click", () => syncMode("burn"));

pick.addEventListener("click", () => {
  sound.click();
  haptic(1);
  enqueue(async () => {
    if (!desktop) {
      await pretend([{ name: "2026_Q4_保密合同.pdf", ext: "pdf", bytes: 1420000 }]);
      return;
    }
    picking = true;
    machine.classList.add("open");
    passThrough = false;
    await desktop.setPassThrough(false);
    try {
      const paths = await desktop.pickFiles();
      if (paths.length) await shredPaths(paths);
    } finally {
      picking = false;
    }
  });
});

dumpBtn.addEventListener("click", () => {
  sound.playDump();
  haptic(2);
  const clearedFiles = binFiles;
  const clearedBytes = binBytes;
  binFiles = 0;
  binBytes = 0;
  engine.dump();
  machine.classList.remove("bin-open", "bin-full");
  if (!shredding) {
    if (clearedFiles > 0) {
      setOled("CLEARED", `已清仓 · ${clearedFiles} 份 (${formatBytes(clearedBytes)})`);
    } else {
      setOled("EMPTY", "纸屑已清空");
    }
  }
});

// 预览工作台交互
document.querySelectorAll(".file-card").forEach((card) => {
  card.addEventListener("dragstart", (event) => {
    const payload = JSON.stringify({
      name: card.dataset.name,
      ext: card.dataset.ext || "",
      bytes: Number(card.dataset.bytes) || 900000,
      isDir: card.dataset.dir === "1",
    });
    event.dataTransfer.setData("application/x-shredder-file", payload);
  });

  card.addEventListener("click", () => {
    pretend([
      {
        name: card.dataset.name,
        ext: card.dataset.ext || "",
        bytes: Number(card.dataset.bytes) || 900000,
        isDir: card.dataset.dir === "1",
      },
    ]);
  });
});

demoBatchBtn?.addEventListener("click", () => {
  pretend([
    { name: "2026_Q4_保密合同.pdf", ext: "pdf", bytes: 1420000 },
    { name: "十一月报销明细.xlsx", ext: "xlsx", bytes: 860000 },
    { name: "屏幕截图_1520.png", ext: "png", bytes: 3800000 },
    { name: "旧版设计稿_废弃", ext: "", isDir: true, bytes: 5200000 },
  ]);
});

demoMatrixBtn?.addEventListener("click", () => {
  pretend([
    {
      name: "matrix_payload.rs",
      ext: "rs",
      bytes: 102400,
      snippet: "fn purge_memory() {\n    let stream = 0x7F;\n    drop(stream);\n}",
    },
  ]);
});

let preheating = false;

window.addEventListener("dragover", (event) => {
  if (!preview) return;
  event.preventDefault();
  machine.classList.add("drag-over");
  if (!shredding) {
    setOled("DROP READY", "松手开始销毁");
    if (!preheating) {
      preheating = true;
      sound.preheat(true);
    }
  }
});

window.addEventListener("dragleave", (event) => {
  if (!preview) return;
  if (event.relatedTarget === null) {
    machine.classList.remove("drag-over");
    preheating = false;
    sound.preheat(false);
    if (!shredding) setOled("STANDBY", summary);
  }
});

window.addEventListener("drop", async (event) => {
  if (!preview) return;
  event.preventDefault();
  machine.classList.remove("drag-over");
  preheating = false;
  sound.preheat(false);

  const custom = event.dataTransfer.getData("application/x-shredder-file");
  if (custom) {
    try {
      pretend([JSON.parse(custom)]);
      return;
    } catch {
      /* ignore */
    }
  }

  const files = [...event.dataTransfer.files];
  if (!files.length) return;
  const enriched = await Promise.all(
    files.map(async (file) => {
      const ext = file.name.includes(".") ? file.name.split(".").pop() : "";
      const { thumbnail, snippet } = await extractBrowserPreview(file);
      return {
        name: file.name,
        ext,
        bytes: file.size,
        isDir: false,
        thumbnail,
        snippet,
      };
    }),
  );
  pretend(enriched);
});

// ================================
// Tauri 桌面端启动与联动
// ================================

async function boot() {
  desktop = await connectDesktop();
  if (!desktop) return;
  passThrough = true;
  await desktop.setPassThrough(true);

  await desktop.onDrag((payload) => {
    if (payload.type === "enter" || payload.type === "over") {
      holdUntil = Date.now() + 900;
      machine.classList.add("open", "drag-over");
      if (!shredding) {
        setOled("DROP READY", "松手，安全放入废纸篓");
        if (!preheating) {
          preheating = true;
          sound.preheat(true);
        }
      }
    }
    if (payload.type === "drop") {
      machine.classList.remove("drag-over");
      preheating = false;
      sound.preheat(false);
      const paths = payload.paths || [];
      enqueue(() => shredPaths(paths));
    }
    if (payload.type === "leave") {
      machine.classList.remove("drag-over");
      preheating = false;
      sound.preheat(false);
      if (!shredding) setOled("STANDBY", summary);
    }
  });

  await desktop.onMenu("menu-pick", () => pick.click());
  await desktop.onMenu("menu-folder", () => {
    enqueue(async () => {
      picking = true;
      machine.classList.add("open");
      await desktop.setPassThrough(false);
      passThrough = false;
      try {
        const paths = await desktop.pickFolder();
        if (paths.length) await shredPaths(paths);
      } finally {
        picking = false;
      }
    });
  });
  await desktop.onMenu("menu-dump", () => dumpBtn.click());
  await desktop.onMenu("menu-skin", () => toggleSkin());
  await desktop.onTrash((items) => {
    if (!items?.length) return;
    enqueue(() =>
      runReports(
        items.map((item) => ({ ...item, trashed: true })),
        { simulated: false },
      ),
    );
  });

  // 自适应休眠指针检测：
  // - 收缩待机且鼠标远离屏幕右侧时，自动降频至 220ms（CPU 降 75%+）
  // - 鼠标静止且无需改变展开态时，跳过所有 getBoundingClientRect() 布局计算
  // - 鼠标靠近右侧或机器展开时，立即切回 60ms 丝滑响应
  let lastPtrX = -9999;
  let lastPtrY = -9999;
  let lastOpenState = false;

  async function pollPointer() {
    let nextDelay = 220;
    try {
      const point = await desktop.pointer();
      const moved = Math.abs(point.x - lastPtrX) > 0.5 || Math.abs(point.y - lastPtrY) > 0.5;
      const nowOpen = machine.classList.contains("open");
      const needCheck = moved || nowOpen !== lastOpenState || (nowOpen && !wantsOpen());

      if (needCheck) {
        lastPtrX = point.x;
        lastPtrY = point.y;
        await syncChrome(point.x, point.y);
        lastOpenState = machine.classList.contains("open");
      }

      if (lastOpenState || point.x >= 220 || shredding || picking) {
        nextDelay = 60;
      }
    } catch (error) {
      console.error(error);
      nextDelay = 400;
    }
    window.setTimeout(pollPointer, nextDelay);
  }

  pollPointer();

  // 降频窗口贴边校准（15 秒一次，大幅减少主线程唤醒）
  window.setInterval(() => {
    desktop.pin().catch(() => {});
  }, 15000);
}

boot();
