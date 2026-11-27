/* =========================================================
   art.js — 픽셀 아트 오피스 월드 (정적 배경 + 캐릭터)
   ---------------------------------------------------------
   world.js 가 이 파일의 OfficeArt 를 사용해 맵을 그립니다.
   좌표 단위는 월드 픽셀(1280×760).
   ========================================================= */

(function () {
  "use strict";

  const W = 1280;
  const H = 760;

  const COLORS = {
    pink: "#ff87bd",
    purple: "#a78bfa",
    green: "#5ed3a3",
    blue: "#6fa8ff",
    orange: "#ffb35c",
    yellow: "#ffc94d",
    mint: "#4fd6c8",
    coral: "#ff8a80"
  };

  const ROOMS = {
    workspace: { key: "workspace", name: "작업실", icon: "🛠️", rect: { x: 28, y: 28, w: 584, h: 312 } },
    meeting:   { key: "meeting",   name: "회의실", icon: "🗓️", rect: { x: 676, y: 28, w: 576, h: 312 } },
    lounge:    { key: "lounge",    name: "라운지", icon: "☕",  rect: { x: 28, y: 404, w: 584, h: 328 } },
    away:      { key: "away",      name: "테라스", icon: "🌙", rect: { x: 676, y: 404, w: 576, h: 328 } }
  };
  const ROOM_ORDER = ["workspace", "meeting", "lounge", "away"];

  const WALLS = [
    { x: 0, y: 0, w: W, h: 28, outer: true },
    { x: 0, y: 732, w: W, h: 28, outer: true },
    { x: 0, y: 28, w: 28, h: 704, outer: true },
    { x: 1252, y: 28, w: 28, h: 704, outer: true },

    { x: 612, y: 28, w: 12, h: 122 },
    { x: 612, y: 220, w: 12, h: 120 },
    { x: 664, y: 28, w: 12, h: 122 },
    { x: 664, y: 220, w: 12, h: 120 },

    { x: 28, y: 340, w: 252, h: 12 },
    { x: 350, y: 340, w: 262, h: 12 },
    { x: 28, y: 392, w: 402, h: 12 },
    { x: 500, y: 392, w: 112, h: 12 },

    { x: 676, y: 340, w: 244, h: 12 },
    { x: 990, y: 340, w: 262, h: 12 },
    { x: 676, y: 392, w: 244, h: 12 },
    { x: 990, y: 392, w: 262, h: 12 },

    { x: 612, y: 404, w: 12, h: 156 },
    { x: 612, y: 630, w: 12, h: 102 },
    { x: 664, y: 404, w: 12, h: 156 },
    { x: 664, y: 630, w: 12, h: 102 }
  ];

  const DESKS = [
    { x: 54, y: 106 }, { x: 226, y: 106 }, { x: 398, y: 106 },
    { x: 54, y: 214 }, { x: 226, y: 214 }, { x: 398, y: 214 }
  ];
  const DESK_W = 130;
  const DESK_H = 64;

  const MEET_TABLE = { x: 820, y: 150, w: 300, h: 110 };
  const MEET_CHAIRS = [
    { x: 858, y: 126 }, { x: 950, y: 126 }, { x: 1042, y: 126 },
    { x: 858, y: 284 }, { x: 950, y: 284 }, { x: 1042, y: 284 },
    { x: 790, y: 205 }, { x: 1150, y: 205 }
  ];

  const SEATS = {
    workspace: [
      { x: 119, y: 188 }, { x: 291, y: 188 }, { x: 463, y: 188 },
      { x: 119, y: 296 }, { x: 291, y: 296 }, { x: 463, y: 296 }
    ],
    meeting: MEET_CHAIRS.map(function (c) { return { x: c.x, y: c.y + 10 }; }),
    lounge: [
      { x: 112, y: 704 }, { x: 176, y: 704 }, { x: 240, y: 704 },
      { x: 356, y: 700 }, { x: 214, y: 512 }
    ],
    away: [
      { x: 776, y: 588 }, { x: 890, y: 610 }, { x: 1032, y: 540 }, { x: 1140, y: 566 }
    ]
  };

  const SPAWN = {
    workspace: { x: 300, y: 318 },
    meeting: { x: 950, y: 320 },
    lounge: { x: 404, y: 486 },
    away: { x: 800, y: 500 }
  };

  /* ---------------- 기본 도구 ---------------- */

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

  function shade(hex, amt) {
    const h = String(hex || "#a78bfa").replace("#", "");
    const full = h.length === 3 ? h.split("").map(function (c) { return c + c; }).join("") : h;
    let r = parseInt(full.slice(0, 2), 16);
    let gg = parseInt(full.slice(2, 4), 16);
    let b = parseInt(full.slice(4, 6), 16);
    if (!isFinite(r) || !isFinite(gg) || !isFinite(b)) return hex;
    const f = function (v) {
      const out = amt >= 0 ? Math.round(v + (255 - v) * amt) : Math.round(v * (1 + amt));
      return Math.max(0, Math.min(255, out));
    };
    return "rgb(" + f(r) + "," + f(gg) + "," + f(b) + ")";
  }

  function hashOf(str) {
    let h = 2166136261;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0);
  }

  const CHOSEONG = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

  /* 이름/이니셜 → 얼굴에 새길 한국어 자음 */
  function glyphFor(agent) {
    if (!agent) return "?";
    const src = String(agent.initial || agent.name || "?").trim();
    const ch = src.charAt(0) || "?";
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      return CHOSEONG[Math.floor((code - 0xAC00) / 588)] || ch;
    }
    if (/[a-z]/i.test(ch)) return ch.toUpperCase();
    return ch;
  }

  function colorOf(agent) {
    const key = agent && agent.color ? agent.color : "purple";
    return COLORS[key] || (/^#/.test(key) ? key : COLORS.purple);
  }

  /* ---------------- 바닥 ---------------- */

  function paintWood(g) {
    px(g, 0, 0, W, H, "#a9764c");
    const rowH = 26;
    for (let row = 0, y = 0; y < H; row++, y += rowH) {
      px(g, 0, y, W, rowH, row % 2 ? "#b3814f" : "#ab7a4a");
      for (let sx = (row % 2 ? 40 : 0); sx < W; sx += 132) {
        px(g, sx, y, 1, rowH, "rgba(84,50,26,0.30)");
      }
      px(g, 0, y + rowH - 1, W, 1, "rgba(84,50,26,0.22)");
      for (let i = 0; i < 5; i++) {
        const gx = (row * 173 + i * 211) % W;
        px(g, gx, y + 5 + (i % 3) * 6, 26, 1, "rgba(255,236,200,0.10)");
      }
    }
  }

  function paintHall(g) {
    // 복도 바닥 (타일)
    const tiles = [
      { x: 612, y: 28, w: 64, h: 704 },
      { x: 28, y: 340, w: 1224, h: 64 }
    ];
    tiles.forEach(function (t) {
      px(g, t.x, t.y, t.w, t.h, "#a8a1b8");
      for (let y = t.y; y < t.y + t.h; y += 32) {
        for (let x = t.x; x < t.x + t.w; x += 32) {
          const alt = ((x / 32) + (y / 32)) % 2;
          px(g, x, y, 32, 32, alt ? "#a39cb4" : "#b0a9c0");
        }
      }
      // 그라우트
      g.strokeStyle = "rgba(70,60,90,0.18)";
      g.lineWidth = 1;
      for (let x = t.x; x <= t.x + t.w; x += 32) {
        g.beginPath(); g.moveTo(x + 0.5, t.y); g.lineTo(x + 0.5, t.y + t.h); g.stroke();
      }
      for (let y = t.y; y <= t.y + t.h; y += 32) {
        g.beginPath(); g.moveTo(t.x, y + 0.5); g.lineTo(t.x + t.w, y + 0.5); g.stroke();
      }
    });
    // 복도 러너 (가운데 길)
    px(g, 636, 30, 16, 700, "rgba(255,207,92,0.10)");
    px(g, 30, 364, 1220, 16, "rgba(255,207,92,0.10)");
  }

  function paintCarpet(g, room, base, edge, pattern) {
    const r = room.rect;
    // 방 바닥 그림자
    g.save();
    g.globalAlpha = 0.16;
    px(g, r.x, r.y, r.w, r.h, "#241633");
    g.restore();

    roundRect(g, r.x + 4, r.y + 4, r.w - 8, r.h - 8, 10, base);
    roundRect(g, r.x + 4, r.y + 4, r.w - 8, r.h - 8, 10, null);
    g.strokeStyle = edge;
    g.lineWidth = 4;
    g.stroke();

    roundRect(g, r.x + 16, r.y + 16, r.w - 32, r.h - 32, 8, null);
    g.strokeStyle = "rgba(255,255,255,0.16)";
    g.lineWidth = 2;
    g.stroke();

    g.save();
    g.beginPath();
    g.rect(r.x + 6, r.y + 6, r.w - 12, r.h - 12);
    g.clip();

    if (pattern === "grid") {
      g.strokeStyle = "rgba(160,130,90,0.22)";
      g.lineWidth = 1;
      for (let x = r.x + 32; x < r.x + r.w; x += 48) {
        g.beginPath(); g.moveTo(x + 0.5, r.y); g.lineTo(x + 0.5, r.y + r.h); g.stroke();
      }
      for (let y = r.y + 32; y < r.y + r.h; y += 48) {
        g.beginPath(); g.moveTo(r.x, y + 0.5); g.lineTo(r.x + r.w, y + 0.5); g.stroke();
      }
    } else if (pattern === "diamond") {
      g.strokeStyle = "rgba(255,255,255,0.22)";
      g.lineWidth = 1;
      for (let x = r.x - r.h; x < r.x + r.w + r.h; x += 56) {
        g.beginPath();
        g.moveTo(x, r.y);
        g.lineTo(x + r.h, r.y + r.h);
        g.stroke();
        g.beginPath();
        g.moveTo(x + r.h, r.y);
        g.lineTo(x, r.y + r.h);
        g.stroke();
      }
    } else if (pattern === "stripe") {
      for (let x = r.x; x < r.x + r.w; x += 34) {
        px(g, x, r.y, 14, r.h, "rgba(255,255,255,0.07)");
      }
    } else if (pattern === "stars") {
      for (let i = 0; i < 90; i++) {
        const sx = r.x + 12 + (hashOf("s" + i) % (r.w - 24));
        const sy = r.y + 12 + (hashOf("t" + i) % (r.h - 24));
        const tw = hashOf("u" + i) % 3;
        px(g, sx, sy, tw ? 2 : 1, tw ? 2 : 1, "rgba(230,220,255,0.5)");
      }
    }
    g.restore();

    // 안쪽 그림자
    g.save();
    g.globalAlpha = 0.12;
    px(g, r.x + 4, r.y + 4, r.w - 8, 6, "#241633");
    px(g, r.x + 4, r.y + r.h - 10, r.w - 8, 6, "#241633");
    g.restore();
  }

  function paintRooms(g) {
    paintCarpet(g, ROOMS.workspace, "#e2cba3", "#b99a6c", "grid");
    paintCarpet(g, ROOMS.meeting, "#a2c2da", "#7b9cba", "diamond");
    paintCarpet(g, ROOMS.lounge, "#dcaf9a", "#b57f6a", "stripe");
    paintCarpet(g, ROOMS.away, "#584674", "#443357", "stars");
  }

  /* ---------------- 벽 ---------------- */

  function paintWalls(g) {
    WALLS.forEach(function (w) {
      if (w.outer) {
        px(g, w.x, w.y, w.w, w.h, "#3a2a4c");
        px(g, w.x, w.y, w.w, 3, "#5b4573");
        px(g, w.x, w.y + w.h - 4, w.w, 4, "#241733");
        // 벽 패널 이음새
        if (w.w > w.h) {
          for (let x = w.x + 40; x < w.x + w.w; x += 80) {
            px(g, x, w.y + 4, 1, w.h - 8, "rgba(12,6,20,0.35)");
          }
        } else {
          for (let y = w.y + 40; y < w.y + w.h; y += 80) {
            px(g, w.x + 4, y, w.w - 8, 1, "rgba(12,6,20,0.35)");
          }
        }
      } else {
        px(g, w.x, w.y, w.w, w.h, "#4b3660");
        px(g, w.x, w.y, w.w, 3, "#74598c");
        px(g, w.x, w.y + w.h - 3, w.w, 3, "#2b1b3a");
        // 벽 그림자
        g.save();
        g.globalAlpha = 0.14;
        px(g, w.x + 2, w.y + w.h, w.w, 5, "#1a1024");
        g.restore();
      }
    });
  }

  function windowSky(g, x, y, w, h, night) {
    const grad = g.createLinearGradient(0, y, 0, y + h);
    if (night) {
      grad.addColorStop(0, "#141a3d");
      grad.addColorStop(0.6, "#2a2a63");
      grad.addColorStop(1, "#463a72");
    } else {
      grad.addColorStop(0, "#79c8f2");
      grad.addColorStop(0.55, "#a9e2fb");
      grad.addColorStop(1, "#e4f6ff");
    }
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);

    if (night) {
      for (let i = 0; i < 16; i++) {
        const sx = x + 6 + (hashOf("n" + i + x + y) % Math.max(4, w - 12));
        const sy = y + 4 + (hashOf("m" + i + x + y) % Math.max(4, h - 8));
        px(g, sx, sy, 1, 1, "rgba(255,255,255,0.85)");
      }
      // 달
      const mx = x + w * 0.62;
      const my = y + h * 0.3;
      g.beginPath(); g.arc(mx, my, Math.min(w, h) * 0.16, 0, Math.PI * 2);
      g.fillStyle = "#ffeec2"; g.fill();
      g.beginPath(); g.arc(mx + Math.min(w, h) * 0.07, my - Math.min(w, h) * 0.03, Math.min(w, h) * 0.13, 0, Math.PI * 2);
      g.fillStyle = "rgba(20,26,61,0.9)"; g.fill();
    } else {
      // 구름 + 스카이라인
      const cy = y + h * 0.42;
      px(g, x + w * 0.14, cy, w * 0.2, h * 0.16, "#ffffff");
      px(g, x + w * 0.2, cy - h * 0.1, w * 0.1, h * 0.14, "#ffffff");
      px(g, x + w * 0.58, cy + h * 0.16, w * 0.22, h * 0.12, "#f6fdff");
      // 원경 건물
      g.fillStyle = "rgba(120,175,205,0.55)";
      for (let i = 0; i < 7; i++) {
        const bw = w / 9 + (hashOf("b" + i + x) % 12);
        const bh = h * (0.22 + (hashOf("c" + i + y) % 30) / 100);
        g.fillRect(x + 6 + i * (w / 8), y + h - bh, bw, bh);
      }
    }

    // 창틀
    g.strokeStyle = "#2f2440";
    g.lineWidth = 3;
    g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x + w / 2, y); g.lineTo(x + w / 2, y + h);
    g.stroke();
    if (h > 40) {
      g.beginPath();
      g.moveTo(x, y + h * 0.58); g.lineTo(x + w, y + h * 0.58);
      g.stroke();
    }
    // 창턱
    px(g, x - 3, y + h, w + 6, 4, "#6b5182");
    px(g, x - 3, y + h + 4, w + 6, 2, "rgba(20,10,30,0.45)");
  }

  function paintWindows(g) {
    // 위쪽 벽 창문 (방 안쪽으로 살짝 내려오는 창)
    const top = [
      { x: 96, w: 190 }, { x: 326, w: 190 },
      { x: 700, w: 190 }, { x: 930, w: 190 }
    ];
    top.forEach(function (win) {
      windowSky(g, win.x, 6, win.w, 38, false);
    });

    // 왼쪽 벽 창문 (작업실)
    g.save();
    g.translate(30, 132);
    g.rotate(0);
    windowSky(g, -24, 0, 20, 104, false);
    g.restore();

    // 왼쪽 벽 창문 (라운지)
    g.save();
    windowSky(g, 8, 470, 18, 120, false);
    g.restore();

    // 오른쪽 벽 창문 (테라스 · 밤)
    windowSky(g, 1256, 468, 20, 152, true);
  }

  /* ---------------- 가구 ---------------- */

  function drawPlant(g, x, y, s) {
    const k = s || 1;
    // 화분
    g.fillStyle = "#b5653f";
    g.beginPath();
    g.moveTo(x - 11 * k, y - 16 * k);
    g.lineTo(x + 11 * k, y - 16 * k);
    g.lineTo(x + 8 * k, y);
    g.lineTo(x - 8 * k, y);
    g.closePath();
    g.fill();
    px(g, x - 12 * k, y - 18 * k, 24 * k, 4, "#e0865a");
    // 잎
    g.fillStyle = "#3f9a63";
    g.beginPath(); g.ellipse(x, y - 30 * k, 7 * k, 13 * k, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#56b97c";
    g.beginPath(); g.ellipse(x - 9 * k, y - 24 * k, 6 * k, 10 * k, -0.6, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(x + 9 * k, y - 25 * k, 6 * k, 10 * k, 0.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#2f7d4e";
    g.beginPath(); g.ellipse(x + 2 * k, y - 38 * k, 5 * k, 10 * k, 0.2, 0, Math.PI * 2); g.fill();
  }

  function drawDesk(g, d, i) {
    const x = d.x;
    const y = d.y;
    // 그림자
    px(g, x + 4, y + DESK_H - 4, DESK_W, 8, "rgba(40,24,14,0.18)");
    // 상판
    px(g, x, y + 22, DESK_W, 26, "#d9a066");
    px(g, x, y + 22, DESK_W, 4, "#f0c48c");
    px(g, x, y + 44, DESK_W, 4, "#a86f3f");
    // 다리
    px(g, x + 6, y + 48, 8, 16, "#8a5a33");
    px(g, x + DESK_W - 14, y + 48, 8, 16, "#8a5a33");

    // 모니터
    px(g, x + 40, y + 2, 52, 30, "#2a2c42");
    px(g, x + 44, y + 6, 44, 20, i % 2 ? "#5ad0c8" : "#7fc4ff");
    px(g, x + 44, y + 6, 44, 3, "rgba(255,255,255,0.35)");
    // 화면 코드 줄
    for (let k = 0; k < 4; k++) {
      const w0 = 10 + ((i * 7 + k * 11) % 26);
      px(g, x + 47, y + 11 + k * 4, w0, 1, "rgba(20,40,70,0.55)");
    }
    px(g, x + 64, y + 32, 4, 6, "#454866");
    px(g, x + 54, y + 38, 24, 3, "#454866");

    // 키보드
    px(g, x + 38, y + 30, 44, 8, "#3b3a55");
    px(g, x + 40, y + 32, 40, 4, "#57567a");

    // 머그컵 / 서류 / 작은 화분
    if (i % 3 === 0) {
      px(g, x + 96, y + 26, 9, 9, "#ffffff");
      px(g, x + 105, y + 28, 3, 5, "#ffffff");
      px(g, x + 97, y + 27, 7, 2, "#8b5a3a");
    } else if (i % 3 === 1) {
      px(g, x + 92, y + 26, 16, 10, "#fff8e6");
      px(g, x + 94, y + 28, 12, 1, "rgba(90,70,50,0.4)");
      px(g, x + 94, y + 31, 8, 1, "rgba(90,70,50,0.4)");
    } else {
      px(g, x + 98, y + 24, 8, 8, "#c96f4a");
      g.fillStyle = "#4caf72";
      g.beginPath(); g.ellipse(x + 102, y + 20, 5, 7, 0, 0, Math.PI * 2); g.fill();
    }

    // 의자 (책상 앞)
    const cx = x + DESK_W / 2;
    const cy = y + DESK_H + 12;
    px(g, cx - 12, cy - 8, 24, 16, "#5d6b8c");
    px(g, cx - 12, cy - 10, 24, 4, "#7c8cb3");
    px(g, cx - 14, cy - 6, 4, 18, "#41506e");
    px(g, cx + 10, cy - 6, 4, 18, "#41506e");
  }

  function drawCooler(g, x, y) {
    // 생수통
    g.fillStyle = "rgba(150,210,240,0.6)";
    g.beginPath();
    g.ellipse(x + 19, y + 14, 15, 18, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(220,245,255,0.5)";
    g.beginPath();
    g.ellipse(x + 15, y + 9, 6, 9, -0.3, 0, Math.PI * 2);
    g.fill();
    // 본체
    px(g, x, y + 26, 38, 44, "#cfd6e8");
    px(g, x, y + 26, 38, 4, "#eef2fb");
    px(g, x + 6, y + 38, 26, 8, "#8ea4c6");
    px(g, x + 8, y + 52, 8, 6, "#6fa8ff");
    px(g, x + 20, y + 52, 8, 6, "#ff87bd");
    px(g, x + 4, y + 62, 30, 4, "#a5acc4");
  }

  function drawCabinet(g, x, y, w, h) {
    px(g, x + 3, y + h - 2, w, 6, "rgba(30,20,40,0.2)");
    px(g, x, y, w, h, "#8c93ad");
    px(g, x, y, w, 5, "#b6bdd3");
    const rows = 3;
    const rh = (h - 8) / rows;
    for (let i = 0; i < rows; i++) {
      px(g, x + 4, y + 8 + i * rh, w - 8, rh - 4, "#a5acc4");
      px(g, x + w / 2 - 10, y + 8 + i * rh + rh / 2 - 5, 20, 3, "#6e7590");
    }
  }

  function drawWhiteboard(g, x, y, w, h, variant) {
    px(g, x + 3, y + 3, w, h, "rgba(30,18,44,0.25)");
    px(g, x, y, w, h, "#e9eef5");
    g.strokeStyle = "#8d9aad";
    g.lineWidth = 2;
    g.strokeRect(x + 1, y + 1, w - 2, h - 2);

    if (variant === "sprint") {
      g.fillStyle = "#4a5a73";
      g.font = "bold 11px 'Galmuri11','Malgun Gothic',sans-serif";
      g.fillText("SPRINT 12", x + 8, y + 16);
      const notes = ["#ffd166", "#ff9f9f", "#9fe3ff", "#b6f0c8", "#e3c8ff"];
      for (let i = 0; i < 5; i++) {
        const nx = x + 8 + (i % 3) * 52;
        const ny = y + 22 + Math.floor(i / 3) * 14;
        px(g, nx, ny, 22, 12, notes[i]);
        px(g, nx + 3, ny + 3, 16, 1, "rgba(60,50,30,0.5)");
        px(g, nx + 3, ny + 6, 11, 1, "rgba(60,50,30,0.5)");
      }
      g.fillStyle = "#3f4a5c";
      for (let i = 0; i < 3; i++) {
        px(g, x + w - 44, y + 22 + i * 6, 34, 2, "rgba(60,80,110,0.35)");
      }
    } else {
      g.fillStyle = "#3f4a5c";
      g.font = "bold 11px 'Galmuri11','Malgun Gothic',sans-serif";
      g.fillText("AGENDA", x + 10, y + 17);
      const colors = ["#ff87bd", "#6fa8ff", "#5ed3a3", "#ffb35c"];
      for (let i = 0; i < 4; i++) {
        px(g, x + 10, y + 24 + i * 7, 8 + ((i * 17) % 40), 3, colors[i]);
      }
      px(g, x + w - 60, y + 12, 46, 30, "#f6fbff");
      px(g, x + w - 56, y + 16, 38, 2, "rgba(70,90,120,0.4)");
      px(g, x + w - 56, y + 21, 30, 2, "rgba(70,90,120,0.4)");
      px(g, x + w - 56, y + 26, 34, 2, "rgba(70,90,120,0.4)");
    }
    // 마커 홀더
    px(g, x + 6, y + h, w - 12, 3, "#aab4c4");
    px(g, x + 10, y + h, 3, 6, "#ff6b6b");
    px(g, x + 16, y + h, 3, 6, "#4dabf7");
  }

  function drawMeetingTable(g) {
    const t = MEET_TABLE;
    px(g, t.x + 4, t.y + t.h - 2, t.w, 10, "rgba(30,20,40,0.20)");
    // 의자들
    MEET_CHAIRS.forEach(function (c) {
      px(g, c.x - 11, c.y - 8, 22, 16, "#5d6b8c");
      px(g, c.x - 11, c.y - 10, 22, 4, "#7c8cb3");
      px(g, c.x - 13, c.y + 6, 4, 4, "#41506e");
      px(g, c.x + 9, c.y + 6, 4, 4, "#41506e");
    });
    // 테이블
    px(g, t.x, t.y, t.w, t.h, "#8a5a38");
    px(g, t.x, t.y, t.w, 6, "#b9814f");
    px(g, t.x, t.y + t.h - 8, t.w, 8, "#6f4529");
    px(g, t.x + 10, t.y + 12, t.w - 20, t.h - 24, "#9a6741");

    // 노트북 / 서류 / 컵
    px(g, t.x + 34, t.y + 28, 34, 22, "#2f3350");
    px(g, t.x + 38, t.y + 32, 26, 14, "#7fc4ff");
    px(g, t.x + 34, t.y + 50, 34, 3, "#20233a");

    px(g, t.x + 96, t.y + 30, 40, 28, "#fff8e6");
    for (let i = 0; i < 5; i++) {
      px(g, t.x + 101, t.y + 35 + i * 4, 28 - (i % 2) * 8, 1, "rgba(90,70,50,0.45)");
    }
    px(g, t.x + 170, t.y + 26, 42, 26, "#fff8e6");
    px(g, t.x + 176, t.y + 31, 30, 2, "rgba(90,70,50,0.4)");
    px(g, t.x + 176, t.y + 36, 22, 2, "rgba(90,70,50,0.4)");

    // 컵 3개 + 화분
    const cups = [[t.x + 226, t.y + 30], [t.x + 244, t.y + 42], [t.x + 214, t.y + 62]];
    cups.forEach(function (c) {
      px(g, c[0], c[1], 10, 10, "#ffffff");
      px(g, c[0] + 10, c[1] + 2, 3, 5, "#ffffff");
      px(g, c[0] + 1, c[1] + 1, 8, 2, "#7a4a2a");
    });
    px(g, t.x + 268, t.y + 54, 14, 14, "#b5653f");
    g.fillStyle = "#4caf72";
    g.beginPath(); g.ellipse(t.x + 275, t.y + 46, 8, 11, 0, 0, Math.PI * 2); g.fill();

    // 회의실 화면 (TV)
    px(g, 1216, 118, 34, 92, "#20233a");
    px(g, 1220, 123, 26, 70, "#4a5f8a");
    px(g, 1220, 123, 26, 3, "rgba(255,255,255,0.25)");
    px(g, 1224, 160, 4, 10, "#7fe0b0");
    px(g, 1230, 150, 4, 20, "#ffd166");
    px(g, 1236, 168, 4, 2, "#ff87bd");
  }

  function drawCounter(g) {
    const x = 60, y = 416, w = 330, h = 56;
    px(g, x + 3, y + h - 2, w, 8, "rgba(30,20,40,0.2)");
    px(g, x, y, w, h, "#8a5a38");
    px(g, x, y, w, 6, "#c08a58");
    px(g, x, y + h - 10, w, 10, "#6f4529");
    // 상판
    px(g, x - 4, y - 6, w + 8, 10, "#e0c39a");
    px(g, x - 4, y - 6, w + 8, 2, "#f6e6c8");

    // 에스프레소 머신
    px(g, x + 26, y - 30, 54, 26, "#2f3350");
    px(g, x + 30, y - 26, 46, 8, "#454b73");
    px(g, x + 34, y - 14, 8, 8, "#ffd166");
    px(g, x + 46, y - 14, 8, 8, "#ff87bd");
    px(g, x + 60, y - 16, 14, 6, "#9aa3c0");
    // 컵들
    for (let i = 0; i < 3; i++) {
      px(g, x + 104 + i * 12, y - 20, 9, 9, "#ffffff");
      px(g, x + 104 + i * 12, y - 21, 9, 2, "#c9d4ea");
    }
    // 유리 진열장
    px(g, x + 160, y - 34, 70, 30, "rgba(170,210,235,0.55)");
    g.strokeStyle = "#5d6b8c"; g.lineWidth = 2;
    g.strokeRect(x + 160, y - 34, 70, 30);
    px(g, x + 172, y - 26, 14, 10, "#e6b77a");
    px(g, x + 192, y - 26, 16, 10, "#f0d3a8");

    // 칠판 사인
    px(g, x + 246, y - 44, 72, 38, "#3a2f2a");
    g.strokeStyle = "#8a5a38"; g.lineWidth = 2;
    g.strokeRect(x + 246, y - 44, 72, 38);
    g.fillStyle = "#ffe9b0";
    g.font = "bold 9px 'Galmuri11','Malgun Gothic',sans-serif";
    g.fillText("COFFEE", x + 256, y - 30);
    g.fillText("2,500", x + 260, y - 18);

    // 원두 자루
    px(g, x + 4, y + 10, 16, 22, "#6b4a2f");
    px(g, x + 6, y + 14, 12, 4, "#8a5a38");
  }

  function drawSofa(g, x, y, w, h) {
    px(g, x + 3, y + h - 2, w, 7, "rgba(30,20,40,0.2)");
    px(g, x, y + 8, w, h - 8, "#c96f8a");
    px(g, x, y, w, 14, "#e08ba4");
    px(g, x, y + 14, 10, h - 14, "#b45c76");
    px(g, x + w - 10, y + 14, 10, h - 14, "#b45c76");
    // 쿠션
    px(g, x + 14, y + 18, (w - 34) / 2, h - 28, "#f0a9bc");
    px(g, x + 14 + (w - 34) / 2 + 6, y + 18, (w - 34) / 2, h - 28, "#f0a9bc");
    px(g, x + 18, y + 22, (w - 34) / 2 - 8, 3, "rgba(255,255,255,0.35)");
    px(g, x + 22 + (w - 34) / 2 + 6, y + 22, (w - 34) / 2 - 8, 3, "rgba(255,255,255,0.35)");
  }

  function drawArmchair(g, x, y) {
    px(g, x + 3, y + 60, 70, 7, "rgba(30,20,40,0.2)");
    px(g, x, y + 8, 70, 58, "#c96f8a");
    px(g, x, y, 70, 12, "#e08ba4");
    px(g, x + 10, y + 18, 50, 38, "#f0a9bc");
    px(g, x + 6, y + 12, 6, 50, "#b45c76");
    px(g, x + 58, y + 12, 6, 50, "#b45c76");
  }

  function drawCoffeeTable(g, x, y, w, h) {
    px(g, x + 3, y + h - 2, w, 6, "rgba(30,20,40,0.2)");
    px(g, x, y, w, h, "#a9713f");
    px(g, x, y, w, 5, "#d09a63");
    px(g, x + 4, y + 6, w - 8, h - 10, "#94612f");
    px(g, x + 18, y + 16, 16, 12, "#ffffff");
    px(g, x + 20, y + 18, 12, 2, "#7a4a2a");
    px(g, x + 52, y + 14, 34, 24, "#3b6ea5");
    px(g, x + 56, y + 18, 26, 16, "#79c8f2");
    px(g, x + 60, y + 22, 8, 8, "#ffffff");
  }

  function drawBookshelf(g, x, y, w, h) {
    px(g, x + 3, y + h - 2, w, 6, "rgba(30,20,40,0.2)");
    px(g, x, y, w, h, "#7b5232");
    px(g, x, y, w, 4, "#a06d44");
    const shelves = 3;
    const sh = (h - 8) / shelves;
    for (let s = 0; s < shelves; s++) {
      const sy = y + 6 + s * sh;
      px(g, x + 4, sy + sh - 4, w - 8, 4, "#5d3c24");
      const palette = ["#ff87bd", "#ffd166", "#6fa8ff", "#5ed3a3", "#e3c8ff", "#ff8a80"];
      let bx = x + 6;
      let i = 0;
      while (bx < x + w - 10) {
        const bw = 4 + ((s * 7 + i * 5) % 5);
        const bh = sh - 10 - ((i * 3) % 6);
        px(g, bx, sy + sh - 6 - bh, bw, bh, palette[(s * 3 + i) % palette.length]);
        bx += bw + 2;
        i++;
      }
    }
  }

  function drawBeanbag(g, x, y, w, h, color) {
    px(g, x + 3, y + h - 3, w, 8, "rgba(20,14,30,0.28)");
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(x + w / 2, y + h / 2 + 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = shade(color, 0.18);
    g.beginPath();
    g.ellipse(x + w / 2 - 4, y + h / 2 - 4, w / 2 - 8, h / 2 - 12, 0, 0, Math.PI * 2);
    g.fill();
    // 이음새
    g.strokeStyle = "rgba(20,14,30,0.25)";
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(x + w / 2, y + h / 2 + 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    g.stroke();
  }

  function drawLowTable(g, x, y, w, h) {
    px(g, x + 3, y + h - 2, w, 6, "rgba(20,14,30,0.25)");
    px(g, x, y, w, h, "#9a6b45");
    px(g, x, y, w, 4, "#c08a58");
    // 램프
    px(g, x + 30, y - 30, 4, 30, "#6d5a8c");
    g.fillStyle = "#ffe6a7";
    g.beginPath();
    g.moveTo(x + 16, y - 30);
    g.lineTo(x + 48, y - 30);
    g.lineTo(x + 40, y - 46);
    g.lineTo(x + 24, y - 46);
    g.closePath();
    g.fill();
    g.save();
    g.globalAlpha = 0.18;
    g.beginPath();
    g.arc(x + 32, y - 26, 34, 0, Math.PI * 2);
    g.fillStyle = "#ffe6a7";
    g.fill();
    g.restore();
    // 책
    px(g, x + 8, y + 12, 22, 14, "#5b7bd5");
    px(g, x + 10, y + 14, 18, 2, "#adc4f5");
  }

  function drawCat(g, x, y) {
    // 잠자는 고양이
    g.fillStyle = "#f0c98a";
    g.beginPath(); g.ellipse(x, y, 18, 11, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(x + 14, y - 4, 9, 0, Math.PI * 2); g.fill();
    // 귀
    g.beginPath(); g.moveTo(x + 8, y - 8); g.lineTo(x + 10, y - 16); g.lineTo(x + 15, y - 10); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(x + 16, y - 9); g.lineTo(x + 21, y - 15); g.lineTo(x + 22, y - 6); g.closePath(); g.fill();
    // 줄무늬
    px(g, x - 10, y - 3, 8, 2, "rgba(180,130,70,0.7)");
    px(g, x - 2, y - 6, 8, 2, "rgba(180,130,70,0.7)");
    // 눈 (감은)
    px(g, x + 12, y - 5, 4, 1, "#5a3a20");
    px(g, x + 18, y - 5, 3, 1, "#5a3a20");
    // 꼬리
    g.strokeStyle = "#f0c98a";
    g.lineWidth = 4;
    g.beginPath();
    g.arc(x - 14, y + 2, 10, Math.PI * 0.2, Math.PI * 1.1);
    g.stroke();
    // zZ
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.font = "bold 10px 'Galmuri11',monospace";
    g.fillText("z", x + 26, y - 20);
    g.fillText("Z", x + 34, y - 30);
  }

  function drawRug(g, x, y, w, h, base, accent) {
    roundRect(g, x, y, w, h, 14, base);
    roundRect(g, x + 8, y + 8, w - 16, h - 16, 10, null);
    g.strokeStyle = accent;
    g.lineWidth = 3;
    g.stroke();
    g.save();
    g.globalAlpha = 0.35;
    for (let i = 1; i < 5; i++) {
      px(g, x + 14, y + (h / 5) * i, w - 28, 2, accent);
    }
    g.restore();
  }

  /* ---------------- 각 방 ---------------- */

  function paintWorkspace(g) {
    drawWhiteboard(g, 60, 46, 220, 50, "sprint");

    DESKS.forEach(function (d, i) { drawDesk(g, d, i); });

    // 왼쪽 벽 선반 + 화분
    drawBookshelf(g, 32, 210, 18, 100);
    drawPlant(g, 596, 300, 0.95);
    drawPlant(g, 44, 320, 0.8);

    // 바닥 스탠드 램프
    px(g, 574, 60, 4, 56, "#5d6b8c");
    g.fillStyle = "#ffe6a7";
    g.beginPath();
    g.moveTo(560, 58); g.lineTo(592, 58); g.lineTo(586, 40); g.lineTo(566, 40);
    g.closePath(); g.fill();

    // 서류 상자
    px(g, 32, 88, 16, 18, "#c9a06a");
    px(g, 32, 92, 16, 2, "#a37c48");

    // 정수기
    drawCooler(g, 556, 84);

    // 파일 캐비닛
    drawCabinet(g, 30, 120, 40, 74);

    // 바닥 케이블
    g.save();
    g.globalAlpha = 0.35;
    g.strokeStyle = "#3b2a4a";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(184, 150); g.bezierCurveTo(210, 170, 220, 186, 246, 190);
    g.stroke();
    g.beginPath();
    g.moveTo(356, 258); g.bezierCurveTo(380, 280, 400, 292, 430, 300);
    g.stroke();
    g.restore();

    // 휴지통
    px(g, 590, 236, 14, 18, "#5d6b8c");
    px(g, 588, 234, 18, 4, "#7c8cb3");
  }

  function paintMeeting(g) {
    drawWhiteboard(g, 700, 46, 250, 50, "agenda");

    // 타원 러그
    g.save();
    g.globalAlpha = 0.22;
    g.fillStyle = "#3f6a92";
    g.beginPath();
    g.ellipse(965, 208, 246, 152, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.3)";
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(965, 208, 224, 132, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();

    drawMeetingTable(g);
    drawPlant(g, 706, 320, 1);
    drawPlant(g, 1228, 316, 0.9);

    // 미니 사이드보드 + 생수
    px(g, 690, 232, 42, 54, "#7b5232");
    px(g, 690, 232, 42, 4, "#a06d44");
    px(g, 694, 240, 34, 12, "#5d3c24");
    px(g, 700, 220, 8, 14, "#9fd7f5");
    px(g, 712, 218, 8, 16, "#9fd7f5");

    // 화상회의 카메라
    px(g, 664 + 8, 60, 10, 10, "#2a2c42");

    // 천장 조명
    [[820, 60], [970, 56], [1120, 60]].forEach(function (l) {
      px(g, l[0] - 20, l[1], 40, 4, "#dce6f5");
      px(g, l[0] - 12, l[1] + 4, 24, 3, "#fff3c4");
    });
  }

  function paintLounge(g) {
    drawCounter(g);
    drawRug(g, 62, 500, 460, 216, "#c98a74", "rgba(255,240,220,0.35)");
    drawSofa(g, 80, 620, 206, 64);
    drawArmchair(g, 318, 614);
    drawCoffeeTable(g, 150, 534, 126, 56);
    drawBookshelf(g, 470, 500, 64, 150);
    drawPlant(g, 556, 476, 1);
    drawPlant(g, 44, 566, 0.85);
    drawCat(g, 392, 692);

    // 바닥 램프
    px(g, 532, 660, 4, 52, "#5d6b8c");
    g.fillStyle = "#ffe6a7";
    g.beginPath();
    g.moveTo(518, 658); g.lineTo(550, 658); g.lineTo(544, 640); g.lineTo(524, 640);
    g.closePath(); g.fill();

    // 창 커튼
    g.fillStyle = "#b46a72";
    g.beginPath();
    g.moveTo(8, 456); g.lineTo(40, 456); g.lineTo(34, 600); g.lineTo(8, 600);
    g.closePath(); g.fill();
    g.fillStyle = "rgba(255,255,255,0.14)";
    for (let i = 0; i < 4; i++) px(g, 12 + i * 6, 462, 2, 132, "rgba(255,255,255,0.14)");

    // 러그 술
    g.save();
    g.globalAlpha = 0.5;
    for (let x = 70; x < 516; x += 8) {
      px(g, x, 714, 4, 5, "#c98a74");
    }
    g.restore();

    // 쿠키 접시
    px(g, 236, 548, 24, 8, "#fdf7ea");
    px(g, 240, 546, 6, 4, "#b07a4a");
    px(g, 250, 545, 6, 4, "#c98a5a");
  }

  function paintAway(g) {
    drawRug(g, 716, 520, 380, 196, "#493a66", "rgba(190,170,240,0.28)");
    drawBeanbag(g, 740, 596, 96, 74, "#8b74c9");
    drawBeanbag(g, 856, 616, 84, 64, "#6fa8ff");
    drawLowTable(g, 1000, 570, 80, 50);
    drawBookshelf(g, 1082, 470, 70, 128);
    drawPlant(g, 1210, 700, 1);
    drawPlant(g, 702, 476, 0.9);

    // 달빛 웅덩이
    g.save();
    g.globalAlpha = 0.16;
    g.fillStyle = "#cfe3ff";
    g.beginPath();
    g.moveTo(1180, 470);
    g.lineTo(1248, 470);
    g.lineTo(1140, 700);
    g.lineTo(1060, 700);
    g.closePath();
    g.fill();
    g.restore();

    // 자리비움 표찰
    px(g, 704, 408, 62, 18, "#2b2142");
    g.fillStyle = "#cfc2ea";
    g.font = "bold 10px 'Galmuri11','Malgun Gothic',sans-serif";
    g.fillText("🌙 QUIET", 708, 421);

    // 스트링 라이트
    g.save();
    g.strokeStyle = "rgba(255,230,160,0.35)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(690, 424);
    g.quadraticCurveTo(950, 452, 1240, 424);
    g.stroke();
    for (let i = 0; i < 11; i++) {
      const lt = i / 10;
      const lx = 690 + (1240 - 690) * lt;
      const ly = 424 + Math.sin(Math.PI * lt) * 22;
      px(g, lx - 1, ly, 2, 4, "#5a476f");
      g.fillStyle = i % 2 ? "#ffd166" : "#ffb3c8";
      g.beginPath(); g.arc(lx, ly + 5, 2.4, 0, Math.PI * 2); g.fill();
    }
    g.restore();

    // 쿠션
    g.fillStyle = "#e0a3b8";
    g.beginPath(); g.ellipse(900, 690, 22, 9, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#8fd7c4";
    g.beginPath(); g.ellipse(936, 700, 18, 8, 0, 0, Math.PI * 2); g.fill();

    // 망원경
    px(g, 1168, 660, 4, 34, "#5d6b8c");
    px(g, 1160, 692, 20, 4, "#41506e");
    g.save();
    g.translate(1170, 656);
    g.rotate(-0.5);
    px(g, 0, -5, 26, 10, "#8c93ad");
    px(g, 22, -7, 8, 14, "#6b7793");
    g.restore();

    // 종이 랜턴
    px(g, 1090, 430, 28, 3, "#5a476f");
    g.fillStyle = "rgba(255,226,160,0.85)";
    g.beginPath(); g.ellipse(1104, 452, 13, 17, 0, 0, Math.PI * 2); g.fill();
    g.save();
    g.globalAlpha = 0.15;
    g.fillStyle = "#ffe6a7";
    g.beginPath(); g.arc(1104, 452, 46, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function paintDoors(g) {
    const mats = [
      { x: 282, y: 316, w: 66, h: 20 },
      { x: 432, y: 358, w: 66, h: 20 },
      { x: 922, y: 316, w: 66, h: 20 },
      { x: 922, y: 358, w: 66, h: 20 },
      { x: 356, y: 378, w: 20, h: 56 },
      { x: 600, y: 378, w: 20, h: 56 }
    ];
    mats.forEach(function (m) {
      px(g, m.x, m.y, m.w, m.h, "rgba(60,40,30,0.22)");
      px(g, m.x, m.y, m.w, 2, "rgba(255,220,150,0.35)");
    });

    // 문틀 (수평 구멍)
    const doorH = [
      { x1: 280, x2: 350, y: 340, h: 12 },
      { x1: 430, x2: 500, y: 392, h: 12 },
      { x1: 920, x2: 990, y: 340, h: 12 },
      { x1: 920, x2: 990, y: 392, h: 12 }
    ];
    doorH.forEach(function (d) {
      px(g, d.x1 - 5, d.y - 4, 6, d.h + 8, "#8a5a38");
      px(g, d.x1 - 5, d.y - 4, 6, 3, "#ffd166");
      px(g, d.x2 - 1, d.y - 4, 6, d.h + 8, "#8a5a38");
      px(g, d.x2 - 1, d.y - 4, 6, 3, "#ffd166");
      px(g, d.x1, d.y + 2, d.x2 - d.x1, d.h - 4, "rgba(255,226,170,0.16)");
    });

    // 문틀 (수직 구멍)
    const doorV = [
      { y1: 150, y2: 220, x: 612, w: 12 },
      { y1: 150, y2: 220, x: 664, w: 12 },
      { y1: 560, y2: 630, x: 612, w: 12 },
      { y1: 560, y2: 630, x: 664, w: 12 }
    ];
    doorV.forEach(function (d) {
      px(g, d.x - 4, d.y1 - 5, d.w + 8, 6, "#8a5a38");
      px(g, d.x - 4, d.y1 - 5, 3, 6, "#ffd166");
      px(g, d.x - 4, d.y2 - 1, d.w + 8, 6, "#8a5a38");
      px(g, d.x - 4, d.y2 - 1, 3, 6, "#ffd166");
      px(g, d.x + 2, d.y1, d.w - 4, d.y2 - d.y1, "rgba(255,226,170,0.14)");
    });
  }

  function paintLight(g) {
    // 위쪽 창문에서 들어오는 햇빛
    g.save();
    g.globalAlpha = 0.07;
    [[96, 190], [326, 190], [700, 190], [930, 190]].forEach(function (w0) {
      g.fillStyle = "#fff6d8";
      g.beginPath();
      g.moveTo(w0[0], 44);
      g.lineTo(w0[0] + w0[1], 44);
      g.lineTo(w0[0] + w0[1] + 70, 330);
      g.lineTo(w0[0] - 40, 330);
      g.closePath();
      g.fill();
    });
    g.restore();

    // 방 테두리 음영
    g.save();
    g.globalAlpha = 0.10;
    ROOM_ORDER.forEach(function (k) {
      const r = ROOMS[k].rect;
      px(g, r.x, r.y, r.w, 10, "#1a1024");
      px(g, r.x, r.y, 10, r.h, "#1a1024");
    });
    g.restore();
  }

  function paint(g) {
    paintWood(g);
    paintHall(g);
    paintRooms(g);
    paintWalls(g);
    paintWindows(g);
    paintWorkspace(g);
    paintMeeting(g);
    paintLounge(g);
    paintAway(g);
    paintDoors(g);
    paintLight(g);
  }

  /* ---------------- 충돌 영역 ---------------- */

  function buildObstacles() {
    const list = [];
    WALLS.forEach(function (w) { list.push({ x: w.x, y: w.y, w: w.w, h: w.h }); });

    DESKS.forEach(function (d) {
      list.push({ x: d.x, y: d.y + 16, w: DESK_W, h: DESK_H - 12 });
    });

    list.push({ x: MEET_TABLE.x, y: MEET_TABLE.y, w: MEET_TABLE.w, h: MEET_TABLE.h });

    // 라운지
    list.push({ x: 56, y: 404, w: 338, h: 66 });        // 커피바
    list.push({ x: 76, y: 616, w: 214, h: 72 });        // 소파
    list.push({ x: 314, y: 610, w: 80, h: 78 });        // 암체어
    list.push({ x: 146, y: 530, w: 134, h: 64 });       // 커피 테이블
    list.push({ x: 466, y: 496, w: 72, h: 158 });       // 책장
    // 화분/소품
    list.push({ x: 546, y: 462, w: 26, h: 30 });        // 화분
    list.push({ x: 34, y: 552, w: 22, h: 26 });
    list.push({ x: 520, y: 642, w: 26, h: 20 });        // 램프

    // 테라스
    list.push({ x: 736, y: 594, w: 104, h: 82 });
    list.push({ x: 852, y: 614, w: 92, h: 68 });
    list.push({ x: 996, y: 566, w: 88, h: 58 });
    list.push({ x: 1078, y: 466, w: 78, h: 136 });
    list.push({ x: 1198, y: 686, w: 26, h: 30 });
    list.push({ x: 694, y: 470, w: 22, h: 26 });
    list.push({ x: 1156, y: 636, w: 40, h: 66 });       // 망원경

    // 작업실 소품
    list.push({ x: 28, y: 206, w: 24, h: 108 });        // 선반
    list.push({ x: 586, y: 288, w: 22, h: 26 });        // 화분
    list.push({ x: 34, y: 306, w: 22, h: 24 });
    list.push({ x: 28, y: 84, w: 22, h: 24 });          // 서류 상자
    list.push({ x: 556, y: 96, w: 40, h: 56 });         // 정수기
    list.push({ x: 26, y: 116, w: 48, h: 82 });         // 파일 캐비닛

    // 회의실 화분
    list.push({ x: 694, y: 306, w: 24, h: 28 });
    list.push({ x: 1216, y: 304, w: 24, h: 26 });
    list.push({ x: 686, y: 228, w: 50, h: 62 });        // 사이드보드

    return list;
  }

  const OBSTACLES = buildObstacles();

  function seatFor(agent) {
    if (!agent) return SPAWN.workspace;
    const zone = SEATS[agent.location] ? agent.location : "workspace";
    const seats = SEATS[zone];
    if (!seats || !seats.length) return SPAWN[zone] || SPAWN.workspace;
    return seats[hashOf(agent.id || agent.name || "x") % seats.length];
  }

  function spawnFor(zone) {
    return SPAWN[zone] || SPAWN.workspace;
  }

  /* ---------------- 캐릭터 ---------------- */

  function drawCharacter(g, c, t) {
    const x = c.x;
    const y = c.y;
    const SCALE = 1.1;
    g.save();
    g.translate(x, y);
    g.scale(SCALE, SCALE);
    g.translate(-x, -y);

    const color = colorOf(c);
    const dark = shade(color, -0.38);
    const light = shade(color, 0.28);
    const glyph = c.glyph || glyphFor(c);
    const isMe = !!c.isMe;
    const bob = c.moving ? Math.abs(Math.sin(c.walkT * 9)) * 2.2 : Math.sin(c.walkT * 2.0) * 0.8;
    const swing = c.moving ? Math.sin(c.walkT * 9) * 3.2 : 0;
    const variant = hashOf(c.id || c.name || "x") % 3;

    // 그림자
    g.save();
    g.globalAlpha = isMe ? 0.32 : 0.24;
    g.fillStyle = "#160d20";
    g.beginPath();
    g.ellipse(x, y + 1, 12, 4.6, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // 내 캐릭터 표시 링
    if (isMe) {
      g.save();
      g.globalAlpha = 0.55 + Math.sin(t * 3) * 0.16;
      g.strokeStyle = "#ffd166";
      g.lineWidth = 2;
      g.setLineDash([5, 4]);
      g.beginPath();
      g.ellipse(x, y + 1, 16, 7, 0, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }

    // 발
    px(g, x - 8 + swing, y - 7, 7, 6, "#3b2a4f");
    px(g, x + 1 - swing, y - 7, 7, 6, "#3b2a4f");
    px(g, x - 8 + swing, y - 3, 7, 2, "#231a30");
    px(g, x + 1 - swing, y - 3, 7, 2, "#231a30");

    // 몸통
    const bodyTop = y - 25 - bob;
    px(g, x - 9, bodyTop, 18, 19, color);
    px(g, x - 9, bodyTop, 18, 3, light);
    px(g, x - 9, bodyTop + 15, 18, 4, dark);
    px(g, x - 9, bodyTop, 2, 19, dark);

    // 팔
    px(g, x - 11 + swing * 0.4, bodyTop + 4, 3, 8, dark);
    px(g, x + 8 - swing * 0.4, bodyTop + 4, 3, 8, dark);

    // 머리
    const hy = y - 40 - bob;
    px(g, x - 10, hy, 20, 18, dark);
    px(g, x - 9, hy + 1, 18, 16, "#fff4e4");
    px(g, x - 9, hy + 1, 18, 3, "#ffffff");

    // 얼굴 (한국어 자음)
    g.fillStyle = "#2b1f3d";
    g.font = "bold 12px 'Galmuri11','Malgun Gothic',sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(glyph, x, hy + 9.5);
    g.textAlign = "left";
    g.textBaseline = "alphabetic";

    // 볼
    px(g, x - 7, hy + 11, 3, 2, "rgba(255,140,160,0.55)");
    px(g, x + 4, hy + 11, 3, 2, "rgba(255,140,160,0.55)");

    // 머리 장식
    if (variant === 0) {
      px(g, x - 1, hy - 4, 2, 4, dark);
      px(g, x - 2, hy - 7, 4, 4, "#ffd166");
    } else if (variant === 1) {
      g.fillStyle = "#4caf72";
      g.beginPath();
      g.ellipse(x + 2, hy - 3, 4, 3, -0.5, 0, Math.PI * 2);
      g.fill();
    } else {
      px(g, x - 8, hy - 3, 16, 3, dark);
      px(g, x + 3, hy - 6, 6, 4, "#ffd166");
    }

    // 상태 표시등
    const online = c.online !== false;
    g.beginPath();
    g.arc(x + 12, hy + 2, 2.6, 0, Math.PI * 2);
    g.fillStyle = online ? "#5ef2c0" : "#7d7391";
    g.fill();

    if (c.plain) { g.restore(); return; }

    // 이름표
    const name = String(c.name || "피클");
    const role = String(c.role || "");
    g.font = "600 9px 'Galmuri11','Malgun Gothic',sans-serif";
    const nameW = Math.max(26, g.measureText(name).width + (isMe ? 18 : 10));
    const tagX = x - nameW / 2;
    const tagY = hy - 16;
    g.save();
    g.globalAlpha = 0.82;
    roundRect(g, tagX, tagY, nameW, 13, 4, isMe ? "#3a2a10" : "#241a36");
    g.restore();
    if (isMe) {
      g.strokeStyle = "#ffd166";
      g.lineWidth = 1;
      roundRect(g, tagX, tagY, nameW, 13, 4, null);
      g.stroke();
    }
    g.fillStyle = isMe ? "#ffd166" : "#f2ebff";
    g.textAlign = "center";
    g.fillText(name, x, tagY + 9);
    g.textAlign = "left";

    if (role) {
      g.font = "8px 'Galmuri11','Malgun Gothic',sans-serif";
      g.textAlign = "center";
      const roleW = g.measureText(role).width + 8;
      roundRect(g, x - roleW / 2, tagY - 12, roleW, 11, 3, "rgba(20,14,32,0.72)");
      g.fillStyle = "#c9b7ea";
      g.fillText(role.slice(0, 12), x, tagY - 4);
      g.textAlign = "left";
    }

    // 내 캐릭터 화살표
    if (isMe) {
      const ay = tagY - (role ? 24 : 12) - 8 + Math.sin(t * 4) * 2;
      g.fillStyle = "#ffd166";
      g.beginPath();
      g.moveTo(x - 5, ay);
      g.lineTo(x + 5, ay);
      g.lineTo(x, ay + 6);
      g.closePath();
      g.fill();
    }

    g.restore();
  }

  /* ---------------- 타이틀 화면 ---------------- */

  function drawTitleScene(g, w, h, t) {
    const horizon = h * 0.78;

    /* 하늘 */
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#150e29");
    sky.addColorStop(0.3, "#33204f");
    sky.addColorStop(0.58, "#703560");
    sky.addColorStop(0.82, "#b95f68");
    sky.addColorStop(1, "#eb9a6e");
    g.fillStyle = sky;
    g.fillRect(0, 0, w, horizon);

    /* 별 */
    g.save();
    for (let i = 0; i < 120; i++) {
      const sx = (hashOf("ts" + i) % 1000) / 1000 * w;
      const sy = (hashOf("ty" + i) % 1000) / 1000 * horizon * 0.7;
      const tw = 0.28 + 0.72 * Math.abs(Math.sin(t * (0.5 + (i % 6) * 0.15) + i));
      g.globalAlpha = tw * 0.85;
      g.fillStyle = i % 9 === 0 ? "#ffd9a0" : "#ffffff";
      const size = i % 13 === 0 ? 2 : 1;
      g.fillRect(sx, sy, size, size);
    }
    g.restore();

    /* 달 */
    const mx = w * 0.84;
    const my = h * 0.16;
    const mr = Math.min(w, h) * 0.072;
    const glow = g.createRadialGradient(mx, my, mr * 0.4, mx, my, mr * 4.4);
    glow.addColorStop(0, "rgba(255,238,190,0.34)");
    glow.addColorStop(0.42, "rgba(255,214,150,0.10)");
    glow.addColorStop(1, "rgba(255,214,150,0)");
    g.fillStyle = glow;
    g.beginPath(); g.arc(mx, my, mr * 4.4, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff3cf";
    g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(226,196,140,0.5)";
    g.beginPath(); g.arc(mx - mr * 0.3, my - mr * 0.18, mr * 0.2, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(mx + mr * 0.34, my + mr * 0.26, mr * 0.13, 0, Math.PI * 2); g.fill();

    /* 구름 */
    g.save();
    g.globalAlpha = 0.15;
    for (let i = 0; i < 4; i++) {
      const cw = w * (0.2 + i * 0.05);
      const cx = ((hashOf("cl" + i) % 1000) / 1000) * w + Math.sin(t * 0.05 + i) * 26;
      const cy = horizon * (0.46 + i * 0.1);
      px(g, cx, cy, cw, 7, "#ffd6c0");
      px(g, cx + cw * 0.16, cy - 6, cw * 0.46, 7, "#ffd6c0");
    }
    g.restore();

    /* 원경 스카이라인 */
    for (let i = 0; i < 18; i++) {
      const bw = w / 22 + (hashOf("bw" + i) % 30);
      const bh = horizon * (0.09 + (hashOf("bh" + i) % 24) / 100);
      const bx = i * (w / 17) - 12;
      g.fillStyle = "#241637";
      g.fillRect(bx, horizon - bh, bw, bh);
      g.fillStyle = "rgba(255,208,120,0.4)";
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
          if (hashOf("win" + i + r + c) % 3 === 0) {
            g.fillRect(bx + 7 + c * 11, horizon - bh + 8 + r * 12, 4, 5);
          }
        }
      }
    }

    /* 오피스 타워 */
    const tw2 = Math.min(w * 0.26, 520);
    const tx = w * 0.79 - tw2 / 2;
    const ty = horizon * 0.36;
    const towerH = horizon - ty;
    g.fillStyle = "#2b1f42";
    g.fillRect(tx, ty, tw2, towerH);
    px(g, tx, ty, tw2, 8, "#43305f");
    px(g, tx, ty, 6, towerH, "#392a54");
    px(g, tx + tw2 - 6, ty, 6, towerH, "#211735");

    // 옥상 안테나 + 표지
    px(g, tx + tw2 / 2 - 2, ty - 30, 4, 30, "#4a3768");
    g.fillStyle = "#ff5d7a";
    g.beginPath();
    g.arc(tx + tw2 / 2, ty - 32, 3 + Math.sin(t * 3) * 1.2, 0, Math.PI * 2);
    g.fill();

    const signW = Math.min(tw2 * 0.8, 260);
    const signX = tx + tw2 / 2 - signW / 2;
    px(g, signX, ty + 18, signW, 30, "#160f26");
    g.strokeStyle = "#ffd166";
    g.lineWidth = 2;
    g.strokeRect(signX + 1, ty + 19, signW - 2, 28);
    g.fillStyle = "#ffd166";
    g.font = "bold " + Math.max(11, Math.round(tw2 * 0.052)) + "px 'Galmuri11','Malgun Gothic',sans-serif";
    g.textAlign = "center";
    g.fillText("합동 비서실", tx + tw2 / 2, ty + 40);
    g.textAlign = "left";

    // 창문
    const cols = 6;
    const rows = 8;
    const cw2 = (tw2 - 44) / cols;
    const chh = (towerH - 90) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lit = (hashOf("L" + r + c) % 5) !== 0;
        const wx = tx + 22 + c * cw2 + 3;
        const wy = ty + 60 + r * chh;
        if (wy + chh * 0.55 > horizon - 6) continue;
        g.fillStyle = lit ? (hashOf("warm" + r + c) % 4 === 0 ? "rgba(255,180,120,0.95)" : "rgba(255,226,150,0.9)") : "#1b1330";
        g.fillRect(wx, wy, cw2 - 7, chh * 0.55);
        if (lit) {
          g.fillStyle = "rgba(40,25,10,0.35)";
          g.fillRect(wx + 2, wy + chh * 0.28, cw2 - 11, 1.5);
        }
      }
    }

    // 입구 불빛
    const doorW = Math.min(tw2 * 0.22, 64);
    px(g, tx + tw2 / 2 - doorW / 2, horizon - 44, doorW, 44, "#ffcf5c");
    px(g, tx + tw2 / 2 - doorW / 2 + 6, horizon - 38, doorW - 12, 34, "#3a2a14");

    /* 거리 */
    px(g, 0, horizon, w, h - horizon, "#171024");
    px(g, 0, horizon, w, 3, "#4a3768");
    px(g, 0, h * 0.84, w, 6, "#2c2140");
    px(g, 0, h * 0.845, w, h * 0.155, "#221830");

    g.save();
    g.globalAlpha = 0.2;
    g.strokeStyle = "#8b74b8";
    g.lineWidth = 1;
    for (let x = -w * 0.2; x < w * 1.2; x += 74) {
      g.beginPath();
      g.moveTo(w / 2 + (x - w / 2) * 0.35, horizon + 4);
      g.lineTo(x, h);
      g.stroke();
    }
    for (let y = horizon + 16; y < h; y += 26) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }
    g.restore();

    // 횡단보도
    g.save();
    g.globalAlpha = 0.12;
    for (let i = 0; i < 9; i++) {
      px(g, w * 0.06 + i * 34, h * 0.885, 20, 6, "#ffffff");
    }
    g.restore();

    /* 가로등 */
    [[w * 0.075, 1], [w * 0.955, -1]].forEach(function (lamp) {
      const lx = lamp[0];
      const base = h * 0.845;
      px(g, lx - 2, base - h * 0.2, 4, h * 0.2, "#3a2b52");
      px(g, lx - 12, base - h * 0.2 - 6, 24, 8, "#4a3768");
      const lg = g.createRadialGradient(lx, base - h * 0.19, 4, lx, base - h * 0.19, 90);
      lg.addColorStop(0, "rgba(255,214,130,0.35)");
      lg.addColorStop(1, "rgba(255,214,130,0)");
      g.fillStyle = lg;
      g.beginPath(); g.arc(lx, base - h * 0.19, 90, 0, Math.PI * 2); g.fill();
      px(g, lx - 8, base - h * 0.2 - 4, 16, 5, "#ffe6a7");
    });

    /* 걷는 피클들 */
    const walkers = [
      { color: "#ff87bd", glyph: "ㅈ", y: h * 0.895, speed: 30, off: 0.0, scale: 2.5, dir: 1 },
      { color: "#6fa8ff", glyph: "ㅅ", y: h * 0.94, speed: 22, off: 0.45, scale: 2.9, dir: -1 },
      { color: "#5ed3a3", glyph: "ㅁ", y: h * 0.9, speed: 26, off: 0.75, scale: 2.2, dir: 1 },
      { color: "#ffc94d", glyph: "ㄱ", y: h * 0.965, speed: 18, off: 0.25, scale: 3.2, dir: -1 }
    ];
    walkers.forEach(function (wk, i) {
      const span = w + 260;
      const base = (t * wk.speed + wk.off * span) % span;
      const x = wk.dir > 0 ? base - 130 : w + 130 - base;
      g.save();
      g.translate(x, wk.y + Math.sin(t * 2 + i) * 1.5);
      g.scale(wk.dir * wk.scale, wk.scale);
      drawCharacter(g, {
        id: "title" + i,
        name: "",
        role: "",
        x: 0,
        y: 0,
        glyph: wk.glyph,
        color: wk.color,
        moving: true,
        walkT: t * 1.4 + i,
        online: true,
        isMe: false,
        plain: true
      }, t);
      g.restore();
    });

    /* 불티 */
    g.save();
    for (let i = 0; i < 20; i++) {
      const fx = ((hashOf("fx" + i) % 1000) / 1000) * w;
      const fy = horizon * 0.9 - ((t * 14 + i * 40) % (horizon * 0.5)) + Math.sin(t * 0.8 + i) * 16;
      g.globalAlpha = 0.35 + 0.35 * Math.sin(t * 1.6 + i);
      px(g, fx, fy, 2, 2, i % 3 === 0 ? "#ffd166" : "#ff9fb8");
    }
    g.restore();

    /* 위아래 비네트 */
    const top = g.createLinearGradient(0, 0, 0, h * 0.22);
    top.addColorStop(0, "rgba(8,4,16,0.7)");
    top.addColorStop(1, "rgba(8,4,16,0)");
    g.fillStyle = top;
    g.fillRect(0, 0, w, h * 0.22);
    const bot = g.createLinearGradient(0, h * 0.72, 0, h);
    bot.addColorStop(0, "rgba(8,4,16,0)");
    bot.addColorStop(1, "rgba(8,4,16,0.82)");
    g.fillStyle = bot;
    g.fillRect(0, h * 0.72, w, h * 0.28);
  }

  window.OfficeArt = {
    W: W,
    H: H,
    COLORS: COLORS,
    ROOMS: ROOMS,
    ROOM_ORDER: ROOM_ORDER,
    WALLS: WALLS,
    SPAWN: SPAWN,
    OBSTACLES: OBSTACLES,
    COLORS_KEYS: Object.keys(COLORS),
    paint: paint,
    drawCharacter: drawCharacter,
    drawTitleScene: drawTitleScene,
    glyphFor: glyphFor,
    colorOf: colorOf,
    shade: shade,
    seatFor: seatFor,
    spawnFor: spawnFor,
    hashOf: hashOf
  };
})();
