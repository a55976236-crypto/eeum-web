/**
 * GET /api/health
 *
 * 앱이 시작할 때 이 주소를 찔러보고, 정상 응답이 오면 AI 기능을 켭니다.
 * 브라우저에서 직접 열어봐도 됩니다 — 배포가 잘 됐는지 확인하는 용도입니다.
 *
 * 기대 응답: {"ok":true,"openai":true,"bis":true}
 * openai가 false면 환경변수 OPENAI_API_KEY가 설정되지 않은 것입니다.
 */

import { json } from './_shared.js';

export const config = { runtime: 'edge' };

export default function handler() {
  return json({
    ok: true,
    service: 'eeum-api',
    openai: Boolean(process.env.OPENAI_API_KEY),
    bis: Boolean(process.env.BIS_SERVICE_KEY),
  });
}
