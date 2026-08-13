/**
 * 이음(EEUM) — 설정
 *
 * PROXY_URL 한 줄만 바꾸면 AI 기능이 켜집니다.
 * (worker/worker.js 를 Cloudflare Workers에 배포하고 받은 주소를 여기 넣으세요)
 */

const CONFIG = {
  /**
   * Cloudflare Worker 프록시 주소.
   * 배포 전에는 비워두세요 — 비어 있으면 앱이 자동으로 '오프라인 시나리오 모드'로 동작합니다.
   * 예: 'https://eeum-proxy.내계정이름.workers.dev'
   */
  PROXY_URL: '',

  /** AI 응답을 이 시간 안에 못 받으면 시나리오 모드로 자동 전환 (발표 사고 방지) */
  AI_TIMEOUT_MS: 8000,

  /** 음성 인식(Whisper) 최대 녹음 길이 */
  MAX_RECORD_MS: 15000,

  /** 화면에 '실시간 BIS 연결됨' 배지를 띄울지 여부 — 앱이 자동 판단합니다 */
  SHOW_LIVE_BADGE: true,
};

/**
 * 설정 오버라이드 — 발표 현장에서 코드를 다시 배포하지 않고 바꿀 수 있게 합니다.
 *
 *  1) URL 파라미터:  ?proxy=https://...   (한 번만 접속하면 저장됨)
 *  2) localStorage:  eeum.proxyUrl
 *
 * 프록시가 죽었을 때 ?proxy= 를 비워 접속하면 즉시 시나리오 모드로 뺄 수 있습니다.
 */
(function applyOverrides() {
  try {
    const params = new URLSearchParams(location.search);

    if (params.has('proxy')) {
      const v = params.get('proxy').trim();
      if (v) localStorage.setItem('eeum.proxyUrl', v);
      else localStorage.removeItem('eeum.proxyUrl');
    }

    const saved = localStorage.getItem('eeum.proxyUrl');
    if (saved) CONFIG.PROXY_URL = saved;

    // ?demo=1 : 네트워크를 아예 쓰지 않는 완전 오프라인 모드
    if (params.get('demo') === '1') CONFIG.PROXY_URL = '';
  } catch (_) { /* 무시 */ }
})();

/** AI 기능을 쓸 수 있는 상태인가? */
function aiAvailable() {
  return Boolean(CONFIG.PROXY_URL);
}

/**
 * 서버 함수가 같이 배포되어 있는지 자동으로 확인합니다.
 *
 * Vercel에 올리면 /api/* 가 같은 도메인에 함께 배포되므로,
 * PROXY_URL을 손으로 적을 필요 없이 여기서 자동 감지합니다.
 * (로컬 미리보기에서는 /api가 없으므로 실패 → 오프라인 모드로 동작)
 *
 * ?proxy= 로 직접 지정한 값이 있으면 그쪽을 우선합니다.
 */
async function detectProxy() {
  if (CONFIG.PROXY_URL) return true; // 이미 수동 지정됨

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    const res = await fetch('/api/health', { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) return false;

    const data = await res.json();
    if (data.ok && data.openai) {
      CONFIG.PROXY_URL = '/api';
      return true;
    }
  } catch (_) { /* 없으면 오프라인 모드로 계속 */ }

  return false;
}
