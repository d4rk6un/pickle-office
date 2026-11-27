/* =========================================================
   db.js — 데이터 계층 + 인증
   ---------------------------------------------------------
   · FIREBASE_CONFIG 가 채워져 있으면
     Firebase Auth(이메일/비밀번호)로 로그인한 뒤에만
     Realtime Database(/office/**) 구독을 시작합니다.
   · 로그인 전에는 오피스 데이터를 전혀 읽지 않습니다.
     (DB 보안 규칙도 auth != null 로 잠겨 있습니다.)
   · 설정이 비어 있으면 localStorage 로컬 데모 모드(개발용).
   ========================================================= */

(function () {
  "use strict";

  const ROOT = (window.OFFICE_SETTINGS && window.OFFICE_SETTINGS.root) || "office";
  const LOCAL_KEY = "pickle-office-db-v1";
  const PATHS = ["agents", "chat", "tasks", "notes", "agenda", "decisions"];
  const FB_VERSION = "11.0.2";
  const AUTH_READY_TIMEOUT = 8000;

  const subs = new Map();       // path -> Set(callback)
  const cache = new Map();      // path -> object
  const statusSubs = new Set();
  const authSubs = new Set();
  let status = "local";         // local | connecting | live | offline | denied | error
  let mode = "local";           // local | firebase
  let fb = null;
  let authApi = null;
  let authUser = null;          // { uid, email, emailVerified } | null
  let authResolved = false;
  let authWaiters = [];
  let dbOffs = [];              // Realtime Database 구독 해지 함수
  let subscribed = false;
  let initError = null;
  let connected = false;          // .info/connected 최근 값
  const snapshots = new Set();   // 첫 스냅샷이 도착한 경로

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
    snapshots.add(path);
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

  /* ---------------- 인증 상태 ---------------- */

  function snapshotUser(user) {
    if (!user) return null;
    return {
      uid: user.uid,
      email: user.email || "",
      emailVerified: !!user.emailVerified
    };
  }

  function currentUser() {
    return authUser ? Object.assign({}, authUser) : null;
  }

  function emitAuth() {
    const user = currentUser();
    authSubs.forEach((cb) => {
      try { cb(user); } catch (e) { console.error(e); }
    });
  }

  function onAuth(cb) {
    authSubs.add(cb);
    if (authResolved) {
      try { cb(currentUser()); } catch (e) { console.error(e); }
    }
    return function off() { authSubs.delete(cb); };
  }

  function resolveAuthWaiters() {
    const waiters = authWaiters;
    authWaiters = [];
    waiters.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
  }

  function whenAuthReady(timeoutMs) {
    if (authResolved) return Promise.resolve(currentUser());
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve(currentUser());
      };
      authWaiters.push(finish);
      setTimeout(finish, timeoutMs || AUTH_READY_TIMEOUT);
    });
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

  function startSubscriptions() {
    if (!fb || subscribed) return;
    subscribed = true;
    PATHS.forEach((path) => {
      const r = fb.ref(fb.db, `${ROOT}/${path}`);
      const off = fb.onValue(
        r,
        (snap) => { emit(path, snap.val() || {}); },
        (err) => {
          console.warn(`[firebase] ${path} 구독 실패`, err && err.message);
          if (err && /permission/i.test(String(err.message))) setStatus("denied");
          else setStatus("offline");
        }
      );
      if (typeof off === "function") dbOffs.push(off);
    });
  }

  function stopSubscriptions() {
    dbOffs.forEach((off) => { try { off(); } catch (e) { /* ignore */ } });
    dbOffs = [];
    subscribed = false;
    cache.clear();
    snapshots.clear();
    PATHS.forEach((path) => emit(path, {}));
  }

  async function initFirebase(cfg) {
    const appMod = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app.js`);
    const dbMod = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-database.js`);
    const authMod = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-auth.js`);

    const app = appMod.initializeApp(cfg);
    const database = dbMod.getDatabase(app);
    const auth = authMod.getAuth(app);

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
    authApi = {
      auth: auth,
      signIn: authMod.signInWithEmailAndPassword,
      signOut: authMod.signOut,
      currentUser: authMod.getAuth
    };

    // 연결 상태 배지
    try {
      const infoRef = dbMod.ref(database, ".info/connected");
      dbMod.onValue(infoRef, (snap) => {
        connected = snap.val() === true;
        if (!authUser) return;
        setStatus(connected ? "live" : "offline");
      });
    } catch (e) { /* ignore */ }

    // 로그인 상태가 바뀔 때마다 구독을 열고 닫습니다.
    authMod.onAuthStateChanged(auth, (user) => {
      const prevUid = authUser ? authUser.uid : null;
      authUser = snapshotUser(user);
      authResolved = true;

      if (authUser) {
        startSubscriptions();
        if (prevUid !== authUser.uid) setStatus(connected ? "live" : "connecting");
      } else {
        stopSubscriptions();
      }

      emitAuth();
      resolveAuthWaiters();
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
        await whenAuthReady(AUTH_READY_TIMEOUT);
        return { mode, status, user: currentUser(), error: null };
      } catch (err) {
        console.error("[firebase] 초기화 실패", err);
        initError = err;
        fb = null;
        authApi = null;
        setStatus("error");
        return { mode, status, user: null, error: err };
      }
    }

    // 로컬 데모 모드(개발용): Firebase 설정이 없을 때만 동작
    mode = "local";
    authResolved = true;
    PATHS.forEach((path) => emit(path, local.value(path)));
    window.addEventListener("storage", (event) => {
      if (event.key !== LOCAL_KEY) return;
      PATHS.forEach((path) => emit(path, local.value(path)));
    });
    setStatus("local");
    emitAuth();
    return { mode, status, user: null, error: null };
  }

  function assertWritable() {
    if (mode === "firebase" && !authUser) {
      throw new Error("로그인이 필요합니다");
    }
  }

  async function set(path, id, value) {
    assertWritable();
    const cleanValue = clean(value);
    if (mode === "firebase" && fb) {
      await fb.set(fb.ref(fb.db, `${ROOT}/${path}/${id}`), cleanValue);
    } else {
      local.mutate(path, id, (bucket) => { bucket[id] = cleanValue; });
    }
  }

  async function update(path, id, patch) {
    assertWritable();
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
    assertWritable();
    if (mode === "firebase" && fb) {
      await fb.remove(fb.ref(fb.db, `${ROOT}/${path}/${id}`));
    } else {
      local.mutate(path, id, (bucket) => { delete bucket[id]; });
    }
  }

  function value(path) {
    return cache.get(path) || {};
  }

  async function signIn(email, password) {
    if (!authApi) throw new Error("인증을 사용할 수 없습니다");
    const cred = await authApi.signIn(authApi.auth, email, password);
    return snapshotUser(cred && cred.user);
  }

  async function signOutUser() {
    if (!authApi) return;
    await authApi.signOut(authApi.auth);
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
    signIn: signIn,
    signOut: signOutUser,
    onAuth: onAuth,
    user: currentUser,
    whenAuthReady: whenAuthReady,
    has: function (path) { return snapshots.has(path); },
    get mode() { return mode; },
    get status() { return status; },
    get ready() { return authResolved; },
    get initError() { return initError; }
  };
})();
