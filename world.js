/* =========================================================
   world.js — 2D 메타버스 오피스 엔진
   ---------------------------------------------------------
   · 캔버스 카메라 · 키보드/클릭/터치 이동 · 충돌
   · 다른 피클 위치 보간 · 말풍선 · 사운드
   · art.js(OfficeArt) 가 그리는 픽셀 월드를 사용합니다.
   ========================================================= */

(function () {
  "use strict";

  const Art = window.OfficeArt;
  const W = Art.W;
  const H = Art.H;
  const SS = 2;                 // 정적 배경 슈퍼샘플링
  const SPEED = 152;            // 월드 px / 초
  const RADIUS = 8;
  const SYNC_MS = 260;

  let canvas = null;
  let ctx = null;
  let dpr = 1;
  let staticCanvas = null;
  let staticReady = false;

  const view = { scale: 1, camX: 0, camY: 0, follow: false, w: 0, h: 0 };
  const agents = new Map();
  let meId = null;
  let meReady = false;

  const me = {
    x: 300, y: 318, target: null, path: [], walkT: 0, moving: false,
    facing: 1, zone: "workspace", blocked: 0
  };

  const keys = new Set();
  const bubbles = [];
  const motes = [];
  const puffs = [];
  const seen = new Map();
  let lastPuff = 0;

  let cbs = {};
  let raf = 0;
  let last = 0;
  let running = false;
  let lastSync = 0;
  let lastSyncX = 0;
  let lastSyncY = 0;
  let lastSyncZone = "";
  let soundOn = false;
  let actx = null;
  let lastStepSound = 0;

  /* ---------------- 유틸 ---------------- */

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function px(g, x, y, w, h, c) {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  }

  function roundRect(g, x, y, w, h, r, fill) {
    const rr = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.lineTo(x + w - rr, y);
    g.quadraticCurveTo(x + w, y, x + w, y + rr);
    g.lineTo(x + w, y + h - rr);
    g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    g.lineTo(x + rr, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - rr);
    g.lineTo(x, y + rr);
    g.quadraticCurveTo(x, y, x + rr, y);
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
  }

  function circleRect(cx, cy, r, rect) {
    const nx = clamp(cx, rect.x, rect.x + rect.w);
    const ny = clamp(cy, rect.y, rect.y + rect.h);
    const dx = cx - nx;
    const dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  function hits(x, y) {
    if (x < 28 + RADIUS || x > 1252 - RADIUS || y < 28 + RADIUS || y > 732 - RADIUS) return true;
    const list = Art.OBSTACLES;
    for (let i = 0; i < list.length; i++) {
      if (circleRect(x, y, RADIUS - 1, list[i])) return true;
    }
    return false;
  }

  function zoneAt(x, y) {
    const order = Art.ROOM_ORDER;
    for (let i = 0; i < order.length; i++) {
      const r = Art.ROOMS[order[i]].rect;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return order[i];
    }
    return "hallway";
  }

  function displayZone(zone) {
    return zone === "hallway" ? "복도" : (Art.ROOMS[zone] ? Art.ROOMS[zone].name : "복도");
  }

  function roomKeyAt(x, y) {
    const order = Art.ROOM_ORDER;
    for (let i = 0; i < order.length; i++) {
      const r = Art.ROOMS[order[i]].rect;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return order[i];
    }
    return "hallway";
  }

  /* ---------------- 문 · 복도 길찾기 ---------------- */

  const CORRIDOR = {
    ws: { x: 315, y: 370 },
    mt: { x: 955, y: 370 },
    lg: { x: 315, y: 384 },
    aw: { x: 955, y: 384 },
    xl: { x: 644, y: 370 },
    xb: { x: 644, y: 596 },
    lgs: { x: 634, y: 596 },
    aws: { x: 654, y: 596 }
  };
  const CORR_EDGES = [
    ["ws", "xl"], ["mt", "xl"], ["lg", "ws"], ["aw", "mt"],
    ["xl", "xb"], ["xb", "lgs"], ["xb", "aws"]
  ];
  const GATES = {
    workspace: [{ node: "ws", inside: { x: 315, y: 318 }, outside: { x: 315, y: 370 } }],
    meeting: [{ node: "mt", inside: { x: 955, y: 318 }, outside: { x: 955, y: 370 } }],
    lounge: [
      { node: "lg", inside: { x: 315, y: 424 }, outside: { x: 315, y: 384 } },
      { node: "lgs", inside: { x: 592, y: 596 }, outside: { x: 634, y: 596 } }
    ],
    away: [
      { node: "aw", inside: { x: 955, y: 424 }, outside: { x: 955, y: 384 } },
      { node: "aws", inside: { x: 700, y: 596 }, outside: { x: 654, y: 596 } }
    ]
  };

  function neighbours(node) {
    const out = [];
    CORR_EDGES.forEach(function (e) {
      if (e[0] === node) out.push(e[1]);
      if (e[1] === node) out.push(e[0]);
    });
    return out;
  }

  function bfs(fromNodes, toNodes) {
    const queue = [];
    const prev = {};
    fromNodes.forEach(function (n) { prev[n] = null; queue.push(n); });
    while (queue.length) {
      const cur = queue.shift();
      if (toNodes.indexOf(cur) >= 0) {
        const path = [];
        let at = cur;
        while (at) { path.unshift(at); at = prev[at]; }
        return path;
      }
      neighbours(cur).forEach(function (next) {
        if (prev.hasOwnProperty(next)) return;
        prev[next] = cur;
        queue.push(next);
      });
    }
    return null;
  }

  function nearestCorridor(x, y) {
    let best = "xl";
    let dist = Infinity;
    Object.keys(CORRIDOR).forEach(function (k) {
      const n = CORRIDOR[k];
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < dist) { dist = d; best = k; }
    });
    return best;
  }

  function buildPath(tx, ty) {
    const from = roomKeyAt(me.x, me.y);
    const to = roomKeyAt(tx, ty);
    const target = { x: clamp(tx, 40, W - 40), y: clamp(ty, 40, H - 40) };
    if (from === to) return [target];

    const startGates = GATES[from] || [{
      node: nearestCorridor(me.x, me.y), inside: null, outside: CORRIDOR[nearestCorridor(me.x, me.y)]
    }];
    const endGates = GATES[to] || [{
      node: nearestCorridor(tx, ty), inside: null, outside: CORRIDOR[nearestCorridor(tx, ty)]
    }];

    let bestPath = null;
    let bestStart = null;
    let bestEnd = null;
    startGates.forEach(function (g1) {
      endGates.forEach(function (g2) {
        const nodes = bfs([g1.node], [g2.node]);
        if (!nodes) return;
        const px = (g1.inside ? Math.hypot(g1.inside.x - me.x, g1.inside.y - me.y) : 0);
        const score = nodes.length * 100 + px;
        if (!bestPath || score < bestPath.score) {
          bestPath = { score: score, nodes: nodes };
          bestStart = g1;
          bestEnd = g2;
        }
      });
    });

    if (!bestPath) return [target];

    const pts = [];
    if (bestStart.inside) pts.push(bestStart.inside);
    if (bestStart.outside) pts.push(bestStart.outside);
    bestPath.nodes.forEach(function (key) {
      if (key === bestStart.node) return;
      if (key === bestEnd.node) return;
      pts.push(CORRIDOR[key]);
    });
    if (bestEnd.outside) pts.push(bestEnd.outside);
    if (bestEnd.inside) pts.push(bestEnd.inside);
    pts.push(target);

    // 가까운 중복 지점 정리
    const clean = [];
    pts.forEach(function (p) {
      const last = clean[clean.length - 1];
      if (last && Math.hypot(last.x - p.x, last.y - p.y) < 8) return;
      clean.push(p);
    });
    return clean;
  }

  /* ---------------- 사운드 ---------------- */

  function ensureAudio() {
    if (actx) return actx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    } catch (e) { actx = null; }
    return actx;
  }

  function blip(freq, dur, type, gain) {
    if (!soundOn) return;
    const ac = ensureAudio();
    if (!ac) return;
    try {
      if (ac.state === "suspended") ac.resume();
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type || "square";
      o.frequency.value = freq;
      g.gain.value = 0.0001;
      o.connect(g);
      g.connect(ac.destination);
      const now = ac.currentTime;
      g.gain.exponentialRampToValueAtTime(gain || 0.05, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + (dur || 0.09));
      o.start(now);
      o.stop(now + (dur || 0.09) + 0.02);
    } catch (e) { /* ignore */ }
  }

  function stepSound() {
    if (!soundOn) return;
    const now = performance.now();
    if (now - lastStepSound < 260) return;
    lastStepSound = now;
    blip(190 + Math.random() * 40, 0.05, "triangle", 0.025);
  }

  /* ---------------- 정적 배경 ---------------- */

  function buildStatic() {
    staticCanvas = document.createElement("canvas");
    staticCanvas.width = W * SS;
    staticCanvas.height = H * SS;
    const g = staticCanvas.getContext("2d");
    g.setTransform(SS, 0, 0, SS, 0, 0);
    g.imageSmoothingEnabled = false;
    Art.paint(g);
    staticReady = true;
  }

  /* ---------------- 크기/카메라 ---------------- */

  function resize() {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || window.innerWidth;
    const cssH = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    view.w = cssW;
    view.h = cssH;

    const fit = Math.min(cssW / W, cssH / H);
    if (fit >= 0.56) {
      view.scale = fit;
      view.follow = false;
    } else {
      view.scale = Math.min(cssW / 720, cssH / 660);
      view.follow = true;
    }
    if (ctx) ctx.imageSmoothingEnabled = false;
  }

  function computeCamera() {
    const vw = view.w / view.scale;
    const vh = view.h / view.scale;
    if (view.follow) {
      view.camX = vw >= W ? (W - vw) / 2 : clamp(me.x - vw / 2, 0, W - vw);
      view.camY = vh >= H ? (H - vh) / 2 : clamp(me.y - vh / 2, 0, H - vh);
    } else {
      view.camX = (W - vw) / 2;
      view.camY = (H - vh) / 2;
    }
  }

  /* ---------------- 에이전트 ---------------- */

  function setAgents(map) {
    const source = map || {};
    const ids = Object.keys(source);
    const keep = new Set(ids);

    ids.forEach(function (id) {
      const data = Object.assign({ id: id }, source[id] || {});
      let x = Number(data.x);
      let y = Number(data.y);
      if (!isFinite(x) || !isFinite(y) || x < 0 || x > W || y < 0 || y > H) {
        const seat = Art.seatFor(data);
        x = seat.x;
        y = seat.y;
      }
      const prev = agents.get(id);
      if (prev) {
        prev.data = data;
        prev.tx = x;
        prev.ty = y;
      } else {
        agents.set(id, {
          id: id, data: data, x: x, y: y, tx: x, ty: y,
          walkT: Math.random() * 8, moving: false
        });
      }
    });

    agents.forEach(function (a, id) {
      if (!keep.has(id)) agents.delete(id);
    });

    if (meId && !meReady) {
      const mine = agents.get(meId);
      if (mine) {
        me.x = mine.tx;
        me.y = mine.ty;
        me.zone = zoneAt(me.x, me.y);
        meReady = true;
      }
    }
  }

  function setMe(id) {
    meId = id || null;
    meReady = false;
    if (!meId) {
      me.target = null;
      me.path = [];
      keys.clear();
      return;
    }
    const mine = agents.get(meId);
    if (mine) {
      me.x = mine.tx;
      me.y = mine.ty;
      me.zone = zoneAt(me.x, me.y);
      meReady = true;
    } else {
      const spawn = Art.spawnFor("workspace");
      me.x = spawn.x;
      me.y = spawn.y;
      me.zone = "workspace";
      meReady = false;   // 첫 agents 스냅샷에서 DB 좌표로 자리 잡습니다
    }
    lastSyncX = -1;
    lastSyncY = -1;
    lastSyncZone = "";
  }

  /* ---------------- 이동 ---------------- */

  function tryMove(dx, dy) {
    let moved = false;
    if (dx) {
      const nx = me.x + dx;
      if (!hits(nx, me.y)) { me.x = nx; moved = true; }
    }
    if (dy) {
      const ny = me.y + dy;
      if (!hits(me.x, ny)) { me.y = ny; moved = true; }
    }
    return moved;
  }

  function updateMe(dt) {
    let vx = 0;
    let vy = 0;
    if (keys.has("left")) vx -= 1;
    if (keys.has("right")) vx += 1;
    if (keys.has("up")) vy -= 1;
    if (keys.has("down")) vy += 1;

    if (vx || vy) {
      me.target = null;
      me.path = [];
    } else if (me.target) {
      const dx = me.target.x - me.x;
      const dy = me.target.y - me.y;
      const d = Math.hypot(dx, dy);
      if (d < 6) {
        if (me.path && me.path.length) {
          me.target = me.path.shift();
        } else {
          me.target = null;
        }
      } else {
        vx = dx / d;
        vy = dy / d;
      }
    }

    const movingNow = !!(vx || vy);
    me.moving = movingNow;

    if (movingNow) {
      const len = Math.hypot(vx, vy) || 1;
      vx /= len;
      vy /= len;
      const dist = SPEED * dt;
      const ok = tryMove(vx * dist, vy * dist);
      if (!ok) {
        me.blocked += dt;
        if (me.blocked > 0.5 && me.target) {
          if (me.path && me.path.length > 1) {
            me.target = me.path.shift();
            me.blocked = 0;
          } else {
            me.target = null;
            me.path = [];
            me.moving = false;
          }
        }
      } else {
        me.blocked = 0;
        me.walkT += dt;
        if (Math.abs(vx) > 0.2) me.facing = vx > 0 ? 1 : -1;
        stepSound();
        const nowMs = performance.now();
        if (nowMs - lastPuff > 240) {
          lastPuff = nowMs;
          puffs.push({
            x: me.x + (Math.random() * 8 - 4),
            y: me.y - 1,
            born: nowMs
          });
          if (puffs.length > 24) puffs.shift();
        }
      }
    } else {
      me.blocked = 0;
    }

    const zone = zoneAt(me.x, me.y);
    if (zone !== me.zone) {
      me.zone = zone;
      if (cbs.onZone) {
        try { cbs.onZone(zone, displayZone(zone)); } catch (e) { console.error(e); }
      }
      syncPosition(true);
    } else {
      syncPosition(false);
    }
  }

  function syncPosition(force) {
    if (!meId || !cbs.onSync) return;
    const now = performance.now();
    const x = Math.round(me.x);
    const y = Math.round(me.y);
    const changed = x !== lastSyncX || y !== lastSyncY || me.zone !== lastSyncZone;
    if (!changed && !force) return;
    if (!force && now - lastSync < SYNC_MS) return;
    if (!changed) return;
    lastSync = now;
    lastSyncX = x;
    lastSyncY = y;
    lastSyncZone = me.zone;
    try { cbs.onSync({ x: x, y: y, zone: me.zone }); } catch (e) { console.error(e); }
  }

  function teleport(zone) {
    const spawn = Art.spawnFor(zone || "workspace");
    me.x = spawn.x;
    me.y = spawn.y;
    me.target = null;
    me.path = [];
    me.zone = zoneAt(me.x, me.y);
    me.walkT += 0.2;
    meReady = true;
    syncPosition(true);
    if (cbs.onZone) cbs.onZone(me.zone, displayZone(me.zone));
    blip(660, 0.08, "square", 0.04);
    setTimeout(function () { blip(880, 0.08, "square", 0.03); }, 70);
  }

  function moveToward(x, y) {
    const pts = buildPath(x, y);
    if (!pts.length) return;
    me.target = pts[0];
    me.path = pts.slice(1);
    me.blocked = 0;
    me.marker = { x: clamp(x, 40, W - 40), y: clamp(y, 40, H - 40), until: performance.now() + 900 };
  }

  function hold(dir, on) {
    if (on) keys.add(dir); else keys.delete(dir);
    if (on) {
      // 사용자 상호작용으로 오디오 잠금 해제
      const ac = ensureAudio();
      if (ac && ac.state === "suspended" && soundOn) { try { ac.resume(); } catch (e) {} }
    }
  }

  /* ---------------- 말풍선 ---------------- */

  function bubble(agentId, text, kind) {
    if (!agentId || !text) return;
    const now = performance.now();
    const body = String(text).slice(0, 160);
    const dur = kind === "emoji" ? 3400 : Math.min(12000, 3000 + body.length * 60);
    for (let i = bubbles.length - 1; i >= 0; i--) {
      if (bubbles[i].agentId === agentId) bubbles.splice(i, 1);
    }
    bubbles.push({ agentId: agentId, text: body, kind: kind || "chat", start: now, until: now + dur });
    if (bubbles.length > 8) bubbles.shift();
  }

  /* ---------------- 입력 ---------------- */

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
  }

  function onKeyDown(e) {
    if (isTypingTarget(e.target)) return;
    if (document.querySelector("dialog[open]")) return;
    if (!meId) return;
    const k = e.key;
    let dir = null;
    if (k === "ArrowUp" || k === "w" || k === "W") dir = "up";
    else if (k === "ArrowDown" || k === "s" || k === "S") dir = "down";
    else if (k === "ArrowLeft" || k === "a" || k === "A") dir = "left";
    else if (k === "ArrowRight" || k === "d" || k === "D") dir = "right";
    if (dir) {
      e.preventDefault();
      hold(dir, true);
    }
  }

  function onKeyUp(e) {
    const k = e.key;
    let dir = null;
    if (k === "ArrowUp" || k === "w" || k === "W") dir = "up";
    else if (k === "ArrowDown" || k === "s" || k === "S") dir = "down";
    else if (k === "ArrowLeft" || k === "a" || k === "A") dir = "left";
    else if (k === "ArrowRight" || k === "d" || k === "D") dir = "right";
    if (dir) hold(dir, false);
  }

  function onPointerDown(e) {
    if (!canvas) return;
    if (e.button !== undefined && e.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    const wx = (e.clientX - rect.left) / view.scale + view.camX;
    const wy = (e.clientY - rect.top) / view.scale + view.camY;

    // 다른 피클 클릭
    let picked = null;
    let best = 26;
    agents.forEach(function (a, id) {
      const dx = wx - a.x;
      const dy = wy - (a.y - 22);
      const d = Math.hypot(dx, dy);
      if (d < best) { best = d; picked = id; }
    });
    if (picked) {
      if (cbs.onPickAgent) cbs.onPickAgent(picked);
      return;
    }
    if (meId) moveToward(wx, wy);
  }

  /* ---------------- 그리기 ---------------- */

  function drawZoneBadge(g, x, y, icon, t) {
    const bob = Math.sin(t * 2.2 + x * 0.01) * 3;
    g.save();
    g.globalAlpha = 0.9;
    roundRect(g, x - 15, y - 15 + bob, 30, 26, 8, "rgba(20,14,32,0.72)");
    g.strokeStyle = "rgba(255,209,102,0.75)";
    g.lineWidth = 1.5;
    roundRect(g, x - 15, y - 15 + bob, 30, 26, 8, null);
    g.stroke();
    g.font = "15px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#fff";
    g.fillText(icon, x, y - 1 + bob);
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.restore();
  }

  function wrapText(g, text, maxW) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = "";
    words.forEach(function (word) {
      const test = line ? line + " " + word : word;
      if (g.measureText(test).width <= maxW || !line) {
        line = test;
      } else {
        lines.push(line);
        line = word;
      }
    });
    if (line) lines.push(line);
    if (lines.length > 3) {
      const extra = lines.splice(2);
      lines[2] = extra.join(" ").slice(0, 40) + "…";
    }
    return lines;
  }

  function drawBubble(g, b, agent, now) {
    const remain = b.until - now;
    if (remain <= 0) return;
    const rise = Math.min(1, (now - b.start) / 180);
    const alpha = remain < 350 ? remain / 350 : 1;
    const emoji = b.kind === "emoji";
    const x = agent.x;
    const baseY = agent.y - 72 - rise * 4 - Math.sin(now / 340) * 1.5;

    g.save();
    g.globalAlpha = alpha;

    if (emoji) {
      g.font = "22px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(b.text, x, baseY);
      // 반짝이
      g.globalAlpha = alpha * 0.8;
      g.fillStyle = "#ffe9a7";
      const sp = (now / 220) % 1;
      px(g, x - 16 - sp * 6, baseY - 8 - sp * 6, 2, 2, "#ffe9a7");
      px(g, x + 14 + sp * 6, baseY - 2 - sp * 5, 2, 2, "#fff");
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
      g.restore();
      return;
    }

    g.font = "11px 'DungGeunMo','Malgun Gothic',sans-serif";
    const lines = wrapText(g, b.text, 132);
    let tw = 0;
    lines.forEach(function (l) { tw = Math.max(tw, g.measureText(l).width); });
    const boxW = Math.max(44, tw + 18);
    const boxH = lines.length * 14 + 12;
    const bx = x - boxW / 2;
    const by = baseY - boxH;

    // 꼬리
    g.beginPath();
    g.moveTo(x - 5, by + boxH - 1);
    g.lineTo(x + 5, by + boxH - 1);
    g.lineTo(x, by + boxH + 7);
    g.closePath();
    g.fillStyle = "#241a36";
    g.fill();
    g.beginPath();
    g.moveTo(x - 3, by + boxH - 2);
    g.lineTo(x + 3, by + boxH - 2);
    g.lineTo(x, by + boxH + 4);
    g.closePath();
    g.fillStyle = "#fdf7ea";
    g.fill();

    roundRect(g, bx, by, boxW, boxH, 7, "#241a36");
    roundRect(g, bx + 2, by + 2, boxW - 4, boxH - 4, 6, "#fdf7ea");

    g.fillStyle = "#2b2142";
    g.textAlign = "center";
    lines.forEach(function (l, i) {
      g.fillText(l, x, by + 15 + i * 14);
    });
    g.textAlign = "left";
    g.restore();
  }

  function drawAmbient(g, now) {
    if (!motes.length) {
      for (let i = 0; i < 34; i++) {
        motes.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: Math.random() * 1.6 + 0.6,
          sp: Math.random() * 6 + 3,
          ph: Math.random() * Math.PI * 2
        });
      }
    }
    g.save();
    motes.forEach(function (m) {
      const y = (m.y - (now / 1000) * m.sp) % H;
      const yy = y < 0 ? y + H : y;
      const a = 0.10 + 0.12 * (Math.sin(now / 900 + m.ph) * 0.5 + 0.5);
      g.globalAlpha = a;
      g.fillStyle = "#fff3cf";
      g.beginPath();
      g.arc(m.x + Math.sin(now / 2200 + m.ph) * 14, yy, m.r, 0, Math.PI * 2);
      g.fill();
    });
    g.restore();
  }

  function draw(now) {
    if (!ctx || !canvas) return;
    computeCamera();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0f0a18";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const s = view.scale * dpr;
    ctx.setTransform(s, 0, 0, s, -view.camX * s, -view.camY * s);
    ctx.imageSmoothingEnabled = false;

    if (staticReady) {
      ctx.drawImage(staticCanvas, 0, 0, staticCanvas.width, staticCanvas.height, 0, 0, W, H);
    }

    // 월드 외곽 프레임
    ctx.strokeStyle = "rgba(120, 92, 170, 0.35)";
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, W - 3, H - 3);

    drawAmbient(ctx, now);

    // 캐릭터 (y 순서로 정렬해 겹침 처리)
    const list = [];
    agents.forEach(function (a, id) {
      if (id === meId) return;
      const online = Date.now() - (a.data.updatedAt || 0) < 180000;
      list.push({
        id: id,
        x: a.x,
        y: a.y,
        name: a.data.name,
        role: a.data.role,
        glyph: Art.glyphFor(a.data),
        color: a.data.color,
        moving: a.moving,
        walkT: a.walkT,
        online: online,
        isMe: false
      });
    });
    if (meId && meReady) {
      const mine = agents.get(meId);
      list.push({
        id: meId,
        x: me.x,
        y: me.y,
        name: (mine && mine.data.name) || "내 피클",
        role: (mine && mine.data.role) || "",
        glyph: Art.glyphFor(mine ? mine.data : { name: "?" }),
        color: (mine && mine.data.color) || "purple",
        moving: me.moving,
        walkT: me.walkT,
        online: true,
        isMe: true
      });
    }

    list.sort(function (a, b) { return a.y - b.y; });
    list.forEach(function (c) {
      Art.drawCharacter(ctx, c, now / 1000);
    });

    // 말풍선
    const nowMs = performance.now();

    // 클릭 지점 표시
    if (me.marker && me.marker.until > nowMs) {
      const k = 1 - (me.marker.until - nowMs) / 900;
      const r = 4 + k * 10;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 0.8 - k * 0.8);
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(me.marker.x, me.marker.y, r, r * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 발걸음 먼지
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      const age = (nowMs - p.born) / 620;
      if (age >= 1) { puffs.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = 0.22 * (1 - age);
      ctx.fillStyle = "#ffeccd";
      ctx.beginPath();
      ctx.arc(p.x, p.y - age * 4, 2.5 + age * 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      if (b.until <= nowMs) { bubbles.splice(i, 1); continue; }
      let agent = null;
      if (b.agentId === meId) {
        agent = { x: me.x, y: me.y };
      } else {
        const a = agents.get(b.agentId);
        if (a) agent = a;
      }
      if (agent) drawBubble(ctx, b, agent, nowMs);
    }
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (!last) last = now;
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.08) dt = 0.08;

    if (meId && meReady) updateMe(dt);

    // 다른 피클 위치 보간
    agents.forEach(function (a, id) {
      if (id === meId) return;
      const dx = a.tx - a.x;
      const dy = a.ty - a.y;
      const d = Math.hypot(dx, dy);
      if (d > 320) { a.x = a.tx; a.y = a.ty; }
      else if (d > 0.6) {
        const k = Math.min(1, dt * 7);
        a.x += dx * k;
        a.y += dy * k;
        a.moving = d > 4;
        a.walkT += dt * 1.5;
      } else {
        a.x = a.tx;
        a.y = a.ty;
        a.moving = false;
        a.walkT += dt * 0.7;
      }
    });

    draw(now);
  }

  /* ---------------- 초기화 ---------------- */

  function init(options) {
    cbs = options || {};
    canvas = cbs.canvas;
    if (!canvas) return;
    ctx = canvas.getContext("2d");
    buildStatic();
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") {
        last = 0;
        if (!raf) start();
      }
    });
  }

  function start() {
    if (running) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function pause() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function setSound(on) {
    soundOn = !!on;
    if (soundOn) {
      const ac = ensureAudio();
      if (ac && ac.state === "suspended") { try { ac.resume(); } catch (e) {} }
      blip(700, 0.06, "square", 0.03);
    }
  }

  window.OfficeWorld = {
    init: init,
    start: start,
    pause: pause,
    resize: resize,
    setMe: setMe,
    setAgents: setAgents,
    teleport: teleport,
    moveToward: moveToward,
    hold: hold,
    bubble: bubble,
    setSound: setSound,
    zone: function () { return me.zone; },
    zoneName: function () { return displayZone(me.zone); },
    position: function () { return { x: Math.round(me.x), y: Math.round(me.y) }; },
    view: view
  };
})();
