/* =========================================================
   app.js — 합동 비서실 화면 로직
   오피스 맵 · 회의실 · 작업실
   ========================================================= */

(function () {
  "use strict";

  const Store = window.OfficeStore;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

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
  const COLOR_KEYS = Object.keys(COLORS);

  const ROOMS = {
    meeting: { name: "회의실", icon: "🗓️" },
    workspace: { name: "작업실", icon: "💻" },
    lounge: { name: "라운지", icon: "☕" },
    away: { name: "부재중", icon: "🌙" }
  };
  const STATUS_COLS = [
    { key: "todo", name: "할 일" },
    { key: "doing", name: "진행 중" },
    { key: "done", name: "완료" }
  ];

  const CLIENT_KEY = "pickle-office-client";
  const PRESETS = (window.OFFICE_SETTINGS && window.OFFICE_SETTINGS.profiles) || {};
  const DESKS = (window.OFFICE_SETTINGS && window.OFFICE_SETTINGS.desks) || 6;
  const ONLINE_MS = (window.OFFICE_SETTINGS && window.OFFICE_SETTINGS.onlineWindowMs) || 180000;

  const state = {
    agents: {}, chat: {}, tasks: {}, notes: {}, agenda: {}, decisions: {},
    me: null,
    authUser: null,
    tab: "map",
    modalSubmit: null,
    setupOpen: false,
    chatDirty: true
  };

  /* ---------------- 작은 도구들 ---------------- */

  function h(tag, props) {
    const node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((key) => {
        const value = props[key];
        if (value === undefined || value === null || value === false) return;
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key === "dataset") Object.assign(node.dataset, value);
        else if (key === "style" && typeof value === "object") {
          Object.keys(value).forEach((prop) => {
            if (prop.slice(0, 2) === "--") node.style.setProperty(prop, value[prop]);
            else node.style[prop] = value[prop];
          });
        }
        else if (key.slice(0, 2) === "on" && typeof value === "function") {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (value === true) node.setAttribute(key, "");
        else node.setAttribute(key, value);
      });
    }
    for (let i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }

  function append(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach((c) => append(node, c)); return; }
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function colorOf(agent) {
    const key = (agent && agent.color) || "purple";
    return COLORS[key] || (/^#/.test(key) ? key : COLORS.purple);
  }

  function initialOf(name) {
    if (!name) return "?";
    const first = String(name).trim()[0] || "?";
    return first;
  }

  function isOnline(agent) {
    return !!agent && Date.now() - (agent.updatedAt || 0) < ONLINE_MS;
  }

  function fmtTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function fmtWhen(ts) {
    if (!ts) return "기록 없음";
    const diff = Date.now() - ts;
    if (diff < 60 * 1000) return "방금";
    if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + "분 전";
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + "시간 전";
    const d = new Date(ts);
    return (d.getMonth() + 1) + "월 " + d.getDate() + "일";
  }

  function byTime(a, b) { return (a.ts || a.createdAt || 0) - (b.ts || b.createdAt || 0); }

  function values(obj) { return Object.keys(obj || {}).map((k) => Object.assign({ id: k }, obj[k] || {})); }

  /* 서버에 이미 내 프로필이 있는지 첫 스냅샷을 잠깐 기다립니다 */
  function waitForAgents(timeoutMs) {
    if (Store.has && Store.has("agents")) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        try { off(); } catch (e) { /* ignore */ }
        resolve();
      };
      const off = Store.on("agents", () => { if (!settled) setTimeout(done, 80); });
      setTimeout(done, timeoutMs || 4000);
    });
  }

  /* ---------------- 내 정체성 : 인증 계정(uid) = 내 피클 ---------------- */

  const CLIENT = (function () {
    let id = null;
    try { id = window.localStorage.getItem(CLIENT_KEY); } catch (e) { /* ignore */ }
    if (!id) {
      id = "c_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      try { window.localStorage.setItem(CLIENT_KEY, id); } catch (e) { /* ignore */ }
    }
    return id;
  })();

  function currentUser() { return Store.user ? Store.user() : null; }

  function myAgent() {
    const user = currentUser();
    if (!user || !user.uid) return null;
    const record = state.agents[user.uid];
    if (!record) return null;
    return Object.assign({ id: user.uid }, record);
  }

  function requireMe() {
    if (myAgent()) return true;
    const user = currentUser();
    if (!user) { showGate(); toast("로그인이 필요해요"); return false; }
    toast("내 피클 프로필을 먼저 만들어 주세요");
    openSetupModal(user);
    return false;
  }

  function presetFor(email) {
    if (!email) return null;
    return PRESETS[String(email).toLowerCase()] || null;
  }

  async function touchPresence() {
    const me = myAgent();
    if (!me) return;
    try { await Store.update("agents", me.id, { updatedAt: Date.now(), client: CLIENT }); }
    catch (e) { /* ignore */ }
  }

  /* 첫 로그인: 프리셋이 있으면 그 값으로 만들고, 없으면 프로필 입력 창을 엽니다 */
  async function ensureProfile(user) {
    if (!user || !user.uid) return;
    if (state.agents[user.uid]) { await touchPresence(); return; }
    // 첫 스냅샷 전에 쓰면 기존 프로필을 덮어쓸 수 있으므로 기다립니다
    if (!(Store.has && Store.has("agents"))) {
      toast("오피스 데이터를 아직 불러오지 못했어요. 연결을 확인해 주세요");
      return;
    }
    const preset = presetFor(user.email);
    if (!preset) { openSetupModal(user); return; }
    const name = preset.name || (user.email || "").split("@")[0] || "피클";
    await Store.set("agents", user.uid, {
      name,
      initial: preset.initial || initialOf(name),
      color: preset.color || "purple",
      role: preset.role || "",
      location: preset.location || "workspace",
      desk: typeof preset.desk === "number" ? preset.desk : null,
      status: preset.status || "오피스 접속 중",
      email: user.email || "",
      updatedAt: Date.now(),
      client: CLIENT
    });
    toast(name + " 피클로 입장했어요");
  }

  /* ---------------- 모달 ---------------- */

  const dialog = $("#modal");

  function field(labelText, input, hintText) {
    return h("div", { class: "field" },
      h("label", { text: labelText }),
      input,
      hintText ? h("span", { class: "small muted", text: hintText }) : null
    );
  }

  function openModal(options) {
    const body = $("#modalBody");
    clear(body);
    $("#modalTitle").textContent = options.title || "";
    append(body, options.body || []);
    const ok = $("#modalOk");
    ok.textContent = options.okText || "확인";
    const cancel = $(".modal-foot .btn.ghost");
    cancel.hidden = !!options.hideCancel;
    state.modalSubmit = options.onSubmit || null;
    if (!dialog.open) dialog.showModal();
    const first = body.querySelector("input, textarea, select");
    if (first) setTimeout(() => { try { first.focus(); } catch (e) { /* ignore */ } }, 60);
  }

  function closeModal() {
    state.modalSubmit = null;
    if (dialog.open) dialog.close();
  }

  $("#modalForm").addEventListener("submit", function (event) {
    const action = event.submitter ? event.submitter.value : "cancel";
    if (action !== "ok") { state.modalSubmit = null; return; }
    event.preventDefault();
    const handler = state.modalSubmit;
    if (!handler) { closeModal(); return; }
    Promise.resolve()
      .then(handler)
      .then((result) => { if (result !== false) closeModal(); })
      .catch((err) => { console.error(err); toast("저장하지 못했어요"); });
  });

  dialog.addEventListener("close", function () { state.modalSubmit = null; state.setupOpen = false; });

  /* ---------------- 내 프로필 ---------------- */

  function swatchPicker(initialKey) {
    let picked = COLOR_KEYS.indexOf(initialKey) >= 0 ? initialKey : "purple";
    const el = h("div", { class: "swatches" });
    COLOR_KEYS.forEach((key) => {
      const sw = h("button", {
        type: "button", class: "swatch" + (key === picked ? " is-on" : ""),
        style: { "--c": COLORS[key] }, "aria-label": key
      });
      sw.addEventListener("click", () => {
        picked = key;
        $$(".swatch", el).forEach((s) => s.classList.remove("is-on"));
        sw.classList.add("is-on");
      });
      el.append(sw);
    });
    return { el: el, picked: () => picked };
  }

  /* 처음 로그인한 계정: 자기 피클 프로필을 만들어 /office/agents/{uid} 에 저장 */
  function openSetupModal(user) {
    if (!user || !user.uid) return;
    if (state.setupOpen) return;
    const email = user.email || "";
    const nameInput = h("input", { type: "text", maxlength: "20", placeholder: "예: 찐구리", autocomplete: "off" });
    const initialInput = h("input", { type: "text", maxlength: "2", placeholder: "자동", autocomplete: "off" });
    const roleInput = h("input", { type: "text", maxlength: "30", placeholder: "예: 여행 담당 (선택)" });
    const swatches = swatchPicker("pink");

    state.setupOpen = true;
    openModal({
      title: "내 피클 프로필",
      okText: "시작하기",
      hideCancel: true,
      body: [
        h("p", { class: "hint", text: (email ? email + " 계정으로 인증됐어요. " : "") + "오피스에 표시할 내 피클을 정해 주세요. 이 이름과 색깔이 오피스 맵에 나타나요." }),
        field("이름", nameInput),
        field("이니셜 (선택)", initialInput, "비워 두면 이름 첫 글자를 써요"),
        field("역할 (선택)", roleInput),
        field("색깔", swatches.el)
      ],
      onSubmit: async () => {
        const name = nameInput.value.trim();
        if (!name) { toast("이름을 입력해 주세요"); nameInput.focus(); return false; }
        await Store.set("agents", user.uid, {
          name: name,
          initial: initialInput.value.trim() || initialOf(name),
          color: swatches.picked(),
          role: roleInput.value.trim(),
          location: "workspace",
          desk: null,
          status: "오피스 접속 중",
          email: email,
          updatedAt: Date.now(),
          client: CLIENT
        });
        state.setupOpen = false;
        renderAll();
        toast(name + " 피클로 입장했어요");
      }
    });
  }

  function openProfileModal() {
    const me = myAgent();
    if (!me) {
      const user = currentUser();
      if (user) openSetupModal(user);
      else showGate();
      return;
    }

    const nameInput = h("input", { type: "text", maxlength: "20", value: me.name || "" });
    const initialInput = h("input", { type: "text", maxlength: "2", value: me.initial || "" });
    const roleInput = h("input", { type: "text", maxlength: "30", value: me.role || "", placeholder: "예: 자료 조사 담당" });
    const statusInput = h("input", { type: "text", maxlength: "60", value: me.status || "", placeholder: "예: 원료 발주 확인 중" });
    const swatches = swatchPicker(me.color || "purple");

    openModal({
      title: "내 프로필",
      okText: "저장",
      body: [
        field("이름", nameInput),
        field("이니셜", initialInput),
        field("역할", roleInput),
        field("상태 메시지", statusInput, "오피스 맵에 함께 표시돼요"),
        field("색깔", swatches.el),
        h("div", { class: "small muted" }, "현재 위치: ", ROOMS[me.location] ? ROOMS[me.location].name : "부재중", me.desk ? " · " + me.desk + "번 자리" : ""),
        me.email ? h("div", { class: "small muted" }, "로그인 계정: ", me.email) : null
      ],
      onSubmit: async () => {
        const name = nameInput.value.trim();
        if (!name) { toast("이름을 입력해 주세요"); return false; }
        await Store.update("agents", me.id, {
          name: name,
          initial: initialInput.value.trim() || initialOf(name),
          role: roleInput.value.trim(),
          status: statusInput.value.trim(),
          color: swatches.picked(),
          updatedAt: Date.now(),
          client: CLIENT
        });
        renderAll();
        toast("프로필을 저장했어요");
      }
    });
  }

  /* ---------------- 이동 ---------------- */

  async function moveTo(zone, desk) {
    if (!requireMe()) return;
    const me = myAgent();
    if (zone === "workspace" && desk) {
      const occupied = values(state.agents).find((a) => a.id !== me.id && a.location === "workspace" && Number(a.desk) === desk);
      if (occupied) { toast(occupied.name + " 님이 쓰고 있는 자리예요"); return; }
    }
    const patch = {
      location: zone,
      desk: zone === "workspace" && desk ? desk : null,
      updatedAt: Date.now(),
      client: CLIENT
    };
    if (zone === "away" && !(me.status || "").trim()) patch.status = "자리 비움";
    await Store.update("agents", me.id, patch);
    toast(ROOMS[zone].name + (patch.desk ? " " + patch.desk + "번 자리" : "") + "로 이동했어요");
  }

  /* ---------------- 렌더: 공통 ---------------- */

  function agentChip(agent, options) {
    const opts = options || {};
    const mine = state.me && agent.id === state.me.id;
    const chip = h("button", {
      type: "button",
      class: "agent" + (mine ? " is-me" : ""),
      dataset: { agent: agent.id },
      title: (agent.status || "") + " · " + (ROOMS[agent.location] ? ROOMS[agent.location].name : "부재중")
    },
      h("span", { class: "avatar", style: { "--c": colorOf(agent) } },
        agent.initial || initialOf(agent.name),
        h("span", { class: "dot-live" + (isOnline(agent) ? "" : " off") })
      ),
      h("span", { class: "agent-meta" },
        h("span", { class: "agent-name", text: (agent.name || "이름 없음") + (mine ? " (나)" : "") }),
        opts.showStatus === false ? null : h("span", { class: "agent-status", text: agent.status || "상태 메시지 없음" })
      )
    );
    return chip;
  }

  function renderBadge() {
    const badge = $("#dbBadge");
    badge.classList.remove("live", "pending");
    const status = Store.status;
    const signedIn = !!currentUser();
    if (Store.mode !== "firebase") {
      badge.textContent = "Firebase 설정 필요";
      badge.classList.add("pending");
    } else if (status === "error") {
      badge.textContent = "인증 서버에 연결하지 못했어요";
      badge.classList.add("pending");
    } else if (!signedIn) {
      badge.textContent = "로그인 필요";
      badge.classList.add("pending");
    } else if (status === "live") {
      badge.textContent = "실시간 동기화 중";
      badge.classList.add("live");
    } else if (status === "denied") {
      badge.textContent = "접근 권한 없음 · 보안 규칙 확인";
      badge.classList.add("pending");
    } else if (status === "offline") {
      badge.textContent = "실시간 DB 연결 끊김 · 재연결 중";
      badge.classList.add("pending");
    } else {
      badge.textContent = "실시간 DB 연결 중…";
      badge.classList.add("pending");
    }
    let foot = "Firebase Realtime Database";
    if (Store.mode !== "firebase") foot = "Firebase 설정 없음";
    else if (!signedIn) foot = "로그인 전 · 데이터 잠김";
    else if (status === "live") foot = "인증된 세션 · 실시간 동기화";
    $("#footerMode").textContent = foot;
  }

  function renderMe() {
    const me = myAgent();
    const user = currentUser();
    const avatar = $("#meAvatar");
    const name = $("#meName");
    if (me) {
      avatar.textContent = me.initial || initialOf(me.name);
      avatar.style.background = colorOf(me);
      name.textContent = me.name;
    } else if (user) {
      avatar.textContent = (user.email || "?").slice(0, 1).toUpperCase();
      avatar.style.background = COLORS.purple;
      name.textContent = "프로필 설정";
    } else {
      avatar.textContent = "?";
      avatar.style.background = COLORS.purple;
      name.textContent = "내 피클";
    }
  }

  /* ---------------- 렌더: 오피스 맵 ---------------- */

  function sortedAgents(list) {
    return list.slice().sort((a, b) => {
      const mineA = state.me && a.id === state.me.id ? 0 : 1;
      const mineB = state.me && b.id === state.me.id ? 0 : 1;
      if (mineA !== mineB) return mineA - mineB;
      const onlineA = isOnline(a) ? 0 : 1;
      const onlineB = isOnline(b) ? 0 : 1;
      if (onlineA !== onlineB) return onlineA - onlineB;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }

  function renderMap() {
    const agents = values(state.agents);
    const me = myAgent();

    // 빠른 이동
    const quick = $("#quickMove");
    clear(quick);
    Object.keys(ROOMS).forEach((zone) => {
      const here = me && me.location === zone && !(zone === "workspace" && me.desk);
      quick.append(h("button", {
        type: "button",
        class: "chip-btn" + (here ? " is-here" : ""),
        dataset: { zone: zone },
        onclick: () => moveTo(zone, null)
      }, ROOMS[zone].icon + " " + ROOMS[zone].name));
    });

    // 구역별 인원
    Object.keys(ROOMS).forEach((zone) => {
      const count = agents.filter((a) => a.location === zone).length;
      const badge = $('[data-count="' + zone + '"]');
      if (badge) badge.textContent = String(count);
      const empty = $('[data-empty="' + zone + '"]');
      if (empty) empty.hidden = count > 0;
    });

    // 작업실 책상
    const desks = $("#desks");
    clear(desks);
    for (let n = 1; n <= DESKS; n++) {
      const occupant = sortedAgents(agents.filter((a) => a.location === "workspace" && Number(a.desk) === n))[0];
      const mine = occupant && me && occupant.id === me.id;
      const desk = h("button", {
        type: "button",
        class: "desk" + (mine ? " is-mine" : "") + (occupant ? " is-taken" : ""),
        dataset: { desk: String(n) },
        "aria-label": n + "번 자리" + (occupant ? " · " + occupant.name : " · 빈자리")
      },
        h("span", { class: "desk-label", text: n + "번" }),
        occupant
          ? h("span", { class: "desk-occupant" },
              h("span", { class: "avatar sm", style: { "--c": colorOf(occupant) } }, occupant.initial || initialOf(occupant.name)),
              h("span", { class: "agent-name", text: occupant.name })
            )
          : h("span", { class: "desk-empty", text: "빈자리" })
      );
      desks.append(desk);
    }

    // 구역별 아바타
    Object.keys(ROOMS).forEach((zone) => {
      const holder = $('[data-agents="' + zone + '"]');
      if (!holder) return;
      clear(holder);
      let list;
      if (zone === "workspace") {
        list = agents.filter((a) => a.location === "workspace" && !a.desk);
      } else {
        list = agents.filter((a) => a.location === zone);
      }
      sortedAgents(list).forEach((agent) => holder.append(agentChip(agent)));
    });
  }

  function openAgentCard(agent) {
    const mine = state.me && agent.id === state.me.id;
    const where = ROOMS[agent.location] ? ROOMS[agent.location].name : "부재중";
    openModal({
      title: agent.name || "피클",
      okText: mine ? "프로필 수정" : "닫기",
      hideCancel: !mine,
      body: [
        h("div", { class: "participant" },
          h("span", { class: "avatar lg", style: { "--c": colorOf(agent) } }, agent.initial || initialOf(agent.name)),
          h("div", { class: "agent-meta" },
            h("span", { class: "agent-name", text: agent.name || "" }),
            h("span", { class: "agent-status", text: agent.status || "상태 메시지 없음" })
          )
        ),
        h("div", { class: "small" }, "위치: ", where, agent.desk ? " · " + agent.desk + "번 자리" : ""),
        agent.role ? h("div", { class: "small" }, "역할: ", agent.role) : null,
        h("div", { class: "small muted" }, "최근 활동: ", fmtWhen(agent.updatedAt), isOnline(agent) ? " · 접속 중" : " · 자리 비움")
      ],
      onSubmit: () => {
        if (!mine) return true;
        openProfileModal(); // 같은 창에서 내용만 바꿔요
        return false;
      }
    });
  }

  /* ---------------- 렌더: 회의실 ---------------- */

  function renderMeeting() {
    const agents = values(state.agents);
    const inRoom = sortedAgents(agents.filter((a) => a.location === "meeting"));

    $("#meetingCount").textContent = String(inRoom.length);
    $("#meetingCountSide").textContent = String(inRoom.length);

    const list = $("#participants");
    clear(list);
    if (!inRoom.length) {
      list.append(h("p", { class: "empty-note", text: "아직 회의실에 아무도 없어요. 아래 버튼으로 들어와 보세요." }));
    } else {
      inRoom.forEach((agent) => {
        list.append(h("div", { class: "participant" },
          h("span", { class: "avatar", style: { "--c": colorOf(agent) } },
            agent.initial || initialOf(agent.name),
            h("span", { class: "dot-live" + (isOnline(agent) ? "" : " off") })),
          h("div", { class: "agent-meta" },
            h("span", { class: "agent-name", text: agent.name }),
            h("span", { class: "agent-status", text: agent.status || "" })
          )
        ));
      });
    }

    // 채팅
    const log = $("#chatLog");
    const messages = values(state.chat).sort(byTime).slice(-300);
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
    const prevCount = Number(log.dataset.count || 0);
    clear(log);
    if (!messages.length) {
      log.append(h("p", { class: "empty-note", text: "첫 메시지를 남겨 보세요." }));
    }
    messages.forEach((m) => {
      const meNow = myAgent();
      const mine = m.agentId ? (state.me && m.agentId === state.me.id) : (!!meNow && m.name === meNow.name);
      log.append(h("div", { class: "msg" + (mine ? " mine" : "") },
        h("span", { class: "avatar sm", style: { "--c": COLORS[m.color] || m.color || COLORS.purple } }, m.initial || initialOf(m.name)),
        h("div", { class: "msg-body" },
          h("div", { class: "msg-head" },
            h("span", { class: "msg-name", text: m.name || "익명 피클" }),
            h("span", { class: "msg-time", text: fmtTime(m.ts) })
          ),
          h("div", { class: "msg-text", text: m.text || "" })
        )
      ));
    });
    log.dataset.count = String(messages.length);
    if (nearBottom || messages.length !== prevCount) {
      requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
    }
    $("#chatMeta").textContent = messages.length ? messages.length + "개 메시지" : "";

    // 안건
    const agendaList = $("#agendaList");
    clear(agendaList);
    const agenda = values(state.agenda).sort(byTime);
    if (!agenda.length) agendaList.append(h("li", { class: "empty-note", text: "안건이 아직 없어요." }));
    agenda.forEach((item) => {
      agendaList.append(h("li", { class: "pin-item" + (item.done ? " done" : "") },
        h("button", {
          type: "button", class: "pin-check", title: item.done ? "완료 취소" : "완료 표시",
          onclick: () => Store.update("agenda", item.id, { done: !item.done })
        }, item.done ? "✅" : "⬜"),
        h("span", { class: "pin-text" },
          item.text,
          h("span", { class: "pin-by", text: (item.by || "") + " · " + fmtTime(item.ts) })
        ),
        h("button", {
          type: "button", class: "icon-btn", "aria-label": "안건 삭제",
          onclick: () => confirmDelete("안건을 지울까요?", item.text, () => Store.remove("agenda", item.id))
        }, "✕")
      ));
    });

    // 결정사항
    const decisionList = $("#decisionList");
    clear(decisionList);
    const decisions = values(state.decisions).sort(byTime).reverse();
    if (!decisions.length) decisionList.append(h("li", { class: "empty-note", text: "아직 고정된 결정사항이 없어요." }));
    decisions.forEach((item) => {
      decisionList.append(h("li", { class: "pin-item" },
        h("span", { class: "pin-text" },
          item.text,
          h("span", { class: "pin-by", text: (item.by || "") + " · " + fmtTime(item.ts) })
        ),
        h("button", {
          type: "button", class: "icon-btn", "aria-label": "결정사항 삭제",
          onclick: () => confirmDelete("결정사항을 지울까요?", item.text, () => Store.remove("decisions", item.id))
        }, "✕")
      ));
    });
  }

  /* ---------------- 렌더: 작업실 ---------------- */

  function tasksByStatus(status) {
    return values(state.tasks)
      .filter((t) => (t.status || "todo") === status)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  function taskCard(task) {
    const assignee = task.assignee ? state.agents[task.assignee] : null;
    const index = STATUS_COLS.findIndex((c) => c.key === (task.status || "todo"));
    const card = h("article", { class: "task", draggable: "true", dataset: { task: task.id } },
      h("p", { class: "task-title", text: task.title || "(제목 없음)" }),
      task.desc ? h("p", { class: "task-desc", text: task.desc }) : null,
      h("div", { class: "task-foot" },
        h("span", { class: "task-assignee" },
          assignee ? h("span", { class: "avatar", style: { "--c": colorOf(assignee) } }, assignee.initial || initialOf(assignee.name)) : null,
          assignee ? assignee.name : "담당 없음"
        ),
        h("div", { class: "task-actions" },
          h("button", {
            type: "button", class: "btn icon", "aria-label": "왼쪽으로",
            disabled: index <= 0,
            onclick: () => moveTask(task, STATUS_COLS[index - 1].key)
          }, "←"),
          h("button", {
            type: "button", class: "btn icon", "aria-label": "오른쪽으로",
            disabled: index >= STATUS_COLS.length - 1,
            onclick: () => moveTask(task, STATUS_COLS[index + 1].key)
          }, "→"),
          h("button", {
            type: "button", class: "btn icon", "aria-label": "삭제",
            onclick: () => confirmDelete("카드를 지울까요?", task.title, () => Store.remove("tasks", task.id))
          }, "✕")
        )
      ),
      h("div", { class: "task-by", text: (task.createdBy ? task.createdBy + " · " : "") + fmtWhen(task.createdAt) })
    );

    card.addEventListener("dragstart", (event) => {
      card.classList.add("dragging");
      try { event.dataTransfer.setData("text/plain", task.id); } catch (e) { /* ignore */ }
      event.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    return card;
  }

  async function moveTask(task, status) {
    if (!status || status === task.status) return;
    await Store.update("tasks", task.id, { status, movedAt: Date.now() });
  }

  function renderWorkspace() {
    const all = values(state.tasks);
    $("#taskCount").textContent = String(all.length);

    STATUS_COLS.forEach((col) => {
      const holder = $('[data-drop="' + col.key + '"]');
      const items = tasksByStatus(col.key);
      clear(holder);
      if (!items.length) {
        holder.append(h("p", { class: "empty-note", text: "카드가 없어요" }));
      }
      items.forEach((task) => holder.append(taskCard(task)));
      const count = $('[data-col-count="' + col.key + '"]');
      if (count) count.textContent = String(items.length);
    });

    // 공유 메모
    const grid = $("#notesGrid");
    clear(grid);
    const notes = values(state.notes).sort(byTime).reverse();
    if (!notes.length) grid.append(h("p", { class: "empty-note", text: "공유할 메모나 링크를 추가해 보세요." }));
    notes.forEach((note) => {
      const url = note.url && /^https?:\/\//i.test(note.url) ? note.url : "";
      grid.append(h("div", { class: "note" },
        h("button", {
          type: "button", class: "icon-btn", "aria-label": "삭제",
          onclick: () => confirmDelete("메모를 지울까요?", note.title, () => Store.remove("notes", note.id))
        }, "✕"),
        h("div", { class: "note-title", text: note.title || "제목 없음" }),
        url ? h("a", { class: "note-link", href: url, target: "_blank", rel: "noopener noreferrer", text: url.replace(/^https?:\/\//, "").slice(0, 60) }) : null,
        note.memo ? h("div", { class: "note-memo", text: note.memo }) : null,
        h("div", { class: "note-by", text: (note.by || "") + " · " + fmtWhen(note.ts) })
      ));
    });
  }

  /* ---------------- 삭제 확인 ---------------- */

  function confirmDelete(title, detail, action) {
    openModal({
      title,
      okText: "지우기",
      body: [h("p", { class: "small", text: detail || "" })],
      onSubmit: async () => { await action(); toast("지웠어요"); }
    });
  }

  /* ---------------- 전체 렌더 ---------------- */

  function renderAll() {
    renderBadge();
    renderMe();
    renderMap();
    renderMeeting();
    renderWorkspace();
  }

  /* ---------------- 입력 폼 ---------------- */

  $("#chatForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#chatInput");
    const text = input.value.trim();
    if (!text) return;
    if (!requireMe()) return;
    const me = myAgent();
    input.value = "";
    await Store.set("chat", Store.newId("msg"), {
      name: me.name,
      initial: me.initial || initialOf(me.name),
      color: me.color || "purple",
      agentId: me.id,
      text: text.slice(0, 500),
      ts: Date.now()
    });
    state.chatDirty = true;
  });

  $("#agendaForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#agendaInput");
    const text = input.value.trim();
    if (!text) return;
    if (!requireMe()) return;
    input.value = "";
    await Store.set("agenda", Store.newId("agenda"), {
      text: text.slice(0, 120), by: myAgent().name, ts: Date.now(), done: false
    });
  });

  $("#decisionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#decisionInput");
    const text = input.value.trim();
    if (!text) return;
    if (!requireMe()) return;
    input.value = "";
    await Store.set("decisions", Store.newId("decision"), {
      text: text.slice(0, 160), by: myAgent().name, ts: Date.now()
    });
  });

  $("#noteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const titleInput = $("#noteTitle");
    const urlInput = $("#noteUrl");
    const memoInput = $("#noteMemo");
    const title = titleInput.value.trim();
    if (!title) return;
    if (!requireMe()) return;
    let url = urlInput.value.trim();
    if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
    await Store.set("notes", Store.newId("note"), {
      title: title.slice(0, 80), url, memo: memoInput.value.trim().slice(0, 120),
      by: myAgent().name, ts: Date.now()
    });
    titleInput.value = ""; urlInput.value = ""; memoInput.value = "";
    toast("메모를 추가했어요");
  });

  function openTaskModal(status) {
    const titleInput = h("input", { type: "text", maxlength: "80", placeholder: "무엇을 할까요?" });
    const descInput = h("textarea", { rows: "3", maxlength: "300", placeholder: "설명 (선택)" });
    const statusSelect = h("select", {});
    STATUS_COLS.forEach((col) => {
      const opt = h("option", { value: col.key, text: col.name });
      if (col.key === status) opt.selected = true;
      statusSelect.append(opt);
    });
    const assigneeSelect = h("select", {});
    assigneeSelect.append(h("option", { value: "", text: "담당 없음" }));
    values(state.agents).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach((agent) => {
      assigneeSelect.append(h("option", { value: agent.id, text: agent.name }));
    });

    openModal({
      title: "카드 추가",
      okText: "추가",
      body: [
        field("할 일", titleInput),
        field("설명", descInput),
        field("상태", statusSelect),
        field("담당 피클", assigneeSelect)
      ],
      onSubmit: async () => {
        const title = titleInput.value.trim();
        if (!title) { toast("할 일을 입력해 주세요"); titleInput.focus(); return false; }
        if (!requireMe()) return false;
        await Store.set("tasks", Store.newId("task"), {
          title: title.slice(0, 80),
          desc: descInput.value.trim(),
          status: statusSelect.value,
          assignee: assigneeSelect.value,
          createdBy: myAgent().name,
          createdAt: Date.now()
        });
        toast("카드를 추가했어요");
      }
    });
  }

  /* ---------------- 이벤트 연결 ---------------- */

  // 탭
  function setTab(name) {
    state.tab = name;
    $$(".tab").forEach((tab) => {
      const on = tab.dataset.tab === name;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
    });
    $$(".view").forEach((view) => view.classList.toggle("is-active", view.id === "view-" + name));
    if (name === "meeting") {
      const log = $("#chatLog");
      requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
    }
    if (location.hash !== "#" + name) {
      try { history.replaceState(null, "", "#" + name); } catch (e) { /* ignore */ }
    }
  }

  $$(".tab").forEach((tab) => tab.addEventListener("click", () => setTab(tab.dataset.tab)));

  window.addEventListener("hashchange", () => {
    const hash = (location.hash || "").replace("#", "");
    if (["map", "meeting", "workspace"].includes(hash) && hash !== state.tab) setTab(hash);
  });

  // 오피스 맵 클릭 위임
  $(".floor").addEventListener("click", (event) => {
    const agentEl = event.target.closest(".agent");
    if (agentEl) {
      const key = agentEl.dataset.agent;
      const agent = state.agents[key];
      if (agent) openAgentCard(Object.assign({ id: key }, agent));
      return;
    }
    const deskEl = event.target.closest(".desk");
    if (deskEl) {
      const desk = Number(deskEl.dataset.desk);
      moveTo("workspace", desk);
      return;
    }
    const roomEl = event.target.closest(".room");
    if (roomEl) moveTo(roomEl.dataset.zone, null);
  });

  // 내 프로필
  $("#meChip").addEventListener("click", () => {
    if (myAgent()) openProfileModal();
    else {
      const user = currentUser();
      if (user) openSetupModal(user);
      else showGate();
    }
  });

  $("#joinMeeting").addEventListener("click", () => moveTo("meeting", null));

  $$(".add-card").forEach((btn) => btn.addEventListener("click", () => openTaskModal(btn.dataset.add)));

  // 드래그 앤 드롭
  $$(".col").forEach((col) => {
    const status = col.dataset.status;
    col.addEventListener("dragover", (event) => {
      event.preventDefault();
      col.classList.add("drag-over");
      try { event.dataTransfer.dropEffect = "move"; } catch (e) { /* ignore */ }
    });
    col.addEventListener("dragleave", (event) => {
      if (!col.contains(event.relatedTarget)) col.classList.remove("drag-over");
    });
    col.addEventListener("drop", (event) => {
      event.preventDefault();
      col.classList.remove("drag-over");
      const id = event.dataTransfer.getData("text/plain");
      const task = state.tasks[id];
      if (task) moveTask(task, status);
    });
  });

  // 상태 갱신: 저장소 구독
  ["agents", "chat", "tasks", "notes", "agenda", "decisions"].forEach((path) => {
    Store.on(path, (data) => {
      state[path] = data || {};
      if (path === "agents") {
        renderMe();
        renderMap();
        renderMeeting();
        renderWorkspace();
      } else if (path === "chat") {
        renderMeeting();
      } else if (path === "tasks") {
        renderWorkspace();
      } else if (path === "notes") {
        renderWorkspace();
      } else {
        renderMeeting();
      }
    });
  });

  Store.onStatus(renderBadge);

  // 하트비트 (접속 중 표시 유지)
  setInterval(async () => {
    const me = myAgent();
    if (!me) return;
    try { await Store.update("agents", me.id, { updatedAt: Date.now(), client: CLIENT }); }
    catch (e) { /* ignore */ }
  }, 45000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const me = myAgent();
    if (me) Store.update("agents", me.id, { updatedAt: Date.now(), client: CLIENT }).catch(() => {});
  });

  // 모달 취소 시 포커스 복구
  dialog.addEventListener("cancel", () => { state.modalSubmit = null; });

  /* ---------------- 인증 게이트 (로그인 화면) ---------------- */

  const gate = $("#authGate");
  const appRoot = $(".app");
  const authForm = $("#authForm");
  const authEmail = $("#authEmail");
  const authPassword = $("#authPassword");
  const authSubmit = $("#authSubmit");
  const authError = $("#authError");
  const authCode = $("#authCode");

  function setAuthError(message, code) {
    if (message) {
      authError.textContent = message;
      authError.hidden = false;
    } else {
      authError.textContent = "";
      authError.hidden = true;
    }
    if (code) {
      authCode.textContent = code;
      authCode.hidden = false;
    } else {
      authCode.textContent = "";
      authCode.hidden = true;
    }
  }

  function setAuthBusy(busy) {
    authSubmit.disabled = !!busy;
    authSubmit.textContent = busy ? "로그인 중…" : "로그인";
  }

  function showGate(message, code) {
    appRoot.hidden = true;
    gate.hidden = false;
    authSubmit.disabled = !(Store.mode === "firebase" && Store.ready);
    if (message) setAuthError(message, code);
    setTimeout(() => {
      try {
        if (!authEmail.value) authEmail.focus();
        else authPassword.focus();
      } catch (e) { /* ignore */ }
    }, 60);
  }

  function showApp() {
    gate.hidden = true;
    appRoot.hidden = false;
    setAuthError("");
    setAuthBusy(false);
  }

  function authErrorMessage(err) {
    const code = (err && err.code) || "";
    switch (code) {
      case "auth/invalid-email": return "이메일 형식이 올바르지 않아요.";
      case "auth/missing-password": return "비밀번호를 입력해 주세요.";
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found": return "이메일 또는 비밀번호가 맞지 않아요.";
      case "auth/user-disabled": return "사용이 중지된 계정이에요.";
      case "auth/too-many-requests": return "시도가 너무 많아요. 잠시 뒤 다시 시도해 주세요.";
      case "auth/operation-not-allowed": return "이 프로젝트에서 이메일/비밀번호 로그인이 아직 켜져 있지 않아요.";
      case "auth/network-request-failed": return "네트워크에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.";
      case "auth/invalid-api-key":
      case "auth/api-key-not-valid": return "Firebase 설정(apiKey)을 확인해 주세요.";
      default: return "로그인하지 못했어요. 계정 정보를 확인해 주세요.";
    }
  }

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = authEmail.value.trim();
    const password = authPassword.value;
    if (!email || !password) {
      setAuthError("이메일과 비밀번호를 모두 입력해 주세요.");
      return;
    }
    setAuthError("");
    setAuthBusy(true);
    try {
      await Store.signIn(email, password);
      authPassword.value = "";
    } catch (err) {
      console.error("[auth] 로그인 실패", err);
      setAuthError(authErrorMessage(err), (err && err.code) || "");
      setAuthBusy(false);
    }
  });

  $("#logoutBtn").addEventListener("click", async () => {
    try {
      await Store.signOut();
      toast("로그아웃했어요");
    } catch (e) {
      toast("로그아웃하지 못했어요");
    }
  });

  /* ---------------- 시작 ---------------- */

  let authFlowToken = 0;

  async function onAuthChanged(user) {
    const token = ++authFlowToken;
    state.authUser = user || null;
    state.me = user && user.uid ? { id: user.uid } : null;

    const emailEl = $("#accountEmail");
    emailEl.textContent = user ? (user.email || user.uid) : "";
    emailEl.hidden = !user;
    $("#logoutBtn").hidden = !user;

    if (!user) {
      state.agents = {}; state.chat = {}; state.tasks = {};
      state.notes = {}; state.agenda = {}; state.decisions = {};
      state.setupOpen = false;
      if (dialog.open) { try { dialog.close(); } catch (e) { /* ignore */ } }
      renderAll();
      showGate();
      return;
    }

    showApp();
    renderAll();
    await waitForAgents(8000);
    if (token !== authFlowToken) return;
    try {
      await ensureProfile(user);
    } catch (err) {
      console.error("[profile] 내 피클을 준비하지 못했어요", err);
      toast("내 피클을 불러오지 못했어요 (권한 또는 네트워크 확인)");
    }
  }

  Store.onAuth(onAuthChanged);

  async function boot() {
    const hash = (location.hash || "").replace("#", "");
    if (["map", "meeting", "workspace"].includes(hash)) state.tab = hash;

    setTab(state.tab);
    renderAll();
    showGate();   // 확인되기 전에는 잠가 둡니다

    const result = await Store.init();

    if (result.mode !== "firebase") {
      showGate("Firebase 설정(config.js)이 없어 로그인할 수 없어요.", "config-missing");
      return;
    }
    if (result.error) {
      showGate("인증 서버에 연결하지 못했어요. 새로고침해서 다시 시도해 주세요.",
        String(result.error.code || result.error.message || ""));
      return;
    }
    if (!Store.ready) {
      showGate("로그인 상태를 확인하지 못했어요. 새로고침해서 다시 시도해 주세요.");
      return;
    }

    // 인증 상태 콜백이 이미 처리했지만, 혹시 놓친 경우를 한 번 더 반영합니다
    if (!Store.user()) showGate();
    else if (appRoot.hidden) showApp();
    setTab(state.tab);
  }

  boot().catch((err) => {
    console.error(err);
    renderAll();
    showGate("앱을 시작하지 못했어요. 새로고침해서 다시 시도해 주세요.", String((err && err.message) || ""));
  });
})();
