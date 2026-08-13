/**
 * GET /api/bis/arrival?stopid=196040122 — 실시간 버스 도착정보
 *
 * 울산 BIS가 주는 진짜 실시간 데이터입니다.
 * ARRIVALTIME은 초 단위라 분으로 바꿔서 돌려줍니다.
 *
 * 인증키가 아직 승인되지 않았다면 error를 담아 돌려주고,
 * 앱은 자동으로 추정치(route.js의 estimateBusDelay)로 계속 동작합니다.
 */

import { json, callBis } from '../_shared.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
  try {
    const url = new URL(request.url);
    const stopid = url.searchParams.get('stopid');
    if (!stopid) return json({ error: 'stopid 필요' }, 400);

    // 문서상 오퍼레이션명은 AllBusArrivalInfo인데 예제 URL은 getBusArrivalInfo입니다.
    // 어느 쪽이 맞는지 확정되지 않아 순서대로 시도합니다.
    let parsed = await callBis('getBusArrivalInfo', { stopid, pageNo: '1', numOfRows: '10' });
    if (parsed.error || parsed.rows.length === 0) {
      const alt = await callBis('AllBusArrivalInfo', { stopid, pageNo: '1', numOfRows: '10' });
      if (!alt.error && alt.rows.length > 0) parsed = alt;
    }

    if (parsed.error) return json({ error: parsed.error, arrivals: [] }, 502);

    const arrivals = parsed.rows
      .map((r) => {
        const seconds = parseInt(r.ARRIVALTIME, 10);
        return {
          route: r.ROUTENM,
          seconds,
          minutes: Math.max(1, Math.round(seconds / 60)),
          stopsLeft: parseInt(r.PREVSTOPCNT, 10),
          currentStop: r.PRESENTSTOPNM,
          stopName: r.STOPNM,
        };
      })
      .filter((a) => Number.isFinite(a.seconds))
      .sort((a, b) => a.seconds - b.seconds);

    return json({ stopid, count: arrivals.length, arrivals });
  } catch (err) {
    return json({ error: String(err.message || err), arrivals: [] }, 500);
  }
}
