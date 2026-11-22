// 文件缩略图生成、浏览器端真实文件读取与主色调提取

function svgDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
}

// 为预览工作台的演示文件生成高质感微缩文档/图片缩略图
export function demoThumbnailFor(item) {
  const ext = (item.ext || "").toLowerCase();
  if (item.isDir) {
    return svgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 132">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f3e2bc"/>
            <stop offset="100%" stop-color="#e3c993"/>
          </linearGradient>
        </defs>
        <rect width="180" height="132" fill="url(#bg)"/>
        <rect x="14" y="22" width="152" height="96" rx="6" fill="#fffdf8" stroke="#c8ab72" stroke-width="1.5"/>
        <rect x="24" y="34" width="60" height="44" rx="4" fill="#2c3e50"/>
        <circle cx="42" cy="50" r="7" fill="#f39c12"/>
        <path d="M24 72 L46 54 L62 66 L72 58 L84 72 Z" fill="#1abc9c" opacity="0.85"/>
        <rect x="94" y="36" width="60" height="7" rx="3" fill="#475569"/>
        <rect x="94" y="49" width="48" height="5" rx="2.5" fill="#94a3b8"/>
        <rect x="94" y="59" width="54" height="5" rx="2.5" fill="#cbd5e1"/>
        <rect x="94" y="69" width="38" height="5" rx="2.5" fill="#cbd5e1"/>
        <rect x="24" y="88" width="130" height="6" rx="3" fill="#e2e8f0"/>
        <rect x="24" y="100" width="96" height="6" rx="3" fill="#e2e8f0"/>
      </svg>
    `);
  }

  if (ext === "pdf") {
    return svgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 132">
        <rect width="180" height="132" fill="#fbf6f2"/>
        <rect x="0" y="0" width="180" height="24" fill="#c84237"/>
        <rect x="14" y="34" width="92" height="8" rx="2" fill="#3a2522"/>
        <rect x="14" y="49" width="152" height="4" rx="2" fill="#cbb7b0"/>
        <rect x="14" y="58" width="144" height="4" rx="2" fill="#cbb7b0"/>
        <rect x="14" y="67" width="128" height="4" rx="2" fill="#cbb7b0"/>
        <rect x="14" y="80" width="152" height="4" rx="2" fill="#d9c8c2"/>
        <rect x="14" y="89" width="110" height="4" rx="2" fill="#d9c8c2"/>
        <rect x="14" y="102" width="76" height="4" rx="2" fill="#d9c8c2"/>
        <!-- 合同红色印章 -->
        <g transform="translate(136, 98)" opacity="0.82">
          <circle r="19" fill="none" stroke="#d13b30" stroke-width="2.2" stroke-dasharray="3 1.5"/>
          <circle r="14" fill="none" stroke="#d13b30" stroke-width="1"/>
          <polygon points="0,-7 2,-2 7,-2 3,1 4.5,6 0,3 -4.5,6 -3,1 -7,-2 -2,-2" fill="#d13b30"/>
        </g>
      </svg>
    `);
  }

  if (ext === "xlsx" || ext === "xls" || ext === "csv") {
    return svgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 132">
        <rect width="180" height="132" fill="#f3faf5"/>
        <rect x="0" y="0" width="180" height="24" fill="#1f7a49"/>
        <!-- 表格线 -->
        <g stroke="#bfe0cb" stroke-width="1">
          <line x1="0" y1="42" x2="180" y2="42"/>
          <line x1="0" y1="60" x2="180" y2="60"/>
          <line x1="0" y1="78" x2="180" y2="78"/>
          <line x1="0" y1="96" x2="180" y2="96"/>
          <line x1="0" y1="114" x2="180" y2="114"/>
          <line x1="56" y1="24" x2="56" y2="132"/>
          <line x1="118" y1="24" x2="118" y2="132"/>
        </g>
        <!-- 数据柱状条 -->
        <rect x="12" y="30" width="32" height="6" rx="2" fill="#2d6a4f" opacity="0.5"/>
        <rect x="64" y="30" width="42" height="6" rx="2" fill="#2d6a4f" opacity="0.4"/>
        <rect x="126" y="30" width="36" height="6" rx="2" fill="#2d6a4f" opacity="0.4"/>
        <rect x="12" y="48" width="28" height="5" rx="2" fill="#52796f" opacity="0.45"/>
        <rect x="64" y="48" width="36" height="5" rx="2" fill="#1f7a49"/>
        <rect x="126" y="48" width="24" height="5" rx="2" fill="#40916c"/>
        <rect x="12" y="66" width="34" height="5" rx="2" fill="#52796f" opacity="0.45"/>
        <rect x="64" y="66" width="46" height="5" rx="2" fill="#2d6a4f"/>
        <rect x="126" y="66" width="38" height="5" rx="2" fill="#52b788"/>
        <rect x="12" y="84" width="26" height="5" rx="2" fill="#52796f" opacity="0.45"/>
        <rect x="64" y="84" width="28" height="5" rx="2" fill="#40916c"/>
        <rect x="126" y="84" width="42" height="5" rx="2" fill="#1f7a49"/>
        <rect x="12" y="102" width="30" height="5" rx="2" fill="#52796f" opacity="0.45"/>
        <rect x="64" y="102" width="40" height="5" rx="2" fill="#52b788"/>
        <rect x="126" y="102" width="30" height="5" rx="2" fill="#2d6a4f"/>
      </svg>
    `);
  }

  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp") {
    return svgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 132">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#1e3a5f"/>
            <stop offset="52%" stop-color="#d97742"/>
            <stop offset="100%" stop-color="#f6c278"/>
          </linearGradient>
        </defs>
        <rect width="180" height="132" fill="url(#sky)"/>
        <circle cx="126" cy="48" r="18" fill="#fff3c4" opacity="0.92"/>
        <path d="M0 92 Q45 58 96 86 T180 78 L180 132 L0 132 Z" fill="#2a3950" opacity="0.82"/>
        <path d="M0 108 Q60 80 122 104 T180 96 L180 132 L0 132 Z" fill="#162133"/>
        <rect x="12" y="12" width="44" height="10" rx="5" fill="#ffffff" opacity="0.24"/>
      </svg>
    `);
  }

  return null;
}

// 浏览器预览模式：当用户拖入本地真实图片或文本文件时，读取真实缩略图或文本内容
export async function extractBrowserPreview(file) {
  const ext = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "";
  const isImage = file.type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext);

  if (isImage && file.size <= 12 * 1024 * 1024) {
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      return { thumbnail: String(dataUrl), snippet: null };
    } catch {
      return { thumbnail: null, snippet: null };
    }
  }

  const textExts = ["txt", "md", "json", "js", "ts", "css", "html", "py", "rs", "csv", "yml", "yaml", "log"];
  if (file.type.startsWith("text/") || textExts.includes(ext)) {
    try {
      const slice = file.slice(0, 360);
      const text = (await slice.text()).trim();
      return { thumbnail: null, snippet: text || null };
    } catch {
      return { thumbnail: null, snippet: null };
    }
  }

  return { thumbnail: null, snippet: null };
}

// 从缩略图提取真实主色调，让下方切出的柔软纸条颜色与图片画面一致
export function sampleThumbnailColors(dataUrl) {
  if (!dataUrl) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const size = 20;
        const c = document.createElement("canvas");
        c.width = size;
        c.height = size;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let count = 0;
        let bestSat = -1;
        let ar = 200;
        let ag = 140;
        let ab = 90;

        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          rSum += r;
          gSum += g;
          bSum += b;
          count += 1;

          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const sat = max - min;
          if (sat > bestSat && max > 45 && min < 230) {
            bestSat = sat;
            ar = r;
            ag = g;
            ab = b;
          }
        }

        if (!count) {
          resolve(null);
          return;
        }

        const toHex = (r, g, b) =>
          `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

        // 纸条底色提亮柔和一点，保留真实主色氛围
        const avgR = Math.round((rSum / count) * 0.72 + 245 * 0.28);
        const avgG = Math.round((gSum / count) * 0.72 + 242 * 0.28);
        const avgB = Math.round((bSum / count) * 0.72 + 236 * 0.28);

        resolve({
          tone: toHex(avgR, avgG, avgB),
          accent: bestSat > 24 ? toHex(ar, ag, ab) : toHex(avgR * 0.8, avgG * 0.8, avgB * 0.8),
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
