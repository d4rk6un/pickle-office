/* =========================================================
   db.js — 데이터 계층
   ---------------------------------------------------------
   · FIREBASE_CONFIG.databaseURL 이 채워져 있으면
     Firebase Realtime Database(/office/**)와 onValue 로 실시간 동기화
   · 아직 placeholder 이면 localStorage 기반 로컬 데모 모드
     (같은 브라우저의 다른 탭끼리도 storage 이벤트로 동기화)
   ========================================================= */

(function () {
  "use strict";

  const ROOT = (window.OFFICE_SETTINGS && window.OFFICE_SETTINGS.root) || "office";
  const LOCAL_KEY = "pickle-office-db-v1";
  const PATHS = ["agents", "chat", "tasks", "notes", "agenda", "decisions"];
  const FB_VERSION = "11.0.2";

  const subs = new Map();      // path -> Set(callback)
  const cache = new Map();     // path -> object
  const statusSubs = new Set();
  let status = "local";        // local | connecting | live | offline
  let mode = "local";          // local | firebase
  let fb = null;
  let localSeedInProgress = false;

  /* ---------------- 공통 유틸 ---------------- */

  function clean(value) {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") {
      const out = {};
      Object.keys(value).forEach((k) => {
        const v = value[k];
        if (v === undefined) return;
        out[k] = clean(v);
      });
      return out;
    }
    return value;
  }

  function newId(prefix) {
    const rand =
      (window.crypto && window.crypto.randomUUID && window.crypto.randomUUID()) ||
      Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    return (prefix || "id") + "_" + String(rand).replace(/-/g, "").slice(0, 14);
  }

  function setStatus(next) {
    status = next;
    statusSubs.forEach((cb) => {
      try { cb(next); } catch (e) { /* ignore */ }
    });
  }

  function emit(path, value) {
    cache.set(path, value || {});
    const set = subs.get(path);
    if (!set) return;
    set.forEach((cb) => {
      try { cb(value || {}); } catch (e) { console.error(e); }
    });
  }

  function on(path, cb) {
    if (!subs.has(path)) subs.set(path, new Set());
    subs.get(path).add(cb);
    if (cache.has(path)) {
      try { cb(cache.get(path) || {}); } catch (e) { console.error(e); }
    }
    return function off() {
      const set = subs.get(path);
      if (set) set.delete(cb);
    };
  }

  function onStatus(cb) {
    statusSubs.add(cb);
    try { cb(status); } catch (e) { /* ignore */ }
    return function off() { statusSubs.delete(cb); };
  }

  /* ---------------- 로컬(데모) 저장소 ---------------- */

  const local = {
    read() {
      try {
        const raw = window.localStorage.getItem(LOCAL_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch (e) {
        return {};
      }
    },
    write(data) {
      try {
        window.localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
      } catch (e) {
        console.warn("localStorage 저장 실패", e);
      }
    },
    value(path) {
      const data = this.read();
      return data[path] || {};
    },
    mutate(path, id, fn) {
      const data = this.read();
      if (!data[path] || typeof data[path] !== "object") data[path] = {};
      fn(data[path], id);
      this.write(data);
      emit(path, data[path]);
    }
  };

  /* ---------------- Firebase ---------------- */

  async function initFirebase(cfg) {
    const appMod = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app.js`);
    const dbMod = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-database.js`);
    const app = appMod.initializeApp(cfg);
    const database = dbMod.getDatabase(app);
    fb = {
      db: database,
      ref: dbMod.ref,
      onValue: dbMod.onValue,
      set: dbMod.set,
      update: dbMod.update,
      remove: dbMod.remove,
      goOffline: dbMod.goOffline,
      goOnline: dbMod.goOnline
    };

    // 연결 상태 배지
    try {
      const infoRef = dbMod.ref(database, ".info/connected");
      dbMod.onValue(infoRef, (snap) => setStatus(snap.val() === true ? "live" : "offline"));
    } catch (e) { /* ignore */ }

    PATHS.forEach((path) => {
      const r = dbMod.ref(database, `${ROOT}/${path}`);
      dbMod.onValue(
        r,
        (snap) => emit(path, snap.val() || {}),
        (err) => {
          console.warn(`[firebase] ${path} 구독 실패`, err && err.message);
          setStatus("offline");
        }
      );
    });
  }

  /* ---------------- 공개 API ---------------- */

  function isConfigured(cfg) {
    if (!cfg) return false;
    const url = String(cfg.databaseURL || "");
    const key = String(cfg.apiKey || "");
    return /^https?:\/\//.test(url) && !/PASTE|YOUR_|xxxx/i.test(url) &&
      !!key && !/PASTE|YOUR_/i.test(key);
  }

  async function init() {
    const cfg = window.FIREBASE_CONFIG || {};
    if (isConfigured(cfg)) {
      mode = "firebase";
      setStatus("connecting");
      try {
        await initFirebase(cfg);
        return { mode, status };
      } catch (err) {
        console.warn("[firebase] 초기화 실패 → 로컬 데모 모드로 전환", err);
        mode = "local";
        fb = null;
        setStatus("local");
      }
    }
    // 로컬 데모 모드: 초기 스냅샷 전달 + 다른 탭 동기화
    mode = "local";
    PATHS.forEach((path) => emit(path, local.value(path)));
    window.addEventListener("storage", (event) => {
      if (event.key !== LOCAL_KEY) return;
      PATHS.forEach((path) => emit(path, local.value(path)));
    });
    setStatus("local");
    return { mode, status };
  }

  async function set(path, id, value) {
    const cleanValue = clean(value);
    if (mode === "firebase" && fb) {
      await fb.set(fb.ref(fb.db, `${ROOT}/${path}/${id}`), cleanValue);
    } else {
      local.mutate(path, id, (bucket) => { bucket[id] = cleanValue; });
    }
  }

  async function update(path, id, patch) {
    const cleanPatch = clean(patch);
    if (mode === "firebase" && fb) {
      await fb.update(fb.ref(fb.db, `${ROOT}/${path}/${id}`), cleanPatch);
    } else {
      local.mutate(path, id, (bucket) => {
        bucket[id] = Object.assign({}, bucket[id] || {}, cleanPatch);
      });
    }
  }

  async function remove(path, id) {
    if (mode === "firebase" && fb) {
      await fb.remove(fb.ref(fb.db, `${ROOT}/${path}/${id}`));
    } else {
      local.mutate(path, id, (bucket) => { delete bucket[id]; });
    }
  }

  function value(path) {
    return cache.get(path) || {};
  }

  window.OfficeStore = {
    init: init,
    on: on,
    onStatus: onStatus,
    set: set,
    update: update,
    remove: remove,
    value: value,
    newId: newId,
    isConfigured: isConfigured,
    get mode() { return mode; },
    get status() { return status; },
    get inProgress() { return localSeedInProgress; }
  };
})();
