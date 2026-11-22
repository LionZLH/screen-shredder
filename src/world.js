import Matter from "matter-js";

export function createWorld(canvas) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const engine = Matter.Engine.create({ gravity: { x: 0, y: 1.25 } });
  const ctx = canvas.getContext("2d");
  const alive = [];
  const dying = [];
  let bounds = [];
  let width = 1;
  let height = 1;
  let dpr = 1;
  let last = performance.now();

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
  }

  function shade(hex, amount) {
    const n = Number.parseInt(hex.slice(1), 16);
    const channel = (value) => Math.max(0, Math.min(255, value + amount));
    return `rgb(${channel((n >> 16) & 255)}, ${channel((n >> 8) & 255)}, ${channel(n & 255)})`;
  }

  function drawStrip(body) {
    const { color, ink, w, h, tear } = body.paper;
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 0.8, -h / 2);
    ctx.lineTo(w / 2 - 0.4, -h / 2 + 0.6);
    ctx.lineTo(w / 2, h / 2 - 1);
    for (let i = tear.length - 1; i >= 0; i -= 1) {
      const x = w / 2 - (w * (tear.length - i)) / tear.length;
      ctx.lineTo(x, h / 2 + tear[i]);
    }
    ctx.closePath();
    const grain = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    grain.addColorStop(0, shade(color, -34));
    grain.addColorStop(0.16, color);
    grain.addColorStop(0.78, color);
    grain.addColorStop(1, shade(color, -42));
    ctx.fillStyle = grain;
    ctx.fill();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(-w / 2 + 1.2, -h / 2 + 1, 0.8, h - 3);
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let y = -h / 2 + 7; y < h / 2 - 4; y += 6) {
      ctx.moveTo(-w / 2 + 2.5, y);
      ctx.lineTo(w / 2 - 2.5, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function purge(list) {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i].position.y > height + 60) {
        Matter.Composite.remove(engine.world, list[i]);
        list.splice(i, 1);
      }
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(34, now - last);
    last = now;
    if (!alive.length && !dying.length) return;
    Matter.Engine.update(engine, dt);
    purge(alive);
    purge(dying);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const body of alive) drawStrip(body);
    for (const body of dying) drawStrip(body);
  }

  function clearBounds() {
    for (const body of bounds) Matter.Composite.remove(engine.world, body);
    bounds = [];
  }

  function setTray(rect) {
    if (reduce) return;
    clearBounds();
    const floor = Matter.Bodies.rectangle(rect.cx, rect.y + 5, rect.w, 10, {
      isStatic: true,
      friction: 0.9,
    });
    const left = Matter.Bodies.rectangle(rect.cx - rect.w / 2, rect.y - 60, 12, 140, {
      isStatic: true,
    });
    const right = Matter.Bodies.rectangle(rect.cx + rect.w / 2, rect.y - 60, 12, 140, {
      isStatic: true,
    });
    bounds = [floor, left, right];
    Matter.Composite.add(engine.world, bounds);
  }

  function spawn(x, y, color, ink) {
    if (reduce) return;
    const w = 13 + Math.random() * 6;
    const h = 38 + Math.random() * 36;
    const body = Matter.Bodies.rectangle(x + (Math.random() - 0.5) * 14, y, w, h, {
      friction: 0.62,
      restitution: 0.05,
      chamfer: { radius: 0.6 },
      angle: (Math.random() - 0.5) * 0.55,
    });
    body.paper = {
      color,
      ink,
      w,
      h,
      tear: Array.from({ length: 5 }, () => (Math.random() - 0.45) * 2.4),
    };
    Matter.Body.setVelocity(body, {
      x: (Math.random() - 0.5) * 1.6,
      y: 1.4 + Math.random() * 1.8,
    });
    Matter.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.18);
    Matter.Composite.add(engine.world, body);
    alive.push(body);
    while (alive.length > 64) {
      const old = alive.shift();
      Matter.Composite.remove(engine.world, old);
    }
  }

  function dump() {
    const falling = alive.splice(0, alive.length);
    clearBounds();
    for (const body of falling) {
      Matter.Body.setVelocity(body, {
        x: (Math.random() - 0.5) * 2.5,
        y: 7 + Math.random() * 3,
      });
      Matter.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.3);
      dying.push(body);
    }
    setTimeout(() => {
      for (const body of falling) {
        Matter.Composite.remove(engine.world, body);
        const index = dying.indexOf(body);
        if (index >= 0) dying.splice(index, 1);
      }
    }, 900);
  }

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(frame);

  return {
    spawn,
    setTray,
    dump,
    count: () => alive.length,
  };
}
