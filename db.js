/* =========================================================
   db.js — 데이터 계층 + 입장코드 인증
   ---------------------------------------------------------
   인증 흐름 ('피클 입장코드' 방식)
     1) Firebase Anonymous Auth 로 익명 세션 uid 를 받습니다.
     2) 사용자가 입력한 입장코드를 /office_sessions/{uid} 에
        { code, ts } 로 씁니다.
     3) Realtime Database 보안 규칙이 서버에서
        /office_codes/{code} 존재 여부를 검사합니다.
        · 코드가 없으면 쓰기 자체가 PERMISSION_DENIED
        · 세션이 없으면 /office 읽기/쓰기도 전면 차단
     4) 입장 성공 시 agentId = "pickle_" + sha256(code) 앞 12자리 로
        /office/agents/{agentId} 에 내 피클을 연결합니다.
        → 같은 입장코드는 어느 기기/브라우저에서든 같은 피클 자리.
        → 공개 저장소(index.html/app.js/config.js)에는 코드가 없습니다.

   · 로그아웃하면 /office_sessions/{uid} 를 지우고 signOut 합니다.
   · 새로고침하면 익명 uid 는 유지되므로, 내 세션 노드에 남아 있는
     코드를 읽어(본인 uid 만 읽기 허용) 같은 피클로 이어서 입장합니다.
   · FIREBASE_CONFIG 가 비어 있으면 localStorage 로컬 데모 모드(개발용).
   ========================================================= */

(function () {
  "use strict";

  const ROOT = (window.OFFICE_SETTINGS && window.OFFICE_SETTINGS.root) || "office";
  const SESSIONS = "office_sessions";     // /office_sessions/{uid} = { code, ts }
  const LOCAL_KEY = "pickle-office-db-v1";
  const PATHS = ["agents", "chat", "tasks", "notes", "agenda", "decisions"];
  const FB_VERSION = "11.0.2";
  const AUTH_READY_TIMEOUT = 8000;
  const AGENT_PREFIX = "pickle_";
  const AGENT_HASH_LEN = 12;

  const subs = new Map();       // path -> Set(callback)
  const cache = new Map();      // path -> object
  const statusSubs = new Set();
  const authSubs = new Set();
  let status = "local";         // local | locked | connecting | live | offline | denied | error
  let mode = "local";           // local | firebase
  let fb = null;
  let authApi = null;
  let authUser = null;          // { uid, anonymous } | null
  let authResolved = false;
  let authWaiters = [];
  let session = null;           // { uid, code, agentId } | null
  let dbOffs = [];              // Realtime Database 구독 해지 함수
  let subscribed = false;
  let initError = null;
  let connected = false;        // .info/connected 최근 값
  const snapshots = new Set();  // 첫 스냅샷이 도착한 경로

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

  /* ---------------- 입장코드 유틸 ---------------- */

  /* 사용자가 입력한 코드 후보들.
     대소문자·공백 실수를 흡수하되, 저장/해시에 쓴 문자열이 기준입니다. */
  function codeVariants(raw) {
    const text = String(raw == null ? "" : raw).trim();
    const out = [];
    const push = (v) => {
      if (v && v.length >= 4 && v.length <= 64 && out.indexOf(v) < 0) out.push(v);
    };
    push(text);
    push(text.toUpperCase());
    push(text.replace(/\s+/g, ""));
    push(text.replace(/\s+/g, "").toUpperCase());
    return out;
  }

  /* SHA-256 (hex). crypto.subtle 이 없는 환경(http/localhost 아님)은 JS 구현으로 대체 */
  function sha256Hex(text) {
    const bytes = new TextEncoder().encode(String(text));
    if (window.crypto && window.crypto.subtle && window.crypto.subtle.digest) {
      return window.crypto.subtle.digest("SHA-256", bytes).then(function (buf) {
        const view = new Uint8Array(buf);
        let hex = "";
        for (let i = 0; i < view.length; i++) hex += view[i].toString(16).padStart(2, "0");
        return hex;
      });
    }
    return Promise.resolve(sha256Fallback(bytes));
  }

  const SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function sha256Fallback(bytes) {
    const len = bytes.length;
    const total = (((len + 8) >> 6) + 1) * 64;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    const view = new DataView(buf.buffer);
    const bits = len * 8;
    view.setUint32(total - 8, Math.floor(bits / 4294967296));
    view.setUint32(total - 4, bits >>> 0);

    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
               0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));

    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    return h.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
  }

  /* 입장코드 → 고정 피클 ID. 코드 원문은 저장소에 남기지 않습니다. */
  function agentIdFor(code) {
    return sha256Hex(String(code)).then(function (hex) {
      return AGENT_PREFIX + hex.slice(0, AGENT_HASH_LEN);
    });
  }

  /* ---------------- 인증 상태 ---------------- */

  function snapshotUser(user) {
    if (!user) return null;
    return {
      uid: user.uid,
      anonymous: !!user.isAnonymous,
      email: user.email || ""
    };
  }

  function currentUser() {
    return authUser ? Object.assign({}, authUser) : null;
  }

  function currentSession() {
    return session ? Object.assign({}, session) : null;
  }

  function currentAgentId() {
    return session ? session.agentId : null;
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

  function isPermissionDenied(err) {
    if (!err) return false;
    const code = String(err.code || "");
    const message = String(err.message || "");
    return code === "PERMISSION_DENIED" || /permission[_\s-]?denied/i.test(message);
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
          if (isPermissionDenied(err)) setStatus("denied");
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
    PATHS.forEach((path) => emit(path, {}));
    snapshots.clear();   // 로그아웃 시 비운 값은 "스냅샷"으로 세지 않습니다
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
      get: dbMod.get,
      set: dbMod.set,
      update: dbMod.update,
      remove: dbMod.remove,
      goOffline: dbMod.goOffline,
      goOnline: dbMod.goOnline
    };
    authApi = {
      auth: auth,
      signInAnonymously: authMod.signInAnonymously,
      signOut: authMod.signOut,
      currentUser: authMod.getAuth
    };

    // 연결 상태 배지
    try {
      const infoRef = dbMod.ref(database, ".info/connected");
      dbMod.onValue(infoRef, (snap) => {
        connected = snap.val() === true;
        if (!authUser || !session) return;
        setStatus(connected ? "live" : "offline");
      });
    } catch (e) { /* ignore */ }

    // 로그인(익명 uid) 상태가 바뀔 때마다 구독을 열고 닫습니다.
    // 세션(session)이 확인된 경우에만 오피스 데이터를 읽습니다.
    authMod.onAuthStateChanged(auth, (user) => {
      const prevUid = authUser ? authUser.uid : null;
      authUser = snapshotUser(user);
      authResolved = true;

      if (authUser) {
        if (session && session.uid === authUser.uid) {
          startSubscriptions();
          if (prevUid !== authUser.uid) setStatus(connected ? "live" : "connecting");
        }
      } else {
        session = null;
        stopSubscriptions();
        if (mode === "firebase") setStatus("locked");
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
        await restoreSession();
        return { mode, status, user: currentUser(), session: currentSession(), error: null };
      } catch (err) {
        console.error("[firebase] 초기화 실패", err);
        initError = err;
        fb = null;
        authApi = null;
        setStatus("error");
        return { mode, status, user: null, session: null, error: err };
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
    return { mode, status, user: null, session: null, error: null };
  }

  /* 새로고침 후: 익명 uid 는 유지되므로 내 세션 노드에서 코드를 되찾습니다.
     (/office_sessions/{uid} 는 본인 uid 만 읽을 수 있습니다) */
  async function restoreSession() {
    if (!fb || !authApi) return null;
    const user = authUser || (await whenAuthReady(AUTH_READY_TIMEOUT));
    if (!user) return null;

    let value = null;
    try {
      const snap = await fb.get(fb.ref(fb.db, `${SESSIONS}/${user.uid}`));
      value = snap && snap.val();
    } catch (err) {
      // 세션을 확인할 수 없으면 입장코드 화면으로 돌아갑니다
      if (isPermissionDenied(err)) setStatus("locked");
      return null;
    }
    const code = value && typeof value.code === "string" ? value.code : "";
    if (!code) return null;

    const agentId = await agentIdFor(code);
    session = { uid: user.uid, code: code, agentId: agentId };
    setStatus(connected ? "live" : "connecting");
    startSubscriptions();
    emitAuth();
    return currentSession();
  }

  /* 입장코드로 입장:
     익명 로그인 → /office_sessions/{uid} 쓰기(규칙이 코드 검증) → agentId 연결 */
  async function signInWithAccessCode(rawCode) {
    const variants = codeVariants(rawCode);
    if (!variants.length) {
      const err = new Error("입장코드를 입력해 주세요");
      err.code = "office/empty-code";
      throw err;
    }

    if (mode === "local") {
      const code = variants[0];
      const agentId = await agentIdFor(code);
      session = { uid: "local", code: code, agentId: agentId, local: true };
      setStatus("local");
      emitAuth();
      return currentSession();
    }

    if (!fb || !authApi) {
      const err = new Error("인증을 사용할 수 없어요");
      err.code = "office/no-auth";
      throw err;
    }

    let user = authUser;
    if (!user) {
      const cred = await authApi.signInAnonymously(authApi.auth);
      user = snapshotUser(cred && cred.user);
      if (!user) {
        const err = new Error("익명 로그인에 실패했어요");
        err.code = "office/no-anon-user";
        throw err;
      }
    }

    let denied = false;
    let lastError = null;

    for (let i = 0; i < variants.length; i++) {
      const code = variants[i];
      try {
        await fb.set(fb.ref(fb.db, `${SESSIONS}/${user.uid}`), { code: code, ts: Date.now() });
        const agentId = await agentIdFor(code);
        session = { uid: user.uid, code: code, agentId: agentId };
        setStatus(connected ? "live" : "connecting");
        startSubscriptions();
        emitAuth();
        return currentSession();
      } catch (err) {
        lastError = err;
        if (!isPermissionDenied(err)) break;
        denied = true;
      }
    }

    // 세션 쓰기가 거부됨 = 유효하지 않은 입장코드. 익명 세션은 정리합니다.
    try { await authApi.signOut(authApi.auth); } catch (e) { /* ignore */ }
    session = null;
    setStatus("locked");

    if (denied) {
      const err = new Error("유효하지 않은 입장코드예요");
      err.code = "office/invalid-code";
      throw err;
    }
    throw lastError || new Error("입장하지 못했어요");
  }

  async function signOutUser() {
    const user = authUser;
    session = null;
    if (mode === "local") {
      setStatus("local");
      emitAuth();
      return;
    }
    if (!authApi) return;
    try {
      if (fb && user && user.uid) {
        await fb.remove(fb.ref(fb.db, `${SESSIONS}/${user.uid}`));
      }
    } catch (e) {
      console.warn("[session] 세션 정리 실패", e && e.message);
    }
    try { await authApi.signOut(authApi.auth); } catch (e) { /* ignore */ }
  }

  function assertWritable() {
    if (mode === "firebase" && (!authUser || !session)) {
      throw new Error("입장코드 인증이 필요합니다");
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
    signInWithAccessCode: signInWithAccessCode,
    signOut: signOutUser,
    restoreSession: restoreSession,
    onAuth: onAuth,
    user: currentUser,
    session: currentSession,
    agentId: currentAgentId,
    agentIdFor: agentIdFor,
    codeVariants: codeVariants,
    whenAuthReady: whenAuthReady,
    has: function (path) { return snapshots.has(path); },
    get mode() { return mode; },
    get status() { return status; },
    get ready() { return authResolved; },
    get initError() { return initError; }
  };
})();
