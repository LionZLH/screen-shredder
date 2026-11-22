// 精密机械 + ASMR 分层合成音频引擎

export function createSound() {
  let ctx = null;
  let idleSuspendTimer = 0;
  let stopCurrent = () => {};
  let stopPreheat = () => {};
  let muted = localStorage.getItem("shredder-muted") === "1";

  // 静默 3 秒自动挂起 AudioContext，释放系统 CoreAudio 硬件音频流，后台待机零耗电
  function scheduleSuspend(afterMs = 3000) {
    clearTimeout(idleSuspendTimer);
    idleSuspendTimer = setTimeout(() => {
      if (ctx && ctx.state === "running") {
        ctx.suspend().catch(() => {});
      }
    }, afterMs);
  }

  function ensureCtx(holdMs = 3000) {
    if (muted) return null;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!ctx) ctx = new AudioCtx();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    scheduleSuspend(holdMs);
    return ctx;
  }

  function makeNoiseBuffer(audio, seconds = 0.5) {
    const len = Math.floor(audio.sampleRate * seconds);
    const buf = audio.createBuffer(1, len, audio.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function setMuted(next) {
    muted = next;
    localStorage.setItem("shredder-muted", next ? "1" : "0");
    if (muted) {
      stopCurrent();
      stopPreheat();
      if (ctx && ctx.state === "running") ctx.suspend().catch(() => {});
    }
  }

  // 1. 机械微动开关 / 模式拨钮咔嗒声
  function click() {
    const audio = ensureCtx();
    if (!audio) return;
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1320, now);
    osc.frequency.exponentialRampToValueAtTime(340, now + 0.022);
    gain.gain.setValueAtTime(0.055, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(now);
    osc.stop(now + 0.03);
  }

  // 2. 纸张滑入碎纸口的轻脆“沙”摩擦声
  function slideIn() {
    const audio = ensureCtx();
    if (!audio) return;
    const now = audio.currentTime;
    const src = audio.createBufferSource();
    src.buffer = makeNoiseBuffer(audio, 0.14);
    const filter = audio.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(2400, now);
    filter.frequency.exponentialRampToValueAtTime(1200, now + 0.12);
    filter.Q.value = 1.6;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.032, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(audio.destination);
    src.start(now);
  }

  // 3. 拖拽靠近碎纸口时的滚轴空转预热待命声
  function preheat(active) {
    if (!active) {
      stopPreheat();
      return;
    }
    const audio = ensureCtx();
    if (!audio) return;
    stopPreheat();

    const now = audio.currentTime;
    const hum = audio.createOscillator();
    hum.type = "sawtooth";
    hum.frequency.setValueAtTime(34, now);
    hum.frequency.linearRampToValueAtTime(42, now + 0.18);

    const lp = audio.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 135;

    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.018, now + 0.16);

    hum.connect(lp);
    lp.connect(gain);
    gain.connect(audio.destination);
    hum.start(now);

    let done = false;
    stopPreheat = () => {
      if (done) return;
      done = true;
      try {
        const t = audio.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setTargetAtTime(0.0001, t, 0.04);
        hum.stop(t + 0.14);
      } catch {
        /* ignore */
      }
    };
  }

  // 5. 倒掉纸屑：机械活门弹开 + 整坨纸屑倾泻沙沙声
  function playDump() {
    const audio = ensureCtx();
    if (!audio) return;
    const now = audio.currentTime;

    // 活门卡扣弹开声
    const latch = audio.createOscillator();
    const latchGain = audio.createGain();
    latch.type = "triangle";
    latch.frequency.setValueAtTime(860, now);
    latch.frequency.exponentialRampToValueAtTime(220, now + 0.04);
    latchGain.gain.setValueAtTime(0.07, now);
    latchGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    latch.connect(latchGain);
    latchGain.connect(audio.destination);
    latch.start(now);
    latch.stop(now + 0.05);

    // 整堆纸屑哗啦滑落
    const dur = 0.42;
    const src = audio.createBufferSource();
    src.buffer = makeNoiseBuffer(audio, dur);
    const filter = audio.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1750, now + 0.02);
    filter.frequency.exponentialRampToValueAtTime(540, now + dur);
    filter.Q.value = 0.95;

    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.068, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(audio.destination);
    src.start(now);
  }

  // 6. 碎纸 / 焚毁主音效（支持大文件吃力顿挫 + 满载闷响 + 继电器收尾）
  function play(ms, paper = {}, mode = "strip", { heavy = false, fillRatio = 0 } = {}) {
    stopCurrent();
    stopPreheat();
    const audio = ensureCtx(ms + 3000);
    if (!audio) return;

    const now = audio.currentTime;
    const duration = Math.max(0.38, ms / 1000);
    const tail = 0.22;

    if (mode === "burn") {
      // 焚毁模式：火焰起燃低鸣 + 噼啪火星爆裂 ASMR
      const fireNoise = audio.createBufferSource();
      fireNoise.buffer = makeNoiseBuffer(audio, 0.8);
      fireNoise.loop = true;

      const fireFilter = audio.createBiquadFilter();
      fireFilter.type = "bandpass";
      fireFilter.frequency.setValueAtTime(340, now);
      fireFilter.frequency.linearRampToValueAtTime(580, now + 0.14);
      fireFilter.frequency.linearRampToValueAtTime(260, now + duration);
      fireFilter.Q.value = 0.8;

      const fireGain = audio.createGain();
      fireGain.gain.setValueAtTime(0.0001, now);
      fireGain.gain.exponentialRampToValueAtTime(0.09, now + 0.08);
      fireGain.gain.setValueAtTime(0.075, now + Math.max(0.1, duration - 0.12));
      fireGain.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.15);

      fireNoise.connect(fireFilter);
      fireFilter.connect(fireGain);
      fireGain.connect(audio.destination);
      fireNoise.start(now);

      // 随机噼啪火星爆裂点
      const crackleBuf = audio.createBuffer(1, Math.floor(audio.sampleRate * duration), audio.sampleRate);
      const ch = crackleBuf.getChannelData(0);
      for (let i = 0; i < ch.length; i += 1) {
        ch[i] = Math.random() < 0.0032 ? (Math.random() * 2 - 1) * 0.95 : 0;
      }
      const crackle = audio.createBufferSource();
      crackle.buffer = crackleBuf;
      const crackleFilter = audio.createBiquadFilter();
      crackleFilter.type = "highpass";
      crackleFilter.frequency.value = 1800;
      const crackleGain = audio.createGain();
      crackleGain.gain.value = 0.085;
      crackle.connect(crackleFilter);
      crackleFilter.connect(crackleGain);
      crackleGain.connect(audio.destination);
      crackle.start(now);

      let stopped = false;
      const end = () => {
        if (stopped) return;
        stopped = true;
        try {
          fireNoise.stop();
          crackle.stop();
        } catch {
          /* ignore */
        }
      };
      const timer = setTimeout(end, (duration + 0.2) * 1000);
      stopCurrent = () => {
        clearTimeout(timer);
        end();
      };
      return;
    }

    if (paper.kind === "matrix") {
      // 彩蛋 4：黑客帝国幽绿代码雨赛博数据流音频（极度温润轻柔，耳语级音量，绝无惊吓）
      const carrier = audio.createOscillator();
      const mod = audio.createOscillator();
      const modGain = audio.createGain();
      const masterGain = audio.createGain();
      const lowFilter = audio.createBiquadFilter();

      // 纯净柔和正弦波，低沉平静（240Hz~360Hz）
      carrier.type = "sine";
      mod.type = "sine";
      carrier.frequency.setValueAtTime(260, now);
      carrier.frequency.linearRampToValueAtTime(360, now + duration * 0.35);
      carrier.frequency.exponentialRampToValueAtTime(190, now + duration);

      mod.frequency.setValueAtTime(9, now);
      mod.frequency.linearRampToValueAtTime(22, now + duration);
      modGain.gain.setValueAtTime(35, now);

      mod.connect(modGain);
      modGain.connect(carrier.frequency);

      // 低通滤波切除 520Hz 以上频段，确保水润无刺耳高频
      lowFilter.type = "lowpass";
      lowFilter.frequency.setValueAtTime(520, now);

      // 峰值降至极其柔和的 0.015，平滑淡入淡出
      masterGain.gain.setValueAtTime(0.0001, now);
      masterGain.gain.linearRampToValueAtTime(0.015, now + 0.07);
      masterGain.gain.setValueAtTime(0.013, now + Math.max(0.07, duration - 0.08));
      masterGain.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.06);

      carrier.connect(lowFilter);
      lowFilter.connect(masterGain);
      masterGain.connect(audio.destination);

      carrier.start(now);
      mod.start(now);

      // 极轻微的微弱赛博气泡音（耳语级 0.005，只增添科幻流动感，绝不惊吓）
      const blip = audio.createOscillator();
      const blipGain = audio.createGain();
      blip.type = "sine";
      blip.frequency.setValueAtTime(440, now + 0.04);
      blip.frequency.setValueAtTime(580, now + duration * 0.35);
      blipGain.gain.setValueAtTime(0.0001, now);
      blipGain.gain.setValueAtTime(0.005, now + 0.04);
      blipGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
      blipGain.gain.setValueAtTime(0.004, now + duration * 0.35);
      blipGain.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.35 + 0.05);
      blip.connect(blipGain);
      blipGain.connect(audio.destination);
      blip.start(now);
      blip.stop(now + duration + 0.1);

      let stopped = false;
      const end = () => {
        if (stopped) return;
        stopped = true;
        try {
          carrier.stop();
          mod.stop();
          blip.stop();
        } catch {
          /* ignore */
        }
      };
      const timer = setTimeout(end, (duration + 0.12) * 1000);
      stopCurrent = () => {
        clearTimeout(timer);
        end();
      };
      return;
    }

    // 相纸 / 设计稿专属特征：咬合初始带清脆的相纸涂层破裂微声
    if (paper.kind === "photo" || paper.kind === "design") {
      const snap = audio.createBufferSource();
      snap.buffer = makeNoiseBuffer(audio, 0.035);
      const snapFilter = audio.createBiquadFilter();
      snapFilter.type = "highpass";
      snapFilter.frequency.value = 2600;
      const snapGain = audio.createGain();
      snapGain.gain.setValueAtTime(0.035, now);
      snapGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
      snap.connect(snapFilter);
      snapFilter.connect(snapGain);
      snapGain.connect(audio.destination);
      snap.start(now);
    }

    // 条切 / 粒碎：纸张撕裂噪 + 刀齿调制 + 马达低鸣（大文件带顿挫降频再爆发！）
    const isHeavyDoc = heavy || paper.kind === "kraft" || paper.kind === "folder";
    const isGridDoc = paper.kind === "grid";

    const noise = audio.createBufferSource();
    noise.buffer = makeNoiseBuffer(audio, 0.55);
    noise.loop = true;

    const filter = audio.createBiquadFilter();
    filter.type = "bandpass";
    // 集纸仓越满，声音略微沉闷，模拟箱体共鸣变化
    const muffling = 1 - fillRatio * 0.16;
    const baseBite = (paper.bite || 760) * (mode === "cross" ? 1.26 : 1.0) * muffling;
    filter.frequency.setValueAtTime(baseBite * 0.88, now);
    filter.frequency.linearRampToValueAtTime(baseBite * 1.12, now + 0.07);
    if (isHeavyDoc) {
      // 大文件/厚重牛皮纸在 36%~54% 处模拟吃力卡顿，之后猛地咬破高频爆发
      filter.frequency.setValueAtTime(baseBite * 0.62, now + duration * 0.36);
      filter.frequency.setValueAtTime(baseBite * 0.58, now + duration * 0.52);
      filter.frequency.linearRampToValueAtTime(baseBite * 1.32, now + duration * 0.6);
    }
    filter.Q.value = mode === "cross" ? 1.12 : isGridDoc ? 0.95 : 0.72;

    const lfo = audio.createOscillator();
    const lfoGain = audio.createGain();
    lfo.type = "sawtooth";
    // 表格文件赋予点钞机般的爽快高频刷刷声
    lfo.frequency.value = mode === "cross" ? 28 : isGridDoc ? 32 : 17;
    lfoGain.gain.value = 0.022;

    const noiseGain = audio.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(isHeavyDoc ? 0.088 : 0.072, now + 0.04);
    noiseGain.gain.setValueAtTime(isHeavyDoc ? 0.082 : 0.068, now + Math.max(0.06, duration - 0.09));
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    lfo.connect(lfoGain);
    lfoGain.connect(noiseGain.gain);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(audio.destination);

    // 马达低鸣（带大文件降频闷吼 + 停机惯性减速）
    const motorHz = (paper.motor || 54) * (isHeavyDoc ? 0.82 : 1);
    const motor = audio.createOscillator();
    motor.type = "sawtooth";
    motor.frequency.setValueAtTime(motorHz * 0.85, now);
    motor.frequency.linearRampToValueAtTime(motorHz * 1.04, now + 0.06);
    if (isHeavyDoc) {
      motor.frequency.linearRampToValueAtTime(motorHz * 0.66, now + duration * 0.44);
      motor.frequency.linearRampToValueAtTime(motorHz * 1.15, now + duration * 0.6);
    }
    motor.frequency.setValueAtTime(motorHz, now + duration);
    motor.frequency.exponentialRampToValueAtTime(motorHz * 0.46, now + duration + tail);

    const motorFilter = audio.createBiquadFilter();
    motorFilter.type = "lowpass";
    motorFilter.frequency.value = isHeavyDoc ? 170 : 225;

    const motorGain = audio.createGain();
    motorGain.gain.setValueAtTime(0.0001, now);
    motorGain.gain.linearRampToValueAtTime(isHeavyDoc ? 0.065 : 0.038, now + 0.05);
    motorGain.gain.setValueAtTime(isHeavyDoc ? 0.06 : 0.035, now + duration);
    motorGain.gain.exponentialRampToValueAtTime(0.0001, now + duration + tail);
    motorGain.gain.setValueAtTime(heavy ? 0.06 : 0.035, now + duration);
    motorGain.gain.exponentialRampToValueAtTime(0.0001, now + duration + tail);

    motor.connect(motorFilter);
    motorFilter.connect(motorGain);
    motorGain.connect(audio.destination);

    // 停机收尾“咔哒”继电器轻响
    const relay = audio.createOscillator();
    const relayGain = audio.createGain();
    relay.type = "triangle";
    relay.frequency.setValueAtTime(920, now + duration + tail * 0.85);
    relay.frequency.exponentialRampToValueAtTime(280, now + duration + tail * 0.85 + 0.02);
    relayGain.gain.setValueAtTime(0.0001, now);
    relayGain.gain.setValueAtTime(0.032, now + duration + tail * 0.85);
    relayGain.gain.exponentialRampToValueAtTime(0.0001, now + duration + tail * 0.85 + 0.025);
    relay.connect(relayGain);
    relayGain.connect(audio.destination);

    noise.start(now);
    lfo.start(now);
    motor.start(now);
    relay.start(now + duration + tail * 0.85);
    relay.stop(now + duration + tail * 0.85 + 0.03);

    let stopped = false;
    const end = () => {
      if (stopped) return;
      stopped = true;
      try {
        noise.stop();
        lfo.stop();
        motor.stop();
      } catch {
        /* ignore */
      }
    };

    const timer = setTimeout(end, (duration + tail + 0.06) * 1000);
    stopCurrent = () => {
      clearTimeout(timer);
      end();
    };
  }

  return {
    play,
    click,
    slideIn,
    preheat,
    playDump,
    setMuted,
    get muted() {
      return muted;
    },
  };
}
