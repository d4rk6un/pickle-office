/* =========================================================
   config.js — Firebase Realtime Database 설정
   ---------------------------------------------------------
   아래 값만 채우면 자동으로 실시간 동기화 모드로 바뀝니다.
   (값이 "PASTE_..." 인 동안에는 localStorage 로컬 데모 모드로 동작해요.)

   Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹) → SDK 설정 및 구성
   에서 복사해 붙여넣으면 됩니다.
   databaseURL 은 Realtime Database 를 만든 뒤
   "데이터베이스 URL"(예: https://xxxx-default-rtdb.asia-southeast1.firebasedatabase.app) 값을 넣으세요.
   ========================================================= */

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAn7puIbn3cF2rnk1_aigr2ME5IK3CIiB4",
  authDomain: "pickle-office-e32dd.firebaseapp.com",
  databaseURL: "https://pickle-office-e32dd-default-rtdb.firebaseio.com",
  projectId: "pickle-office-e32dd",
  storageBucket: "pickle-office-e32dd.firebasestorage.app",
  messagingSenderId: "193169193392",
  appId: "1:193169193392:web:58575fc8ec7056685c7e75"
};

/* 오피스 공통 설정 */
window.OFFICE_SETTINGS = {
  /* Firebase 에서 데이터를 읽고 쓰는 최상위 경로 */
  root: "office",
  /* 데스크(자리) 수 */
  desks: 6,
  /* 이 시간(ms) 안에 heartbeat 가 있으면 "접속 중"으로 표시 */
  onlineWindowMs: 3 * 60 * 1000
};
