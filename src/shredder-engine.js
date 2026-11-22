// 真实照片级切片碎纸引擎 (True Sliced Paper Physics + Static Pile Baking)：
// 1. 真实画面切片：把待碎纸张（含缩略图/文档纹理）精确纵向切成 18~20 列真实纹理纸条，
//    上方纸张底边先入刀口，下方就同步先吐出底边画面像素，上下严丝合缝！
// 2. 告别“泡面波浪”：真实纸张带挺度与刀辊压出的优雅微弧（C-curve），配真实刀切利落边缘与柔和接触投影
// 3. 真实杂乱蓬松堆叠 + 离屏烘培：落地自然交错斜靠并迅速静止，烘培到底层画布永不消失且满帧 60fps

function parseHex(hex) {
  const clean = (hex || "#f3ecdf").replace("#", "");
  const n = Number.parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbStr(c, alpha = 1) {
  return alpha < 1 ? `rgba(${c[0]},${c[1]},${c[2]},${alpha})` : `rgb(${c[0]},${c[1]},${c[2]})`;
}

// 将图片或文档纸张生成标准 180x132 源纹理画布，用于精准切片
function createSheetTexture(paper, img) {
  const w = 180;
  const h = 132;
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const c = off.getContext("2d");

  const tone = parseHex(paper.tone);
  const accent = parseHex(paper.accent);
  const ink = parseHex(paper.ink);

  // 彩蛋 4：黑客帝国幽绿代码雨 (Matrix Stream) 真实切片纹理
  if (paper.kind === "matrix") {
    c.fillStyle = "#010803";
    c.fillRect(0, 0, w, h);

    // 幽绿 CRT 扫描线背景
    c.fillStyle = "rgba(0, 255, 102, 0.06)";
    for (let y = 0; y < h; y += 3) {
      c.fillRect(0, y, w, 1);
    }

    // 纵向下坠幽绿代码字符流
    const glyphs = "0123456789ABCDEF<>/{}$#*+=-_[]FNLETRS";
    const cols = 18;
    const colStep = w / cols;
    c.font = "bold 8.5px ui-monospace, 'SF Mono', Menlo, monospace";
    c.textAlign = "center";

    for (let col = 0; col < cols; col += 1) {
      const cx = col * colStep + colStep * 0.5;
      const seed = (col * 37) % h;
      for (let r = 0; r < 13; r += 1) {
        const cy = (seed + r * 10) % h;
        const char = glyphs[Math.floor(Math.random() * glyphs.length)];
        if (r === 0) {
          c.fillStyle = "#f0fff4"; // 最前端高亮青白发光字符
        } else if (r <= 2) {
          c.fillStyle = "#34d399"; // 亮绿
        } else if (r <= 6) {
          c.fillStyle = "#059669"; // 矩阵纯绿
        } else {
          c.fillStyle = "#022c22"; // 幽暗拖尾
        }
        c.fillText(char, cx, cy + 8);
      }
    }
    return off;
  }

  if (img && img.complete && img.naturalWidth > 0) {
    // 带极细白边的真实缩略图画面
    c.fillStyle = "#f7f5f0";
    c.fillRect(0, 0, w, h);
    const pad = 4;
    const dw = w - pad * 2;
    const dh = h - pad * 2;
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const boxRatio = dw / dh;
    let sx = 0;
    let sy = 0;
    let sw = img.naturalWidth;
    let sh = img.naturalHeight;
    if (imgRatio > boxRatio) {
      sw = img.naturalHeight * boxRatio;
      sx = (img.naturalWidth - sw) * 0.5;
    } else {
      sh = img.naturalWidth / boxRatio;
    }
    c.drawImage(img, sx, sy, sw, sh, pad, pad, dw, dh);
    return off;
  }

  // 无图片缩略图时，合成逼真的文档纸面纹理（页眉色块 + 缩微段落线条）
  c.fillStyle = rgbStr(tone);
  c.fillRect(0, 0, w, h);

  // 顶部色带
  c.fillStyle = rgbStr(accent, 0.88);
  c.fillRect(0, 0, w, 22);

  // 纸面印刷行纹
  c.fillStyle = rgbStr(ink, 0.24);
  for (let y = 34; y < h - 10; y += 11) {
    const lineW = (y % 33 === 0 ? 0.62 : 0.84) * (w - 28);
    c.fillRect(14, y, lineW, 3);
  }

  if (paper.kind === "grid") {
    c.strokeStyle = rgbStr(accent, 0.26);
    c.lineWidth = 1;
    for (let x = 36; x < w; x += 36) {
      c.beginPath();
      c.moveTo(x, 22);
      c.lineTo(x, h);
      c.stroke();
    }
  }

  return off;
}

export function loadImageAsync(url) {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function createShredderEngine(canvas, { onCountChange } = {}) {
  const ctx = canvas.getContext("2d");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const bakedCanvas = document.createElement("canvas");
  const bakedCtx = bakedCanvas.getContext("2d");

  let width = 244;
  let height = 224;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  const SLOT_Y = 0;
  const PAPER_WIDTH = 168;
  const BIN_PADDING_X = 12;
  const BIN_FLOOR_Y = 170;
  const MAX_PILE_HEIGHT = 128;

  let activeStrips = []; // 正在从出纸口同步切出的真实纹理纸条
  let strips = []; // 切断后正在下落或阻尼落稳中的纸条
  let chips = []; // 粒状粉碎模式的小纸片（也带真实切片纹理！）
  let ashes = []; // 焚毁模式：焦黑灰烬片（带灼热余温红边，落底后冷却烘培成炭渣堆）
  let embers = []; // 焚毁模式：漂浮闪烁的橙红火星余烬
  let bakedCount = 0;
  let dumping = false;
  let dumpOffsetY = 0;
  let dumpVy = 0;
  let rafId = 0;
  let lastTime = 0;
  let lastNotifiedCount = 0;

  // 亚克力集纸仓物理晃动与弹性惯性系统 (Jiggle Spring-Damper Physics)
  // 当上下拖动机身、鼠标划过仓体或落纸冲击时，纸堆产生极度逼真的物理倾斜与微震回弹
  let jiggleX = 0;
  let jiggleY = 0;
  let jiggleAngle = 0;
  let jiggleVx = 0;
  let jiggleVy = 0;
  let jiggleVa = 0;

  const JIGGLE_K = 210; // 弹簧刚度 (轻质纸堆果冻弹性)
  const JIGGLE_DAMP = 17; // 阻尼系数 (迅速收敛沉实，不拖泥带水)
  const JIGGLE_K_ROT = 240;
  const JIGGLE_DAMP_ROT = 19;

  const BUCKETS = 40;
  let pileHeight = new Float32Array(BUCKETS);

  function resetFloor() {
    pileHeight.fill(0);
  }

  function clearBaked() {
    bakedCtx.setTransform(1, 0, 0, 1, 0, 0);
    bakedCtx.clearRect(0, 0, bakedCanvas.width, bakedCanvas.height);
    bakedCount = 0;
    dumpOffsetY = 0;
    dumpVy = 0;
  }

  function resize(w = width, h = height) {
    width = w;
    height = h;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.max(1, Math.round(width * dpr));
    const ph = Math.max(1, Math.round(height * dpr));
    canvas.width = pw;
    canvas.height = ph;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    bakedCanvas.width = pw;
    bakedCanvas.height = ph;
    bakedCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function bucketIndex(x) {
    const usable = width - BIN_PADDING_X * 2;
    const norm = Math.max(0, Math.min(0.999, (x - BIN_PADDING_X) / usable));
    return Math.floor(norm * BUCKETS);
  }

  function getSurfaceY(x) {
    return BIN_FLOOR_Y - pileHeight[bucketIndex(x)];
  }

  function getSurfaceSlope(x) {
    const idx = bucketIndex(x);
    const left = pileHeight[Math.max(0, idx - 2)];
    const right = pileHeight[Math.min(BUCKETS - 1, idx + 2)];
    return Math.atan2(left - right, 24) * 0.7;
  }

  function depositVolume(x, thickness, spread = 4) {
    const center = bucketIndex(x);
    for (let offset = -spread; offset <= spread; offset += 1) {
      const idx = center + offset;
      if (idx < 0 || idx >= BUCKETS) continue;
      const t = offset / (spread + 1);
      const weight = 0.5 * (1 + Math.cos(t * Math.PI));
      pileHeight[idx] = Math.min(MAX_PILE_HEIGHT, pileHeight[idx] + thickness * weight);
    }
  }

  function totalScraps() {
    return activeStrips.length + strips.length + chips.length + ashes.length + bakedCount;
  }

  function getFillRatio() {
    let sum = 0;
    for (let i = 0; i < BUCKETS; i += 1) sum += pileHeight[i];
    const avg = sum / BUCKETS;
    return Math.max(0, Math.min(1, avg / (MAX_PILE_HEIGHT * 0.85)));
  }

  function notifyIfNeeded() {
    const count = totalScraps();
    if ((count > 0) !== (lastNotifiedCount > 0) || Math.abs(count - lastNotifiedCount) >= 5) {
      lastNotifiedCount = count;
      onCountChange?.(count, getFillRatio());
    }
  }

  function ensureLoop() {
    if (rafId) return;
    lastTime = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  function beginFeed(paper, mode = "strip", thumbImg = null) {
    if (reduce) {
      return {
        update() {},
        finish() {},
      };
    }

    if (dumping) {
      dumping = false;
      clearBaked();
    }

    // 生成本张纸的真实纹理源画布（180x132）
    const texture = createSheetTexture(paper, thumbImg);
    const startX = (width - PAPER_WIDTH) / 2;

    if (mode === "burn") {
      // 焚毁/碳化模式：焦黑碳化灰烬片 + 明亮橙红余烬火星
      let lastRowProgress = 0;
      const cols = 13;
      const colW = PAPER_WIDTH / cols;
      const totalRows = 12;
      const step = 1 / totalRows;

      return {
        update(progress) {
          while (progress >= lastRowProgress + step * 0.45 && lastRowProgress < 1) {
            lastRowProgress += step;
            for (let c = 0; c < cols; c += 1) {
              const x = startX + c * colW + colW * 0.5 + (Math.random() - 0.5) * 4;
              const spread = (c / (cols - 1) - 0.5) * 2;
              const toneVal = 24 + Math.floor(Math.random() * 26);
              ashes.push({
                x,
                y: SLOT_Y + 2 + Math.random() * 4,
                vx: spread * (16 + Math.random() * 28) + (Math.random() - 0.5) * 26,
                vy: 62 + Math.random() * 58,
                w: 7 + Math.random() * 8,
                h: 5 + Math.random() * 6,
                angle: (Math.random() - 0.5) * 1.4,
                va: (Math.random() - 0.5) * 6,
                heat: 0.75 + Math.random() * 0.45, // 刚出来带着灼热橙红余温，落底冷却成灰
                shade: toneVal,
                settled: false,
                restAngle: (Math.random() - 0.5) * 2.1,
              });

              // 伴随火星余烬
              if (Math.random() < 0.55) {
                embers.push({
                  x: x + (Math.random() - 0.5) * 6,
                  y: SLOT_Y + 2 + Math.random() * 6,
                  vx: spread * (24 + Math.random() * 34) + (Math.random() - 0.5) * 32,
                  vy: 30 + Math.random() * 75,
                  size: 1.4 + Math.random() * 2.1,
                  life: 0.65 + Math.random() * 0.7,
                  age: 0,
                  phase: Math.random() * Math.PI * 2,
                });
              }
            }
            notifyIfNeeded();
            ensureLoop();
          }
        },
        finish() {
          this.update(1.01);
        },
      };
    }

    if (mode === "cross") {
      let lastRowProgress = 0;
      const cols = 15;
      const colW = PAPER_WIDTH / cols;
      const srcColW = texture.width / cols;
      const totalRows = 11;
      const srcRowH = texture.height / totalRows;
      const step = 1 / totalRows;

      return {
        update(progress) {
          while (progress >= lastRowProgress + step * 0.5 && lastRowProgress < 1) {
            const rowIndex = Math.min(totalRows - 1, Math.floor(lastRowProgress * totalRows));
            // 底边先入刀口，所以从最底行 (totalRows - 1 - rowIndex) 开始往上切！
            const srcY = (totalRows - 1 - rowIndex) * srcRowH;
            lastRowProgress += step;

            for (let c = 0; c < cols; c += 1) {
              const x = startX + c * colW + colW * 0.5 + (Math.random() - 0.5) * 1.6;
              const spread = (c / (cols - 1) - 0.5) * 2;
              chips.push({
                texture,
                sx: c * srcColW,
                sy: srcY,
                sw: srcColW,
                sh: srcRowH,
                x,
                y: SLOT_Y + 2 + Math.random() * 3,
                vx: spread * (18 + Math.random() * 26) + (Math.random() - 0.5) * 22,
                vy: 105 + Math.random() * 65,
                w: colW * 0.88,
                h: 9.5 + Math.random() * 3,
                angle: (Math.random() - 0.5) * 0.7,
                va: (Math.random() - 0.5) * 8,
                flip: Math.random() * Math.PI * 2,
                vflip: 5 + Math.random() * 6,
                settled: false,
                restAngle: (Math.random() - 0.5) * 1.7,
              });
            }
            notifyIfNeeded();
            ensureLoop();
          }
        },
        finish() {
          this.update(1.01);
        },
      };
    }

    // 条切模式 (strip)：18 根真实纹理切片纸条（自然挺度 + 优雅微弧，绝不是泡面波浪）
    const count = 18;
    const colW = PAPER_WIDTH / count;
    const srcColW = texture.width / count;
    const fullLen = 78; // 真实比例细长纸条
    const session = [];

    for (let i = 0; i < count; i += 1) {
      const normX = (i / (count - 1)) * 2 - 1;
      const anchorX = startX + i * colW + colW * 0.5;

      // 真实纸张经滚轴切出后的轻微单弧弯度（只弯 3~8px，自然优雅、绝不扭成面条）
      const bendSign = i % 2 === 0 ? 1 : -1;
      const feedBend = bendSign * (2.5 + Math.random() * 4.5) + normX * 4;
      const restBend = bendSign * (5 + Math.random() * 7.5);

      const strip = {
        texture,
        sx: i * srcColW,
        sw: srcColW,
        anchorX,
        w: colW - 1.2, // 清晰的刀切间隙
        progress: 0,
        fullLen: fullLen * (0.94 + Math.random() * 0.12),
        splay: normX * (0.09 + Math.random() * 0.06) + (Math.random() - 0.5) * 0.04,
        feedBend,
        restBend,
        jitterX: 0,
      };
      session.push(strip);
      activeStrips.push(strip);
    }

    notifyIfNeeded();
    ensureLoop();

    return {
      update(progress) {
        const p = Math.max(0, Math.min(1, progress));
        for (const s of session) {
          s.progress = p;
          s.jitterX = (Math.random() - 0.5) * 0.55;
        }
      },
      finish() {
        this.update(1);
        for (const s of session) {
          const idx = activeStrips.indexOf(s);
          if (idx !== -1) activeStrips.splice(idx, 1);

          // 脱离刀口时保持当前角度和位置无缝衔接，绝不瞬移！
          const startAngle = Math.PI * 0.5 + s.splay;
          const x = s.anchorX + Math.sin(s.splay) * s.fullLen * 0.45;
          const y = SLOT_Y + s.fullLen * 0.5;
          // 落底时自然随机斜躺或横叠（±42° 到接近水平，像真实散落的一堆纸条）
          const fallSign = Math.random() < 0.5 ? -1 : 1;
          const naturalAngle = fallSign * (0.08 + Math.random() * 0.55);

          strips.push({
            texture: s.texture,
            sx: s.sx,
            sw: s.sw,
            x,
            y,
            vx: s.splay * 95 + (Math.random() - 0.5) * 48,
            vy: 68 + Math.random() * 44,
            angle: startAngle,
            targetAngle: naturalAngle,
            w: s.w,
            len: s.fullLen,
            bend: s.feedBend,
            restBend: s.restBend,
            shade: (Math.random() - 0.5) * 0.14, // 每根纸条受光角度微差
            state: "falling",
            settleT: 0,
            startSettleAngle: 0,
            startSettleY: 0,
            startSettleBend: 0,
            restY: 0,
          });
        }
        notifyIfNeeded();
      },
    };
  }

  function dump() {
    if (!totalScraps()) return;
    dumping = true;
    dumpVy = 125;
    resetFloor();

    for (const r of strips) {
      r.state = "falling";
      r.vy = 95 + Math.random() * 140;
      r.vx = (Math.random() - 0.5) * 65;
    }
    for (const c of chips) {
      c.settled = false;
      c.vy = 95 + Math.random() * 135;
      c.vx = (Math.random() - 0.5) * 65;
      c.va = (Math.random() - 0.5) * 10;
    }
    for (const a of ashes) {
      a.settled = false;
      a.vy = 95 + Math.random() * 130;
      a.vx = (Math.random() - 0.5) * 60;
    }
    ensureLoop();
  }

  // 高性能绘制带真实源图切片纹理 + 优雅微弧的纸条
  // 关键优化：动态帧彻底禁用 shadowBlur（避免每帧数百次软件高斯模糊导致卡顿），
  // 改用零开销微偏移阴影层，仅在最终烘培或单次描边时保持立体层次，稳定满帧 60fps+
  function drawRealStrip(
    targetCtx,
    { texture, sx, sw, cx, cy, angle, len, w, bend, progress = 1, fromTop = false, shade = 0, withShadow = false },
  ) {
    if (len < 2 || progress <= 0.01) return;

    const segs = 4;
    const totalSrcH = texture.height * progress;
    const srcStartY = texture.height - totalSrcH;
    const srcSegH = totalSrcH / segs;

    targetCtx.save();
    targetCtx.translate(cx, cy);
    targetCtx.rotate(angle);

    for (let i = 0; i < segs; i += 1) {
      const t0 = i / segs;
      const t1 = (i + 1) / segs;
      const tm = (t0 + t1) * 0.5;

      const u0 = fromTop ? t0 * len : (t0 - 0.5) * len;
      const u1 = fromTop ? t1 * len : (t1 - 0.5) * len;

      const y0 = fromTop ? t0 * t0 * bend : (t0 - 0.5) * (t0 - 0.5) * 4 * bend - bend * 0.5;
      const y1 = fromTop ? t1 * t1 * bend : (t1 - 0.5) * (t1 - 0.5) * 4 * bend - bend * 0.5;

      const dx = u1 - u0;
      const dy = y1 - y0;
      const segAngle = Math.atan2(dy, dx);
      const drawLen = Math.hypot(dx, dy) + 0.7;

      targetCtx.save();
      targetCtx.translate(u0, y0);
      targetCtx.rotate(segAngle - Math.PI * 0.5);

      // 零开销硬件加速接触阴影（替代昂贵的 shadowBlur）
      if (withShadow) {
        targetCtx.fillStyle = "rgba(0, 0, 0, 0.24)";
        targetCtx.fillRect(-w * 0.5 + 1.2, 1.4, w, drawLen);
      }

      // 贴上对应这一截的真实文档/图片切片
      targetCtx.drawImage(
        texture,
        sx,
        srcStartY + i * srcSegH,
        sw,
        Math.max(1, srcSegH + 0.4),
        -w * 0.5,
        0,
        w,
        drawLen,
      );

      // 真实纸面折光微差
      const lightDelta = shade + (tm - 0.45) * (bend >= 0 ? 0.14 : -0.14);
      if (lightDelta > 0.02) {
        targetCtx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.2, lightDelta)})`;
        targetCtx.fillRect(-w * 0.5, 0, w, drawLen);
      } else if (lightDelta < -0.02) {
        targetCtx.fillStyle = `rgba(12, 14, 18, ${Math.min(0.24, -lightDelta)})`;
        targetCtx.fillRect(-w * 0.5, 0, w, drawLen);
      }

      targetCtx.restore();
    }

    targetCtx.restore();
  }

  function drawChip(targetCtx, c) {
    targetCtx.save();
    targetCtx.translate(c.x, c.y);
    targetCtx.rotate(c.angle);
    const scaleY = c.settled ? 0.88 : Math.cos(c.flip);
    const absScale = Math.max(0.2, Math.abs(scaleY));
    targetCtx.scale(1, absScale);

    targetCtx.drawImage(c.texture, c.sx, c.sy, c.sw, c.sh, -c.w * 0.5, -c.h * 0.5, c.w, c.h);

    if (scaleY < 0) {
      targetCtx.fillStyle = "rgba(18, 20, 24, 0.26)";
      targetCtx.fillRect(-c.w * 0.5, -c.h * 0.5, c.w, c.h);
    }

    targetCtx.restore();
  }

  function bakeStrip(r) {
    bakedCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawRealStrip(bakedCtx, {
      texture: r.texture,
      sx: r.sx,
      sw: r.sw,
      cx: r.x,
      cy: r.y,
      angle: r.angle,
      len: r.len,
      w: r.w,
      bend: r.restBend,
      progress: 1,
      fromTop: false,
      shade: r.shade,
      withShadow: true,
    });
    bakedCount += 1;
  }

  function drawAsh(targetCtx, a, cool = false) {
    targetCtx.save();
    targetCtx.translate(a.x, a.y);
    targetCtx.rotate(a.angle);
    const v = a.shade;
    targetCtx.fillStyle = `rgb(${v}, ${v}, ${v + 3})`;
    targetCtx.beginPath();
    targetCtx.moveTo(-a.w * 0.5, -a.h * 0.35);
    targetCtx.lineTo(a.w * 0.45, -a.h * 0.5);
    targetCtx.lineTo(a.w * 0.5, a.h * 0.4);
    targetCtx.lineTo(-a.w * 0.4, a.h * 0.5);
    targetCtx.closePath();
    targetCtx.fill();

    // 未冷却前边缘发着灼热橙红余温光
    if (!cool && a.heat > 0.06) {
      targetCtx.strokeStyle = `rgba(255, 105, 32, ${Math.min(0.92, a.heat)})`;
      targetCtx.lineWidth = 1.2;
      targetCtx.stroke();
    } else {
      targetCtx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      targetCtx.lineWidth = 0.5;
      targetCtx.stroke();
    }
    targetCtx.restore();
  }

  function drawEmber(targetCtx, e) {
    const t = e.age / e.life;
    const alpha = Math.max(0, 1 - t * t);
    targetCtx.save();
    targetCtx.globalCompositeOperation = "lighter";
    const grad = targetCtx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.size * 3.2);
    grad.addColorStop(0, `rgba(255, 236, 175, ${alpha})`);
    grad.addColorStop(0.45, `rgba(255, 108, 34, ${alpha * 0.85})`);
    grad.addColorStop(1, "rgba(255, 60, 10, 0)");
    targetCtx.fillStyle = grad;
    targetCtx.beginPath();
    targetCtx.arc(e.x, e.y, e.size * 3.2, 0, Math.PI * 2);
    targetCtx.fill();
    targetCtx.restore();
  }

  function bakeAsh(a) {
    bakedCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawAsh(bakedCtx, a, true);
    bakedCount += 1;
  }

  function bakeChip(c) {
    bakedCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawChip(bakedCtx, c);
    bakedCount += 1;
  }

  function impulse(ix = 0, iy = 0, ia = 0) {
    if (reduce) return;
    // 限制冲量上限，防止大幅异常数据导致撕裂
    jiggleVx = Math.max(-140, Math.min(140, jiggleVx + ix));
    jiggleVy = Math.max(-160, Math.min(160, jiggleVy + iy));
    jiggleVa = Math.max(-0.45, Math.min(0.45, jiggleVa + ia));
    ensureLoop();
  }

  function tick(now) {
    const dt = Math.min(0.028, Math.max(0.004, (now - lastTime) / 1000));
    lastTime = now;

    const gravity = 580;
    let moving = activeStrips.length > 0;

    // 更新亚克力仓果冻晃动物理 (Spring Damper Jiggle)
    const jiggleActive =
      Math.abs(jiggleX) > 0.04 ||
      Math.abs(jiggleY) > 0.04 ||
      Math.abs(jiggleAngle) > 0.001 ||
      Math.abs(jiggleVx) > 0.08 ||
      Math.abs(jiggleVy) > 0.08 ||
      Math.abs(jiggleVa) > 0.002;

    if (jiggleActive) {
      moving = true;
      const ax = -JIGGLE_K * jiggleX - JIGGLE_DAMP * jiggleVx;
      const ay = -JIGGLE_K * jiggleY - JIGGLE_DAMP * jiggleVy;
      const aa = -JIGGLE_K_ROT * jiggleAngle - JIGGLE_DAMP_ROT * jiggleVa;

      jiggleVx += ax * dt;
      jiggleVy += ay * dt;
      jiggleVa += aa * dt;

      jiggleX += jiggleVx * dt;
      jiggleY += jiggleVy * dt;
      jiggleAngle += jiggleVa * dt;
    } else {
      jiggleX = 0;
      jiggleY = 0;
      jiggleAngle = 0;
      jiggleVx = 0;
      jiggleVy = 0;
      jiggleVa = 0;
    }

    if (dumping && bakedCount > 0) {
      moving = true;
      dumpVy += gravity * 1.45 * dt;
      dumpOffsetY += dumpVy * dt;
      if (dumpOffsetY > height + 40) {
        clearBaked();
      }
    }

    // 1. 更新下落与阻尼落稳中的真实切片纸条
    for (let i = strips.length - 1; i >= 0; i -= 1) {
      const r = strips[i];

      if (r.state === "falling") {
        moving = true;
        r.vy += gravity * dt;
        r.vx *= 0.965;
        r.vy *= 0.992;
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        // 下落中平缓朝自然斜躺角度偏转，过程流畅无突变
        r.angle += (r.targetAngle - r.angle) * Math.min(1, dt * 4.2);

        if (!dumping) {
          const minX = BIN_PADDING_X + 18;
          const maxX = width - BIN_PADDING_X - 18;
          if (r.x < minX) {
            r.x = minX;
            r.vx = Math.abs(r.vx) * 0.35;
          } else if (r.x > maxX) {
            r.x = maxX;
            r.vx = -Math.abs(r.vx) * 0.35;
          }

          const surfaceY = getSurfaceY(r.x);
          if (r.y + 8 >= surfaceY) {
            r.state = "settling";
            r.settleT = 0;
            r.startSettleAngle = r.angle;
            r.startSettleY = r.y;
            r.startSettleBend = r.bend;
            const slope = getSurfaceSlope(r.x);
            r.targetAngle = slope + (Math.random() - 0.5) * 0.58;
            r.restY = surfaceY - 2 - Math.random() * 4;
            depositVolume(r.x, 2.4, 5);
          }
        } else if (r.y > height + 90) {
          strips.splice(i, 1);
        }
      } else if (r.state === "settling") {
        moving = true;
        r.settleT = Math.min(1, r.settleT + dt / 0.14);
        const ease = 1 - Math.pow(1 - r.settleT, 3);
        r.angle = r.startSettleAngle + (r.targetAngle - r.startSettleAngle) * ease;
        r.y = r.startSettleY + (r.restY - r.startSettleY) * ease;
        r.bend = r.startSettleBend + (r.restBend - r.startSettleBend) * ease;
        if (r.settleT >= 1) {
          bakeStrip(r);
          strips.splice(i, 1);
          impulse((Math.random() - 0.5) * 5, 4.5, (Math.random() - 0.5) * 0.015);
        }
      }
    }

    // 2. 更新粒状碎纸片
    for (let i = chips.length - 1; i >= 0; i -= 1) {
      const c = chips[i];
      moving = true;
      c.vy += gravity * dt;
      c.vx *= 0.96;
      c.vy *= 0.99;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.angle += c.va * dt;
      c.flip += c.vflip * dt;

      if (!dumping) {
        const minX = BIN_PADDING_X + 6;
        const maxX = width - BIN_PADDING_X - 6;
        if (c.x < minX) {
          c.x = minX;
          c.vx = Math.abs(c.vx) * 0.35;
        } else if (c.x > maxX) {
          c.x = maxX;
          c.vx = -Math.abs(c.vx) * 0.35;
        }

        const surfaceY = getSurfaceY(c.x);
        if (c.y + c.h * 0.4 >= surfaceY) {
          c.y = surfaceY - c.h * 0.25;
          c.angle = c.restAngle;
          c.settled = true;
          depositVolume(c.x, 1.9, 3);
          bakeChip(c);
          chips.splice(i, 1);
        }
      } else if (c.y > height + 60) {
        chips.splice(i, 1);
      }
    }

    // 2.5 更新焚毁模式的焦黑灰烬片与火星余烬
    for (let i = ashes.length - 1; i >= 0; i -= 1) {
      const a = ashes[i];
      moving = true;
      a.vy += gravity * 0.58 * dt;
      a.vx += Math.sin(now * 0.005 + i) * 14 * dt;
      a.vx *= 0.96;
      a.vy *= 0.985;
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.angle += a.va * dt;
      a.heat = Math.max(0, a.heat - dt * 0.9);

      if (!dumping) {
        const minX = BIN_PADDING_X + 6;
        const maxX = width - BIN_PADDING_X - 6;
        if (a.x < minX) {
          a.x = minX;
          a.vx = Math.abs(a.vx) * 0.3;
        } else if (a.x > maxX) {
          a.x = maxX;
          a.vx = -Math.abs(a.vx) * 0.3;
        }

        const surfaceY = getSurfaceY(a.x);
        if (a.y + a.h * 0.4 >= surfaceY) {
          a.y = surfaceY - a.h * 0.2;
          a.angle = a.restAngle;
          a.settled = true;
          depositVolume(a.x, 1.45, 3);
          bakeAsh(a);
          ashes.splice(i, 1);
        }
      } else if (a.y > height + 60) {
        ashes.splice(i, 1);
      }
    }

    for (let i = embers.length - 1; i >= 0; i -= 1) {
      const e = embers[i];
      moving = true;
      e.age += dt;
      if (e.age >= e.life) {
        embers.splice(i, 1);
        continue;
      }
      e.vx += Math.sin(now * 0.012 + e.phase) * 48 * dt;
      e.vy += (40 - e.age * 160) * dt; // 先飘落，热气流微微托起
      e.vx *= 0.97;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    }

    // 3. 合成渲染
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (bakedCount > 0) {
      ctx.save();
      // 以亚克力集纸仓底部中心为支点做微幅摇晃与弹性形变
      const pivotX = width * 0.5;
      const pivotY = BIN_FLOOR_Y + dumpOffsetY;
      ctx.translate(pivotX, pivotY);
      ctx.rotate(jiggleAngle);
      ctx.translate(-pivotX + jiggleX, -pivotY + jiggleY);
      ctx.drawImage(bakedCanvas, 0, dumpOffsetY, width, height);
      ctx.restore();
    }

    for (const c of chips) drawChip(ctx, c);
    for (const a of ashes) drawAsh(ctx, a, false);

    for (const r of strips) {
      drawRealStrip(ctx, {
        texture: r.texture,
        sx: r.sx,
        sw: r.sw,
        cx: r.x,
        cy: r.y,
        angle: r.angle,
        len: r.len,
        w: r.w,
        bend: r.bend,
        progress: 1,
        fromTop: false,
        shade: r.shade,
        withShadow: false,
      });
    }

    for (const s of activeStrips) {
      drawRealStrip(ctx, {
        texture: s.texture,
        sx: s.sx,
        sw: s.sw,
        cx: s.anchorX + s.jitterX,
        cy: SLOT_Y,
        angle: Math.PI * 0.5 + s.splay,
        len: s.fullLen * s.progress,
        w: s.w,
        bend: s.feedBend * s.progress,
        progress: s.progress,
        fromTop: true,
        shade: 0,
        withShadow: false,
      });
    }

    for (const e of embers) drawEmber(ctx, e);

    if (totalScraps() > 0) {
      const isWhiteSkin =
        canvas.closest("#machine")?.dataset.skin === "white" ||
        canvas.closest("#machine")?.dataset.skin === "braun";
      const topShadow = ctx.createLinearGradient(0, 0, 0, 14);
      if (isWhiteSkin) {
        topShadow.addColorStop(0, "rgba(0, 0, 0, 0.12)");
        topShadow.addColorStop(1, "rgba(0, 0, 0, 0)");
      } else {
        topShadow.addColorStop(0, "rgba(6, 7, 9, 0.78)");
        topShadow.addColorStop(1, "rgba(6, 7, 9, 0)");
      }
      ctx.fillStyle = topShadow;
      ctx.fillRect(0, 0, width, 14);
    }

    if (dumping && !strips.length && !chips.length && !ashes.length && bakedCount === 0) {
      dumping = false;
      notifyIfNeeded();
    }

    if (moving || dumping) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = 0;
      notifyIfNeeded();
    }
  }

  resize(width, height);

  return {
    resize,
    beginFeed,
    dump,
    impulse,
    get count() {
      return totalScraps();
    },
    get fillRatio() {
      return getFillRatio();
    },
  };
}
