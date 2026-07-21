/* PULSE 하드웨어 드라이버 레지스트리
 *
 * 디바이스별 입출력(프로토콜/연결설정)을 이 파일에 모아둔다.
 * 새 하드웨어(예: 여성용 기기)가 나오면 여기에 드라이버 1개만 register 하면 되고,
 * device.js·앱 나머지(funscript·콘솔·방송 등)는 손대지 않는다.
 *
 * 캐노니컬 명령 = TCode 문자열(예: 'L050I500'). 앱 전체가 이 형식으로 명령을 만든다.
 * 각 드라이버의 encode(cmd)가 캐노니컬 명령을 그 기기의 실제 바이트로 변환한다.
 * (TCode 호환 기기는 그대로 통과, 다른 기기는 여기서 매핑)
 *
 * 드라이버 형태:
 *   {
 *     id, name,
 *     serialBaud,                       // USB 시리얼 통신속도
 *     ble: { service, txChar, write },  // BLE 서비스/쓰기 캐릭터리스틱 UUID, write: 'withoutResponse'|'withResponse'
 *     init: [캐노니컬 명령...],          // 연결 직후 전송
 *     stop, idle,                       // 정지 명령 / 안전위치 명령 (캐노니컬)
 *     encode(cmd) -> Uint8Array,        // 캐노니컬 → 기기 바이트
 *   }
 */
(function () {
    const drivers = {};
    let activeId = null;
    const enc = (s) => new TextEncoder().encode(s);

    function register(d) {
        drivers[d.id] = d;
        if (!activeId) activeId = d.id;   // 첫 등록 드라이버가 기본
    }

    // ── 기본 드라이버: TCode V3 (OSR2 · SR6 · TempestMAX · PULSE) ─────────────
    register({
        id: 'tcode_v3',
        name: 'TCode V3 (OSR2 · SR6 · PULSE)',
        serialBaud: 9600,
        ble: {
            service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',   // Nordic UART Service
            txChar:  '6e400002-b5a3-f393-e0a9-e50e24dcca9e',   // client → device (write)
            write:   'withoutResponse',
        },
        init: ['D1', 'L050I500'],
        stop: 'DSTOP',
        idle: 'L050I300',
        encode(cmd) { return enc(cmd + '\n'); },                // TCode 그대로 (개행 종단)
    });

    /* ── 예시: 여성용 하드웨어 드라이버 ──────────────────────────────────────
     * 기기가 출시되면 아래를 채워 register 하고, 기본으로 쓰려면 setActive 호출.
     * encode()에서 캐노니컬 TCode를 이 기기 프로토콜로 변환만 해주면 나머지는 그대로 동작.
     *
     * register({
     *     id: 'femtech_v1',
     *     name: '여성용 기기',
     *     serialBaud: 115200,
     *     ble: { service: '<기기 BLE 서비스 UUID>', txChar: '<쓰기 캐릭터리스틱 UUID>', write: 'withResponse' },
     *     init: ['<연결 시 보낼 캐노니컬 명령들>'],
     *     stop: '<정지>',
     *     idle: '<안전 위치>',
     *     encode(cmd) {
     *         // 캐노니컬 TCode 파싱 → 기기 프로토콜로 매핑
     *         //   m[1]=축(L0/R0/R2 ...), m[2]=위치(0~99 또는 0~999), m[3]=보간(ms)
     *         const m = cmd.match(/^([A-Z]\d)(\d+)(?:I(\d+))?/);
     *         if (!m) return enc(cmd);                  // 모르는 명령은 통과/무시
     *         const axis = m[1], pos = parseInt(m[2], 10);
     *         // 예) L0(스트로크) → 진동 세기 0~100 으로 변환하는 자체 포맷
     *         return enc(`V:${Math.round(pos / 99 * 100)}\n`);
     *     },
     * });
     * window.PulseDrivers.setActive('femtech_v1');
     * ───────────────────────────────────────────────────────────────────── */

    window.PulseDrivers = {
        register,
        list:      () => Object.values(drivers).map(d => ({ id: d.id, name: d.name })),
        get:       (id) => drivers[id],
        active:    () => drivers[activeId],
        activeId:  () => activeId,
        setActive: (id) => { if (drivers[id]) { activeId = id; return true; } return false; },
    };
})();
