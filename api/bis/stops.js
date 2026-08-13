/**
 * GET /api/bis/stops?pageNo=1&numOfRows=500 — 정류장 목록 (좌표 포함)
 *
 * 울산 전역 약 3,297개 정류장의 이름과 위경도를 제공합니다.
 *
 * 주의: 발표 중에 이걸 실시간으로 부르지 마세요.
 *   정류장 목록은 잘 바뀌지 않으므로 tools/fetch-stops.ps1 로 미리 받아
 *   data/stops.json 에 넣어두는 쪽이 훨씬 빠르고 안전합니다.
 *   이 함수는 그 데이터를 만들 때와 검증용으로 씁니다.
 */

import { json, callBis } from '../_shared.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
  try {
    const url = new URL(request.url);
    const pageNo = url.searchParams.get('pageNo') || '1';
    const numOfRows = url.searchParams.get('numOfRows') || '500';

    const parsed = await callBis('BusStopInfo', { pageNo, numOfRows });
    if (parsed.error) return json({ error: parsed.error, stops: [] }, 502);

    const stops = parsed.rows
      .map((r) => ({
        id: r.STOPID,
        name: r.STOPNAME,
        lat: parseFloat(r.STOPY),
        lng: parseFloat(r.STOPX),
        remark: r.STOPREMARK === '-' ? null : r.STOPREMARK,
      }))
      // 울산 범위를 벗어난 좌표는 데이터 오류로 보고 버립니다.
      .filter((s) => s.lat > 35.2 && s.lat < 35.8 && s.lng > 128.9 && s.lng < 129.5);

    return json({ totalCnt: parsed.totalCnt, count: stops.length, stops });
  } catch (err) {
    return json({ error: String(err.message || err), stops: [] }, 500);
  }
}
