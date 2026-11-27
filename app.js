/* =========================================================
   app.js — 합동 비서실 (메타버스 에디션) 화면 로직
   ---------------------------------------------------------
   · 입장코드 게이트 · 프로필 · 실시간 데이터 구독
   · 게임 HUD · 구역 패널(회의실/작업실/동료) · 캔버스 월드 연동
   ========================================================= */

(function () {
  "use strict";

  const Store = window.OfficeStore;
  const World = window.OfficeWorld;
  const Art = window.OfficeArt;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const COLORS = Art.COLORS;
  const COLOR_KEYS = Art.COLORS_KEYS;
  const GLYPH_FALLBACK = "?";

  const ROOMS = {
    workspace: { name: "작업실", icon: "🛠️" },
    meeting: { name: "회의실", icon: "🗓️" },
    lounge: { name: "라운지", icon: "☕" },
    away: { name: "테라스", icon: "🌙" },
    hallway: { name: "복도", icon: "🚶" }
  };
  const STATUS_COLS = [
    { key: "todo", name: "할 일" },
    { key: "doing", name: "진행 중" },
    { key: "done", name: "완료" }
  ];

  const CLIENT_KEY = "pickle-office-client";
  const ONLINE_MS = (window.OFFICE_SETTINGS && window.OFFICE_SETTINGS.onlineWindowMs) || 180000;

  const state = {
    agents: {}, chat: {}, tasks: {}, notes: {}, agenda: {}, decisions: {},
    authUser: null,
    modalSubmit: null,
    setupOpen: false,
    pendingProfile: false,
    panel: null,
    autoZone: null,
    autoSuppressUntil: 0,
    sound: false,
    firstAgents: true,
    emojiSeen: {},
    chatSeen: null,
    lastZone: "hallway",
    connected: false
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
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2400);
  }

  function colorOf(agent) {
    const key = (agent && agent.color) || "purple";
    return COLORS[key] || (/^#/.test(key) ? key : COLORS.purple);
  }

  function glyphOf(agent) {
    if (!agent) return GLYPH_FALLBACK;
    return Art.glyphFor(agent) || GLYPH_FALLBACK;
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

  /* ---------------- 내 정체성 ---------------- */

  const CLIENT = (function () {
    let id = null;
    try { id = window.localStorage.getItem(CLIENT_KEY); } catch (e) { /* ignore */ }
    if (!id) {
      id = "c_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      try { window.localStorage.setItem(CLIENT_KEY, id); } catch (e) { /* ignore */ }
    }
    return id;
  })();

  function myAgentId() { return Store.agentId ? Store.agentId() : null; }

  function myAgent() {
    const id = myAgentId();
    if (!id) return null;
    const record = state.agents[id];
    if (!record) return null;
    return Object.assign({ id: id }, record);
  }

  function requireMe() {
    if (myAgent()) return true;
    if (!myAgentId()) { showGate(); toast("입장코드로 입장해 주세요"); return false; }
    toast("내 피클 프로필을 먼저 만들어 주세요");
    openSetupModal();
    return false;
  }

  async function touchPresence() {
    const me = myAgent();
    if (!me) return;
    try { await Store.update("agents", me.id, { updatedAt: Date.now(), client: CLIENT }); }
    catch (e) { /* ignore */ }
  }

  async function ensureProfile() {
    const id = myAgentId();
    if (!id) return;
    if (state.agents[id]) { await touchPresence(); return; }
    if (!(Store.has && Store.has("agents"))) return;
    openSetupModal(id);
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
    if (cancel) cancel.hidden = !!options.hideCancel;
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

  dialog.addEventListener("close", function () {
    state.modalSubmit = null;
    state.setupOpen = false;
  });

  /* ---------------- 프로필 ---------------- */

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

  function openSetupModal(agentId) {
    const id = agentId || myAgentId();
    if (!id) return;
    if (state.setupOpen) return;

    const nameInput = h("input", { type: "text", maxlength: "20", placeholder: "예: 찐구리", autocomplete: "off" });
    const initialInput = h("input", { type: "text", maxlength: "2", placeholder: "자동", autocomplete: "off" });
    const roleInput = h("input", { type: "text", maxlength: "30", placeholder: "예: 여행 담당 (선택)" });
    const swatches = swatchPicker("pink");

    state.setupOpen = true;
    openModal({
      title: "🎮 내 피클 만들기",
      okText: "오피스 입장",
      hideCancel: true,
      body: [
        h("p", { class: "hint", text: "입장코드가 확인됐어요. 이 코드로는 처음 들어왔으니, 오피스에 세울 내 캐릭터를 정해 주세요. 다음부터는 같은 코드로 같은 자리에 서요." }),
        field("이름", nameInput),
        field("이니셜 (선택)", initialInput, "얼굴에 새길 글자예요. 비워 두면 이름 첫 글자."),
        field("역할 (선택)", roleInput),
        field("캐릭터 색", swatches.el),
        h("div", { class: "small muted mono" }, "내 피클 ID: ", id)
      ],
      onSubmit: async () => {
        const name = nameInput.value.trim();
        if (!name) { toast("이름을 입력해 주세요"); nameInput.focus(); return false; }
        const spawn = Art.spawnFor("workspace");
        await Store.set("agents", id, {
          name: name,
          initial: initialInput.value.trim() || name.trim().charAt(0),
          color: swatches.picked(),
          role: roleInput.value.trim(),
          location: "workspace",
          desk: null,
          status: "오피스 접속 중",
          x: spawn.x,
          y: spawn.y,
          updatedAt: Date.now(),
          client: CLIENT
        });
        state.setupOpen = false;
        renderAll();
        World.setMe(id);
        toast("🎉 " + name + " 피클로 입장했어요");
      }
    });
  }

  function openProfileModal() {
    const me = myAgent();
    if (!me) {
      if (myAgentId()) openSetupModal();
      else showGate();
      return;
    }

    const nameInput = h("input", { type: "text", maxlength: "20", value: me.name || "" });
    const initialInput = h("input", { type: "text", maxlength: "2", value: me.initial || "" });
    const roleInput = h("input", { type: "text", maxlength: "30", value: me.role || "", placeholder: "예: 자료 조사 담당" });
    const statusInput = h("input", { type: "text", maxlength: "60", value: me.status || "", placeholder: "예: 원료 발주 확인 중" });
    const swatches = swatchPicker(me.color || "purple");

    openModal({
      title: "🪪 내 프로필",
      okText: "저장",
      body: [
        field("이름", nameInput),
        field("이니셜", initialInput, "얼굴에 새길 글자"),
        field("역할", roleInput),
        field("상태 메시지", statusInput, "맵 위 캐릭터 옆에 표시돼요"),
        field("캐릭터 색", swatches.el),
        h("div", { class: "small muted" }, "현재 위치: ", ROOMS[me.location] ? ROOMS[me.location].name : "복도"),
        h("div", { class: "small muted mono" }, "내 피클 ID: ", me.id)
      ],
      onSubmit: async () => {
        const name = nameInput.value.trim();
        if (!name) { toast("이름을 입력해 주세요"); return false; }
        await Store.update("agents", me.id, {
          name: name,
          initial: initialInput.value.trim() || name.trim().charAt(0),
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

  function moveTo(zone) {
    if (!requireMe()) return;
    if (!ROOMS[zone] || zone === "hallway") return;
    World.teleport(zone);
    state.autoZone = zone;
  }

  /* ---------------- 렌더: HUD ---------------- */

  function renderBadge() {
    const badge = $("#dbBadge");
    if (!badge) return;
    const status = Store.status;
    const signedIn = !!myAgentId();
    badge.classList.remove("live", "warn");
    if (Store.mode !== "firebase") {
      badge.textContent = "데모 모드";
      badge.classList.add("warn");
    } else if (status === "error") {
      badge.textContent = "서버 오류";
      badge.classList.add("warn");
    } else if (!signedIn) {
      badge.textContent = "입장 전";
      badge.classList.add("warn");
    } else if (status === "live") {
      badge.textContent = "● 실시간";
      badge.classList.add("live");
    } else if (status === "denied") {
      badge.textContent = "⛔ 권한 없음";
      badge.classList.add("warn");
    } else if (status === "offline") {
      badge.textContent = "○ 재연결 중";
      badge.classList.add("warn");
    } else {
      badge.textContent = "○ 연결 중";
      badge.classList.add("warn");
    }
  }

  function renderHud() {
    const me = myAgent();
    const avatar = $("#meAvatar");
    const name = $("#meName");
    const role = $("#meRole");

    if (me) {
      avatar.textContent = glyphOf(me);
      avatar.style.background = colorOf(me);
      name.textContent = me.name;
      role.textContent = me.role || (me.status || "오피스 접속 중");
    } else if (myAgentId()) {
      avatar.textContent = "＋";
      avatar.style.background = COLORS.purple;
      name.textContent = "프로필 설정";
      role.textContent = "캐릭터를 만들어요";
    } else {
      avatar.textContent = "?";
      avatar.style.background = COLORS.purple;
      name.textContent = "내 피클";
      role.textContent = "입장 전";
    }

    const list = values(state.agents);
    const online = list.filter(isOnline).length;
    $("#onlineChip").textContent = "🟢 " + online + " / " + list.length;

    $("#zoneChip").textContent = "📍 " + (World && World.zoneName ? World.zoneName() : "복도");

    const tag = $("#accountTag");
    if (tag) {
      tag.textContent = myAgentId() || "";
      tag.hidden = !myAgentId();
    }
    const logout = $("#logoutBtn");
    if (logout) logout.hidden = !myAgentId();

    const led = $("#meLed");
    if (led) led.className = "led" + (me ? " on" : "");
  }

  /* ---------------- 렌더: 회의실 ---------------- */

  function sortedAgents(list) {
    return list.slice().sort((a, b) => {
      const mineA = myAgentId() && a.id === myAgentId() ? 0 : 1;
      const mineB = myAgentId() && b.id === myAgentId() ? 0 : 1;
      if (mineA !== mineB) return mineA - mineB;
      const onlineA = isOnline(a) ? 0 : 1;
      const onlineB = isOnline(b) ? 0 : 1;
      if (onlineA !== onlineB) return onlineA - onlineB;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }

  function agentRow(agent) {
    const mine = myAgentId() && agent.id === myAgentId();
    return h("button", {
      type: "button", class: "crew-row" + (mine ? " is-me" : ""),
      onclick: () => openAgentCard(agent)
    },
      h("span", { class: "avatar", style: { "--c": colorOf(agent) } },
        glyphOf(agent),
        h("i", { class: "dot-live" + (isOnline(agent) ? "" : " off") })
      ),
      h("span", { class: "crew-meta" },
        h("strong", { text: (agent.name || "이름 없음") + (mine ? " (나)" : "") }),
        h("small", { text: (agent.role || agent.status || "상태 메시지 없음") })
      ),
      h("span", { class: "crew-zone", text: ROOMS[agent.location] ? ROOMS[agent.location].icon : "🚶" })
    );
  }

  function renderParticipants() {
    const agents = values(state.agents);
    const inRoom = sortedAgents(agents.filter((a) => a.location === "meeting"));

    const countEl = $("#meetingCount");
    if (countEl) countEl.textContent = String(inRoom.length);

    const list = $("#participants");
    if (!list) return;
    clear(list);
    if (!inRoom.length) {
      list.append(h("p", { class: "empty-note", text: "아직 회의실에 아무도 없어요. 구역 버튼으로 들어와 보세요." }));
    } else {
      inRoom.forEach((agent) => list.append(agentRow(agent)));
    }
  }

  function renderMeeting() {
    renderParticipants();

    const log = $("#chatLog");
    if (!log) return;
    const messages = values(state.chat).sort(byTime).slice(-300);
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 140;
    const prevCount = Number(log.dataset.count || 0);
    clear(log);
    if (!messages.length) {
      log.append(h("p", { class: "empty-note", text: "첫 메시지를 남겨 보세요. 맵 위 캐릭터 머리에도 말풍선이 떠요." }));
    }
    messages.forEach((m) => {
      const mine = m.agentId ? (myAgentId() && m.agentId === myAgentId()) : false;
      log.append(h("div", { class: "msg" + (mine ? " mine" : "") },
        h("span", { class: "avatar sm", style: { "--c": COLORS[m.color] || m.color || COLORS.purple } }, m.initial ? (m.initial.charCodeAt(0) >= 0xAC00 ? Art.glyphFor({ initial: m.initial }) : m.initial) : "?"),
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
    const meta = $("#chatMeta");
    if (meta) meta.textContent = messages.length ? messages.length + "개 메시지" : "";

    const agendaList = $("#agendaList");
    if (agendaList) {
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
            type: "button", class: "icon-btn tiny", "aria-label": "안건 삭제",
            onclick: () => confirmDelete("안건을 지울까요?", item.text, () => Store.remove("agenda", item.id))
          }, "✕")
        ));
      });
    }

    const decisionList = $("#decisionList");
    if (decisionList) {
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
            type: "button", class: "icon-btn tiny", "aria-label": "결정사항 삭제",
            onclick: () => confirmDelete("결정사항을 지울까요?", item.text, () => Store.remove("decisions", item.id))
          }, "✕")
        ));
      });
    }
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
    const card = h("article", { class: "task" + (task.status === "done" ? " is-done" : ""), draggable: "true", dataset: { task: task.id } },
      h("p", { class: "task-title", text: task.title || "(제목 없음)" }),
      task.desc ? h("p", { class: "task-desc", text: task.desc }) : null,
      h("div", { class: "task-foot" },
        h("span", { class: "task-assignee" },
          assignee ? h("span", { class: "avatar xs", style: { "--c": colorOf(assignee) } }, glyphOf(assignee)) : null,
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
            onclick: () => confirmDelete("퀘스트를 지울까요?", task.title, () => Store.remove("tasks", task.id))
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
    const taskCount = $("#taskCount");
    if (taskCount) taskCount.textContent = String(all.length);

    const counts = { todo: 0, doing: 0, done: 0 };
    STATUS_COLS.forEach((col) => {
      const holder = $('[data-drop="' + col.key + '"]');
      const items = tasksByStatus(col.key);
      counts[col.key] = items.length;
      if (!holder) return;
      clear(holder);
      if (!items.length) {
        holder.append(h("p", { class: "empty-note", text: "비어 있어요" }));
      }
      items.forEach((task) => holder.append(taskCard(task)));
      const count = $('[data-col-count="' + col.key + '"]');
      if (count) count.textContent = String(items.length);
    });

    const qTodo = $("#qTodo");
    const qDoing = $("#qDoing");
    const qDone = $("#qDone");
    if (qTodo) qTodo.textContent = String(counts.todo);
    if (qDoing) qDoing.textContent = String(counts.doing);
    if (qDone) qDone.textContent = String(counts.done);

    const grid = $("#notesGrid");
    if (!grid) return;
    clear(grid);
    const notes = values(state.notes).sort(byTime).reverse();
    if (!notes.length) grid.append(h("p", { class: "empty-note", text: "공유할 메모나 링크를 추가해 보세요." }));
    notes.forEach((note) => {
      const url = note.url && /^https?:\/\//i.test(note.url) ? note.url : "";
      grid.append(h("div", { class: "note" },
        h("button", {
          type: "button", class: "icon-btn tiny", "aria-label": "삭제",
          onclick: () => confirmDelete("메모를 지울까요?", note.title, () => Store.remove("notes", note.id))
        }, "✕"),
        h("div", { class: "note-title", text: note.title || "제목 없음" }),
        url ? h("a", { class: "note-link", href: url, target: "_blank", rel: "noopener noreferrer", text: url.replace(/^https?:\/\//, "").slice(0, 60) }) : null,
        note.memo ? h("div", { class: "note-memo", text: note.memo }) : null,
        h("div", { class: "note-by", text: (note.by || "") + " · " + fmtWhen(note.ts) })
      ));
    });
  }

  /* ---------------- 렌더: 동료 ---------------- */

  function renderCrew() {
    const holder = $("#crewList");
    if (!holder) return;
    clear(holder);
    const list = sortedAgents(values(state.agents));
    if (!list.length) {
      holder.append(h("p", { class: "empty-note", text: "아직 오피스에 아무도 없어요." }));
      return;
    }
    list.forEach((agent) => {
      const mine = myAgentId() && agent.id === myAgentId();
      const row = h("div", { class: "crew-item" + (mine ? " is-me" : "") },
        agentRow(agent),
        h("button", {
          type: "button", class: "btn tiny go",
          disabled: mine || !agent.location || !ROOMS[agent.location],
          onclick: () => { moveTo(agent.location); closePanel(); }
        }, "➜")
      );
      holder.append(row);
    });
  }

  /* ---------------- 전체 렌더 ---------------- */

  function renderAll() {
    renderBadge();
    renderHud();
    renderMeeting();
    renderWorkspace();
    renderCrew();
  }

  function openAgentCard(agent) {
    const mine = myAgentId() && agent.id === myAgentId();
    const where = ROOMS[agent.location] ? ROOMS[agent.location].name : "복도";
    openModal({
      title: agent.name || "피클",
      okText: mine ? "프로필 수정" : "닫기",
      hideCancel: !mine,
      body: [
        h("div", { class: "agent-card" },
          h("span", { class: "avatar xl", style: { "--c": colorOf(agent) } }, glyphOf(agent)),
          h("div", { class: "agent-card-meta" },
            h("strong", { text: agent.name || "" }),
            h("small", { text: agent.role || "역할 없음" }),
            h("span", { class: "badge-line" + (isOnline(agent) ? " on" : "") },
              isOnline(agent) ? "● 접속 중" : "○ 자리 비움",
              " · ", where
            )
          )
        ),
        h("p", { class: "small" }, "상태: ", agent.status || "상태 메시지 없음"),
        h("p", { class: "small muted" }, "최근 활동: ", fmtWhen(agent.updatedAt))
      ],
      onSubmit: () => {
        if (!mine) return true;
        openProfileModal();
        return false;
      }
    });
  }

  function confirmDelete(title, detail, action) {
    openModal({
      title: title,
      okText: "지우기",
      body: [h("p", { class: "small", text: detail || "" })],
      onSubmit: async () => { await action(); toast("지웠어요"); }
    });
  }

  /* ---------------- 입력: 채팅 ---------------- */

  async function submitChat(text) {
    const value = String(text || "").trim();
    if (!value) return;
    if (!requireMe()) return;
    const me = myAgent();
    await Store.set("chat", Store.newId("msg"), {
      name: me.name,
      initial: me.initial || me.name.charAt(0),
      color: me.color || "purple",
      agentId: me.id,
      text: value.slice(0, 500),
      ts: Date.now()
    });
    World.bubble(me.id, value.length > 40 ? value.slice(0, 40) + "…" : value, "chat");
  }

  $("#chatForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#chatInput");
    const text = input.value;
    if (!text.trim()) return;
    input.value = "";
    await submitChat(text);
  });

  $("#quickChat").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#quickInput");
    const text = input.value;
    if (!text.trim()) return;
    input.value = "";
    await submitChat(text);
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
      title: "📜 퀘스트 추가",
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
        toast("퀘스트를 추가했어요");
      }
    });
  }

  /* ---------------- 패널 ---------------- */

  const PANELS = {
    meeting: "#panelMeeting",
    workspace: "#panelWorkspace",
    crew: "#panelCrew"
  };

  function openPanel(name) {
    if (!PANELS[name]) return;
    Object.keys(PANELS).forEach((key) => {
      const el = $(PANELS[key]);
      if (el) el.hidden = key !== name;
    });
    state.panel = name;
    if (name === "meeting") {
      const log = $("#chatLog");
      if (log) requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
    }
    const panel = $(PANELS[name]);
    if (panel) panel.classList.add("pop");
  }

  function closePanel() {
    Object.keys(PANELS).forEach((key) => {
      const el = $(PANELS[key]);
      if (el) el.hidden = true;
    });
    state.panel = null;
  }

  function togglePanel(name) {
    if (state.panel === name) closePanel();
    else openPanel(name);
  }

  $$("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closePanel());
  });

  $$("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", () => moveTo(btn.dataset.goto));
  });

  $$(".zone-btn").forEach((btn) => {
    btn.addEventListener("click", () => moveTo(btn.dataset.zone));
  });

  // 퀘스트 추가 버튼
  $$(".add-card").forEach((btn) => {
    btn.addEventListener("click", () => openTaskModal(btn.dataset.add));
  });

  // 칸반 드래그 앤 드롭
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

  $("#questMini").addEventListener("click", () => togglePanel("workspace"));
  $("#crewBtn").addEventListener("click", () => togglePanel("crew"));

  $("#soundBtn").addEventListener("click", () => {
    state.sound = !state.sound;
    World.setSound(state.sound);
    const btn = $("#soundBtn");
    btn.textContent = state.sound ? "🔊" : "🔈";
    btn.setAttribute("aria-pressed", state.sound ? "true" : "false");
    toast(state.sound ? "사운드 켜짐" : "사운드 꺼짐");
  });

  $("#helpBtn").addEventListener("click", () => {
    openModal({
      title: "🕹️ 조작법",
      okText: "알겠어요",
      hideCancel: true,
      body: [
        h("ul", { class: "help-list" },
          h("li", { text: "WASD / 방향키, 또는 맵을 클릭해서 캐릭터를 걸어 다녀요." }),
          h("li", { text: "회의실·작업실·라운지에 들어가면 해당 패널이 열려요. 상단 구역 버튼으로 바로 이동할 수 있어요." }),
          h("li", { text: "아래 이모티콘 버튼을 누르면 머리 위에 감정이 떠요. 채팅도 말풍선으로 보여요." }),
          h("li", { text: "작업실 패널에서 퀘스트(할 일)를 추가하고 상태를 바꿀 수 있어요." })
        ),
        h("p", { class: "small muted", text: "모바일에서는 왼쪽 아래 방향 패드로 움직여요." })
      ]
    });
  });

  /* ---------------- 이모티콘 & 방향 패드 ---------------- */

  async function sendEmoji(emoji) {
    if (!requireMe()) return;
    const me = myAgent();
    const ts = Date.now();
    World.bubble(me.id, emoji, "emoji");
    state.emojiSeen[me.id] = ts;
    try {
      await Store.update("agents", me.id, { emoji: emoji, emojiTs: ts, updatedAt: ts, client: CLIENT });
    } catch (e) {
      console.error("[emoji]", e);
      toast("이모티콘을 보내지 못했어요");
    }
  }

  $$(".emoji-btn").forEach((btn) => {
    btn.addEventListener("click", () => sendEmoji(btn.dataset.emoji));
  });

  $$(".dpad-btn").forEach((btn) => {
    const dir = btn.dataset.dir;
    const down = (e) => { e.preventDefault(); btn.classList.add("is-down"); World.hold(dir, true); };
    const up = () => { btn.classList.remove("is-down"); World.hold(dir, false); };
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointerleave", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  });

  // 키보드: C 동료 패널, Escape 패널 닫기
  window.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (e.key === "Escape") { closePanel(); return; }
    if ((e.key === "c" || e.key === "C") && !dialog.open) togglePanel("crew");
  });

  $("#meChip").addEventListener("click", () => {
    if (myAgent()) openProfileModal();
    else if (myAgentId()) openSetupModal();
    else showGate();
  });

  /* ---------------- 월드 콜백 ---------------- */

  const worldCallbacks = {
    onSync: function (pos) {
      const me = myAgent();
      if (!me) return;
      const patch = {
        x: pos.x,
        y: pos.y,
        updatedAt: Date.now(),
        client: CLIENT
      };
      if (ROOMS[pos.zone] && pos.zone !== "hallway") patch.location = pos.zone;
      Store.update("agents", me.id, patch).catch((err) => {
        console.error("[sync]", err);
      });
    },
    onZone: function (zone, name) {
      state.lastZone = zone;
      const chip = $("#zoneChip");
      if (chip) chip.textContent = "📍 " + name;
      showZoneToast(zone, name);
      scheduleAutoPanel(zone);
    },
    onPickAgent: function (id) {
      if (id === myAgentId()) { openProfileModal(); return; }
      const agent = state.agents[id];
      if (agent) openAgentCard(Object.assign({ id: id }, agent));
    }
  };

  let zoneToastTimer = 0;
  let autoPanelTimer = 0;

  function showZoneToast(zone, name) {
    const el = $("#zoneToast");
    if (!el) return;
    el.hidden = false;
    el.textContent = (ROOMS[zone] ? ROOMS[zone].icon : "🚶") + " " + name + (zone === "hallway" ? "" : " 도착");
    el.classList.add("show");
    clearTimeout(zoneToastTimer);
    zoneToastTimer = setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => { el.hidden = true; }, 260);
    }, 1500);
  }

  function scheduleAutoPanel(zone) {
    clearTimeout(autoPanelTimer);
    if (Date.now() < state.autoSuppressUntil) return;
    if (zone === "hallway" || zone === "away") return;
    const target = zone === "lounge" ? "crew" : zone;
    if (!PANELS[target]) return;
    if (state.panel === target) return;
    autoPanelTimer = setTimeout(() => {
      if (state.lastZone !== zone) return;
      openPanel(target);
    }, 420);
  }

  /* ---------------- 입장 게이트 ---------------- */

  const gate = $("#authGate");
  const appRoot = $("#appRoot");
  const authForm = $("#authForm");
  const codeInput = $("#accessCode");
  const authSubmit = $("#authSubmit");
  const authError = $("#authError");
  const authCodeNote = $("#authCode");

  let titleRaf = 0;
  let titleRunning = false;

  function startTitleScene() {
    if (titleRunning) return;
    const cv = $("#titleCanvas");
    if (!cv) return;
    const g = cv.getContext("2d");
    titleRunning = true;

    function fit() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = cv.getBoundingClientRect();
      cv.width = Math.max(1, Math.round((rect.width || window.innerWidth) * dpr));
      cv.height = Math.max(1, Math.round((rect.height || window.innerHeight) * dpr));
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      cv._w = rect.width || window.innerWidth;
      cv._h = rect.height || window.innerHeight;
    }
    fit();
    window.addEventListener("resize", fit);

    let last = 0;
    function loop(t) {
      if (!titleRunning) return;
      titleRaf = requestAnimationFrame(loop);
      const now = t || 0;
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      g.setTransform(1, 0, 0, 1, 0, 0);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      Art.drawTitleScene(g, cv._w, cv._h, now / 1000 + dt * 0);
    }
    titleRaf = requestAnimationFrame(loop);
  }

  function stopTitleScene() {
    titleRunning = false;
    if (titleRaf) cancelAnimationFrame(titleRaf);
    titleRaf = 0;
  }

  function setAuthError(message, code) {
    if (message) {
      authError.textContent = message;
      authError.hidden = false;
    } else {
      authError.textContent = "";
      authError.hidden = true;
    }
    if (code) {
      authCodeNote.textContent = code;
      authCodeNote.hidden = false;
    } else {
      authCodeNote.textContent = "";
      authCodeNote.hidden = true;
    }
  }

  function setAuthBusy(busy) {
    authSubmit.disabled = !!busy;
    authSubmit.textContent = busy ? "확인 중…" : "ENTER OFFICE";
  }

  function showGate(message, code) {
    appRoot.hidden = true;
    gate.hidden = false;
    authSubmit.disabled = !(Store.mode === "firebase" || Store.mode === "local") || !Store.ready;
    authSubmit.textContent = "ENTER OFFICE";
    if (message) setAuthError(message, code);
    startTitleScene();
    setTimeout(() => { try { codeInput.focus(); } catch (e) { /* ignore */ } }, 80);
  }

  function resetState() {
    state.agents = {}; state.chat = {}; state.tasks = {};
    state.notes = {}; state.agenda = {}; state.decisions = {};
    state.setupOpen = false;
    state.pendingProfile = false;
    state.firstAgents = true;
    state.chatSeen = null;
    state.emojiSeen = {};
    state.workspacePainted = false;
    state.panel = null;
    if (dialog.open) { try { dialog.close(); } catch (e) { /* ignore */ } }
  }

  let worldReady = false;

  function enterApp() {
    if (!myAgentId()) { showGate(); return; }
    gate.hidden = true;
    appRoot.hidden = false;
    setAuthError("");
    setAuthBusy(false);
    codeInput.value = "";
    stopTitleScene();
    state.autoSuppressUntil = Date.now() + 2600;

    if (!worldReady) {
      World.init({
        canvas: $("#worldCanvas"),
        onSync: worldCallbacks.onSync,
        onZone: worldCallbacks.onZone,
        onPickAgent: worldCallbacks.onPickAgent
      });
      worldReady = true;
    }
    World.resize();
    World.setMe(myAgentId());
    World.setAgents(state.agents);
    World.setSound(state.sound);
    World.start();

    renderAll();
    if (Store.has && Store.has("agents")) {
      state.pendingProfile = false;
      ensureProfile().catch((err) => {
        console.error("[profile] 내 피클을 준비하지 못했어요", err);
        toast("내 피클을 불러오지 못했어요 (권한 또는 네트워크 확인)");
      });
    } else {
      state.pendingProfile = true;
    }
    setTimeout(() => {
      const spawn = World.zoneName ? World.zoneName() : "오피스";
      showZoneToast(World.zone ? World.zone() : "workspace", spawn);
    }, 260);
  }

  function accessCodeMessage(err) {
    const code = (err && err.code) || "";
    switch (code) {
      case "office/invalid-code": return "유효하지 않은 입장코드예요. 실장에게 받은 코드를 확인해 주세요.";
      case "office/empty-code": return "입장코드를 입력해 주세요.";
      case "office/no-auth": return "인증을 시작하지 못했어요. 새로고침해서 다시 시도해 주세요.";
      case "auth/operation-not-allowed":
      case "auth/admin-restricted-operation": return "지금은 익명 로그인이 꺼져 있어 입장할 수 없어요. 실장에게 알려 주세요.";
      case "auth/too-many-requests": return "시도가 너무 많아요. 잠시 뒤 다시 시도해 주세요.";
      case "auth/network-request-failed": return "네트워크에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.";
      case "auth/invalid-api-key":
      case "auth/api-key-not-valid": return "Firebase 설정(apiKey)을 확인해 주세요.";
      case "PERMISSION_DENIED": return "서버가 입장을 거부했어요. 잠시 뒤 다시 시도해 주세요.";
      default: return "입장하지 못했어요. 입장코드를 확인하고 다시 시도해 주세요.";
    }
  }

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = codeInput.value.trim();
    if (!code) { setAuthError("입장코드를 입력해 주세요."); codeInput.focus(); return; }
    setAuthError("");
    setAuthBusy(true);
    try {
      await Store.signInWithAccessCode(code);
      enterApp();
    } catch (err) {
      console.error("[auth] 입장 실패", err);
      setAuthError(accessCodeMessage(err), (err && err.code) || "");
      setAuthBusy(false);
      try { codeInput.select(); } catch (e) { /* ignore */ }
    }
  });

  codeInput.addEventListener("input", () => { setAuthError(""); });

  $("#logoutBtn").addEventListener("click", async () => {
    try {
      await Store.signOut();
      World.pause();
      World.setMe(null);
      resetState();
      renderAll();
      closePanel();
      showGate("입장코드를 다시 입력해 주세요.");
      toast("로그아웃했어요");
    } catch (e) {
      toast("로그아웃하지 못했어요");
    }
  });

  /* ---------------- 데이터 구독 ---------------- */

  ["agents", "chat", "tasks", "notes", "agenda", "decisions"].forEach((path) => {
    Store.on(path, (data) => {
      state[path] = data || {};
      if (path === "agents") {
        handleIncomingEmoji();
        renderHud();
        renderParticipants();
        renderCrew();
        if (!state.workspacePainted) {
          state.workspacePainted = true;
          renderWorkspace();
        }
        if (worldReady) World.setAgents(state.agents);
        if (state.pendingProfile && Store.has && Store.has("agents")) {
          state.pendingProfile = false;
          ensureProfile().catch((err) => console.error("[profile]", err));
        }
      } else if (path === "chat") {
        handleIncomingChat();
        renderMeeting();
      } else if (path === "tasks" || path === "notes") {
        renderWorkspace();
      } else {
        renderMeeting();
      }
    });
  });

  function handleIncomingChat() {
    const messages = values(state.chat).sort(byTime);
    if (state.chatSeen === null) {
      state.chatSeen = messages.length ? (messages[messages.length - 1].ts || 0) : 0;
      return;
    }
    messages.forEach((m) => {
      const ts = m.ts || 0;
      if (ts <= state.chatSeen) return;
      state.chatSeen = ts;
      const mine = myAgentId() && m.agentId === myAgentId();
      if (mine) return;
      const fresh = Date.now() - ts < 15000;
      if (!fresh) return;
      if (m.agentId && state.agents[m.agentId]) {
        World.bubble(m.agentId, m.text || "", "chat");
      }
    });
  }

  function handleIncomingEmoji() {
    const list = values(state.agents);
    if (state.firstAgents) {
      list.forEach((a) => {
        if (a.emojiTs) state.emojiSeen[a.id] = a.emojiTs;
      });
      state.firstAgents = false;
      return;
    }
    list.forEach((a) => {
      const ts = a.emojiTs || 0;
      if (!a.emoji || !ts) return;
      if (ts <= (state.emojiSeen[a.id] || 0)) return;
      state.emojiSeen[a.id] = ts;
      if (a.id === myAgentId()) return;
      if (Date.now() - ts > 15000) return;
      World.bubble(a.id, a.emoji, "emoji");
    });
  }

  Store.onStatus(renderBadge);

  Store.onAuth(function (user) {
    state.authUser = user || null;
    renderHud();
    if (!user) {
      resetState();
      renderAll();
      showGate();
    }
  });

  Store.onStatus(function (next) {
    if (next === "denied" && myAgentId()) {
      World.pause();
      resetState();
      renderAll();
      showGate("입장코드가 더 이상 유효하지 않거나 권한이 없어요. 코드를 다시 확인해 주세요.");
    }
  });

  /* ---------------- 하트비트 ---------------- */

  setInterval(function () {
    const me = myAgent();
    if (!me) return;
    const pos = World.position ? World.position() : null;
    const patch = { updatedAt: Date.now(), client: CLIENT };
    if (pos) { patch.x = pos.x; patch.y = pos.y; }
    Store.update("agents", me.id, patch).catch(() => {});
  }, 45000);

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    if (worldReady) World.resize();
    const me = myAgent();
    if (me) Store.update("agents", me.id, { updatedAt: Date.now(), client: CLIENT }).catch(() => {});
  });

  window.addEventListener("resize", function () {
    if (worldReady) World.resize();
  });

  /* ---------------- 시작 ---------------- */

  async function boot() {
    startTitleScene();
    showGate();
    renderAll();
    setAuthBusy(true);

    const result = await Store.init();

    if (result.mode === "local") {
      showGate("로컬 데모 모드예요(Firebase 설정 없음). 아무 코드나 넣어 화면을 확인할 수 있어요.");
      setAuthBusy(false);
      return;
    }
    if (result.error) {
      showGate("인증 서버에 연결하지 못했어요. 새로고침해서 다시 시도해 주세요.",
        String(result.error.code || result.error.message || ""));
      setAuthBusy(false);
      return;
    }
    if (!Store.ready) {
      showGate("입장 상태를 확인하지 못했어요. 새로고침해서 다시 시도해 주세요.");
      setAuthBusy(false);
      return;
    }

    setAuthBusy(false);
    if (myAgentId()) enterApp();
    else showGate();
  }

  boot().catch((err) => {
    console.error(err);
    renderAll();
    showGate("앱을 시작하지 못했어요. 새로고침해서 다시 시도해 주세요.", String((err && err.message) || ""));
  });
})();
