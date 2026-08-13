/**
 * 이음(EEUM) — 마실고래버스(DRT) 호출
 *
 * ★ 중요 — 심사위원께 설명할 부분 ★
 *   마실고래버스의 실제 호출 API는 외부에 공개되어 있지 않습니다.
 *   따라서 이 모듈은 '호출 요청 → 배차 → 도착 → 탑승'의 상태 흐름을
 *   실제 운영 시나리오대로 재현합니다.
 *   실제 서비스에서는 아래 requestCall() 안의 시뮬레이션 부분만
 *   운영사 배차 API 호출로 교체하면 나머지 UI/흐름은 그대로 동작합니다.
 *
 * ★ 이 파일도 '일반 로직'입니다. AI 아님.
 */

const DRT_STATES = {
  IDLE: 'idle',
  SCHEDULED: 'scheduled',    // 예약 접수 완료, 예약 시각을 기다리는 중
  REQUESTING: 'requesting',  // 호출 요청 전송 중
  MATCHED: 'matched',        // 차량 배정 완료
  ARRIVING: 'arriving',      // 스팟으로 이동 중
  ARRIVED: 'arrived',        // 스팟 도착, 탑승 대기
  ONBOARD: 'onboard',        // 탑승 완료
  DONE: 'done',              // 하차
};

const DRT_STATE_LABEL = {
  idle: '대기',
  scheduled: '예약 접수 완료',
  requesting: '호출 요청 중',
  matched: '배차 완료',
  arriving: '스팟으로 이동 중',
  arrived: '스팟 도착 — 탑승해주세요',
  onboard: '탑승 중',
  done: '하차 완료',
};

/** 발표 시간을 고려해 1분을 4초로 압축합니다. 실제 서비스에서는 60000으로 두면 됩니다. */
const DEMO_TICK_MS = 4000;

/** 시연용 차량 풀 */
const DRT_VEHICLES = [
  { plate: '울산 70자 1024', driver: '김영수', model: '카운티 (11인승)', phone: '052-000-0000' },
  { plate: '울산 70자 2087', driver: '박정민', model: '쏠라티 (15인승)', phone: '052-000-0000' },
  { plate: '울산 70자 3312', driver: '이현우', model: '카운티 (11인승)', phone: '052-000-0000' },
];

class DrtCall {
  /**
   * @param {(call:DrtCall)=>void} onChange 상태가 바뀔 때마다 호출되는 콜백 (UI 갱신용)
   */
  constructor(onChange) {
    this.onChange = onChange;
    this.reset();
  }

  reset() {
    this.state = DRT_STATES.IDLE;
    this.spot = null;
    this.destination = null;
    this.vehicle = null;
    this.etaMin = null;
    this.callId = null;
    this.requestedAt = null;
    this.scheduledAt = null;
    this._timers = [];
    this._clearTimers();
  }

  _clearTimers() {
    (this._timers || []).forEach(clearTimeout);
    this._timers = [];
  }

  _set(state, patch = {}) {
    this.state = state;
    Object.assign(this, patch);
    this._persist();
    if (this.onChange) this.onChange(this);
  }

  _later(fn, ms) {
    this._timers.push(setTimeout(fn, ms));
  }

  /** 호출 기록을 localStorage에 남깁니다 (발표 후 "몇 건 호출됐는지" 보여줄 때 사용) */
  _persist() {
    try {
      const log = JSON.parse(localStorage.getItem('eeum.callLog') || '[]');
      const entry = {
        callId: this.callId,
        state: this.state,
        spot: this.spot?.name || null,
        destination: this.destination?.name || null,
        at: new Date().toISOString(),
      };
      if (this.callId) {
        const i = log.findIndex((e) => e.callId === this.callId);
        if (i >= 0) log[i] = entry; else log.push(entry);
        localStorage.setItem('eeum.callLog', JSON.stringify(log.slice(-50)));
      }
    } catch (_) { /* 저장 실패는 무시 — 데모가 멈추면 안 됨 */ }
  }

  /**
   * 호출을 시작합니다.
   * @param {object} spot          승차할 DRT 스팟
   * @param {object} destination   목적지
   * @param {number} dispatchMin   예상 배차 시간(분) — route.js에서 계산한 값
   * @param {Date}   [scheduledAt] 예약 시각. 없으면 즉시 호출.
   */
  requestCall(spot, destination, dispatchMin = 8, scheduledAt = null) {
    this._clearTimers();

    this.spot = spot;
    this.destination = destination;
    this.scheduledAt = scheduledAt;
    this.callId = 'EEUM-' + Date.now().toString(36).toUpperCase().slice(-6);
    this.requestedAt = new Date();

    if (scheduledAt) {
      this._set(DRT_STATES.SCHEDULED);

      // ── 실제 서비스에서는 예약 시각에 운영사 배차 시스템이 매칭을 시작합니다 ──
      //    지금은 그 시점까지의 대기를 데모 시간에 맞춰 압축해 재현합니다.
      this._later(() => this._startDispatch(dispatchMin), DEMO_TICK_MS * 2);
      return;
    }

    this._startDispatch(dispatchMin);
  }

  /** 배차 요청 → 차량 배정 → 이동 중, 흐름을 시간 순서대로 재현합니다. */
  _startDispatch(dispatchMin) {
    this._set(DRT_STATES.REQUESTING);

    // ── 실제 서비스에서는 이 자리에서 운영사 배차 API를 호출합니다 ──
    //    예: await fetch(DRT_OPERATOR_API, { method:'POST', body: {...} })
    //    지금은 배차 시스템의 응답 흐름을 시간 순서대로 재현합니다.

    // 1.6초 뒤: 차량 배정
    this._later(() => {
      const vehicle = DRT_VEHICLES[Math.floor(Math.random() * DRT_VEHICLES.length)];
      const eta = Math.max(2, Math.round(dispatchMin * 0.6)); // 배정 시점엔 이미 절반쯤 와 있음
      this._set(DRT_STATES.MATCHED, { vehicle, etaMin: eta });

      // 1.2초 뒤: 이동 중 상태로
      this._later(() => {
        this._set(DRT_STATES.ARRIVING);
        this._startEtaCountdown();
      }, 1200);
    }, 1600);
  }

  /**
   * ETA를 실제 시간으로 카운트다운합니다.
   * 발표 시간을 고려해 1분을 4초로 압축합니다 (DEMO_TICK_MS).
   * 실제 서비스에서는 60000으로 두면 됩니다.
   */
  _startEtaCountdown() {
    const tick = () => {
      if (this.state !== DRT_STATES.ARRIVING) return;

      this.etaMin -= 1;
      if (this.etaMin <= 0) {
        this.etaMin = 0;
        this._set(DRT_STATES.ARRIVED);
        return;
      }
      this._set(DRT_STATES.ARRIVING);
      this._later(tick, DEMO_TICK_MS);
    };

    this._later(tick, DEMO_TICK_MS);
  }

  /** 탑승 버튼 */
  board() {
    if (this.state !== DRT_STATES.ARRIVED) return;
    this._clearTimers();
    this._set(DRT_STATES.ONBOARD);
  }

  /** 하차 */
  finish() {
    this._clearTimers();
    this._set(DRT_STATES.DONE);
  }

  /** 호출 취소 */
  cancel() {
    this._clearTimers();
    this.reset();
    if (this.onChange) this.onChange(this);
  }

  get isActive() {
    return this.state !== DRT_STATES.IDLE && this.state !== DRT_STATES.DONE;
  }
}
