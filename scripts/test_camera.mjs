/**
 * 카메라 선택·진단 모듈 테스트 — `public/js/core/camera.js`
 *
 *   실행: node scripts/test_camera.mjs
 *
 * 지켜야 하는 것 (2026-10-30 "다른 PC 에서 카메라가 안 뜬다" 제보에서 나온 요구):
 *   1) 실패 사유가 **사용자가 할 수 있는 조치**로 번역된다 — 권한/점유/없음/제약 위반을 구분
 *   2) http(LAN) 주소처럼 보안 컨텍스트가 아니면 **그 사실을 먼저** 알려준다
 *      (이 경우 navigator.mediaDevices 자체가 없어 예전 코드는 TypeError 로 조용히 죽었다)
 *   3) 저장된 카메라가 **그 PC 에 없으면** 자동으로 '자동' 으로 한 번 더 시도한다
 *      — 선택은 localStorage 라서 다른 PC 에서는 존재하지 않는 deviceId 일 수 있다
 *   4) 목록 채우기는 저장된 선택을 복원하고, 없는 선택은 무시한다
 */
import fs from 'fs';
import vm from 'vm';

const SRC = fs.readFileSync(new URL('../public/js/core/camera.js', import.meta.url), 'utf8');

// ── 최소 DOM / navigator ──
function mkSelect() {
    const el = { value: '', innerHTML: '', dataset: {}, children: [], _listeners: {},
        appendChild(o) { this.children.push(o); },
        addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
        fire(ev) { (this._listeners[ev] || []).forEach((f) => f()); },
    };
    return el;
}
function makeCtx({ secure = true, devices = [], gum = null, store = {} } = {}) {
    const ctx = {
        console: { log() {}, warn() {} },
        location: { protocol: 'https:', host: 'syncra.uk', origin: 'https://syncra.uk' },
        isSecureContext: secure,
        navigator: {},
        document: {
            createElement: () => ({ value: '', textContent: '' }),
            addEventListener() {},
        },
        localStorage: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = v; },
        },
        Error, Promise, Object, Math, String, Boolean, JSON,
    };
    if (secure) {
        ctx.navigator.mediaDevices = {
            enumerateDevices: async () => devices,
            getUserMedia: gum || (async () => ({ getVideoTracks: () => [] })),
        };
    }
    ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx); vm.runInContext(SRC, ctx);
    return ctx;
}

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); };
const err = (name) => Object.assign(new Error(name + ' msg'), { name });

console.log('\n1. 실패 사유를 조치로 번역한다');
{
    const C = makeCtx().window.PulseCamera;
    ok('권한 거부 → 주소창 자물쇠 안내', /권한이 거부.*자물쇠/.test(C.explain(err('NotAllowedError'))), C.explain(err('NotAllowedError')));
    ok('점유 → 다른 프로그램 종료 안내', /다른 프로그램.*Zoom/.test(C.explain(err('NotReadableError'))), C.explain(err('NotReadableError')));
    ok('장치 없음 → 연결·목록 안내', /찾을 수 없/.test(C.explain(err('NotFoundError'))));
    ok('제약 위반 → 자동/다른 카메라 안내', /자동.*다른 카메라/.test(C.explain(err('OverconstrainedError'))));
    ok('모르는 오류도 이름을 남긴다', /WeirdError/.test(C.explain(err('WeirdError'))), C.explain(err('WeirdError')));
}

console.log('\n2. 보안 컨텍스트가 아니면 그걸 먼저 알린다');
{
    const ctx = makeCtx({ secure: false });
    ctx.location.protocol = 'http:'; ctx.location.host = '192.168.219.108:5501';
    const C = ctx.window.PulseCamera;
    const r = C.unsupportedReason();
    ok('https/localhost 필요를 알려준다', /https 또는 localhost/.test(r || ''), String(r));
    ok('현재 주소를 같이 보여준다', /192\.168\.219\.108:5501/.test(r || ''), String(r));
    const thrown = await C.open({}).then(() => null, (e) => e);
    ok('open() 은 그 사유를 담아 던진다', thrown && /https 또는 localhost/.test(thrown.pulseReason || ''), String(thrown && thrown.message));
    ok('목록은 빈 배열 (예외 아님)', (await C.listVideoInputs()).length === 0);
}

console.log('\n3. 저장된 카메라가 그 PC 에 없으면 자동으로 되돌린다');
{
    const calls = [];
    const gum = async (c) => {
        calls.push(c.video && c.video.deviceId ? 'exact' : 'auto');
        if (c.video && c.video.deviceId) throw err('OverconstrainedError');
        return { getVideoTracks: () => [{ label: 'FaceTime HD', readyState: 'live', getSettings: () => ({ width: 1280, height: 720, frameRate: 30 }) }] };
    };
    const C = makeCtx({ gum }).window.PulseCamera;
    const stream = await C.open({ deviceId: 'ghost-device-id' });
    ok('exact 시도 후 자동으로 재시도', calls.join('>') === 'exact>auto', calls.join('>'));
    ok('결국 스트림을 돌려준다', !!stream);
    ok('describe 가 사람이 읽을 요약을 만든다', /FaceTime HD · 1280x720 @30 · live/.test(C.describe(stream)), C.describe(stream));
}

console.log('\n4. 권한 거부는 되돌리지 않고 그대로 보고한다');
{
    const calls = [];
    const gum = async (c) => { calls.push(c.video && c.video.deviceId ? 'exact' : 'auto'); throw err('NotAllowedError'); };
    const C = makeCtx({ gum }).window.PulseCamera;
    const e = await C.open({ deviceId: 'x' }).then(() => null, (x) => x);
    ok('재시도하지 않는다 (권한 문제라 의미 없다)', calls.join('>') === 'exact', calls.join('>'));
    ok('사유가 번역돼 온다', /자물쇠/.test((e && e.pulseReason) || ''), String(e && e.pulseReason));
}

console.log('\n5. 목록 채우기 — 저장된 선택 복원');
{
    const devices = [
        { kind: 'videoinput', deviceId: 'cam-a', label: 'Integrated Webcam' },
        { kind: 'videoinput', deviceId: 'cam-b', label: 'OBS Virtual Camera' },
        { kind: 'audioinput', deviceId: 'mic-a', label: '마이크' },
    ];
    const C = makeCtx({ devices, store: { pulse_cam_device: 'cam-b' } }).window.PulseCamera;
    const sel = mkSelect();
    const list = await C.fillSelect(sel);
    ok('비디오 입력만 담는다', list.length === 2, JSON.stringify(list.map((d) => d.label)));
    ok('자동 옵션 + 카메라 2개', sel.children.length === 2 && /자동/.test(sel.innerHTML), sel.innerHTML + ' / ' + sel.children.length);
    ok('저장된 선택을 복원한다', sel.value === 'cam-b', sel.value);

    // 저장값이 그 PC 에 없는 경우
    const C2 = makeCtx({ devices, store: { pulse_cam_device: 'ghost' } }).window.PulseCamera;
    const sel2 = mkSelect();
    await C2.fillSelect(sel2);
    ok('없는 선택은 무시하고 자동', sel2.value === '', JSON.stringify(sel2.value));

    // 선택이 바뀌면 저장 + 콜백
    const store = {};
    const C3 = makeCtx({ devices, store }).window.PulseCamera;
    const sel3 = mkSelect();
    let got = null;
    await C3.fillSelect(sel3, (v) => { got = v; });
    sel3.value = 'cam-a'; sel3.fire('change');
    ok('바뀌면 저장한다', store.pulse_cam_device === 'cam-a', JSON.stringify(store));
    ok('바뀌면 콜백을 준다 (스트림 교체용)', got === 'cam-a', String(got));
}

console.log('\n6. 영상 트랙이 없으면 거짓말하지 않는다');
{
    const C = makeCtx().window.PulseCamera;
    ok('트랙 없음 표기', C.describe({ getVideoTracks: () => [] }) === '영상 트랙 없음', C.describe({ getVideoTracks: () => [] }));
    ok('null 도 안전', C.describe(null) === '영상 트랙 없음');
}

console.log('\n7. 설정 패널 — 마이크·스피커도 같은 방식으로 고른다 (2026-10-30)');
{
    const devices = [
        { kind: 'audioinput',  deviceId: 'mic-a', label: '내장 마이크' },
        { kind: 'audioinput',  deviceId: 'mic-b', label: 'USB 마이크' },
        { kind: 'audiooutput', deviceId: 'spk-a', label: '스피커' },
        { kind: 'videoinput',  deviceId: 'cam-a', label: '웹캠' },
    ];
    const store = { pulse_mic_device: 'mic-b' };
    const C = makeCtx({ devices, store }).window.PulseCamera;

    const micSel = mkSelect();
    const list = await C.fillKindSelect(micSel, 'audioinput', 'pulse_mic_device');
    ok('마이크만 담는다', list.length === 2, JSON.stringify(list.map((d) => d.label)));
    ok('저장된 마이크 복원', micSel.value === 'mic-b', micSel.value);

    const spkSel = mkSelect();
    const sl = await C.fillKindSelect(spkSel, 'audiooutput', 'pulse_spk_device');
    ok('스피커만 담는다', sl.length === 1 && sl[0].label === '스피커', JSON.stringify(sl));

    micSel.value = 'mic-a'; micSel.fire('change');
    ok('선택이 저장된다', store.pulse_mic_device === 'mic-a', JSON.stringify(store));

    // 라벨이 비어 있을 때(권한 전) 종류 이름으로 채운다
    const C2 = makeCtx({ devices: [{ kind: 'audioinput', deviceId: 'x', label: '' }] }).window.PulseCamera;
    const s2 = mkSelect();
    const l2 = await C2.fillKindSelect(s2, 'audioinput', 'k');
    ok('권한 전 라벨은 "마이크 1" 로', l2[0].label === '마이크 1', l2[0].label);
}

console.log('\n8. 소리 출력 지정 — 지원 안 하면 그 사실을 돌려준다');
{
    const C = makeCtx().window.PulseCamera;
    ok('setSinkId 없는 브라우저 → 안내 문구', /지원하지 않습니다/.test(await C.applySink({}, 'spk-a')), String(await C.applySink({}, 'spk-a')));
    let got = null;
    ok('지원하면 null (조용히 성공)', (await C.applySink({ setSinkId: async (id) => { got = id; } }, 'spk-a')) === null);
    ok('지정한 장치로 호출된다', got === 'spk-a', String(got));
    ok('실패하면 사유를 돌려준다', /바꿀 수 없습니다/.test(await C.applySink({ setSinkId: async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); } }, 'z')));
    ok('요소가 없으면 조용히 통과', (await C.applySink(null, 'z')) === null);
}

console.log('\n9. 트랙 교체 — 스트림 객체 정체성을 유지한다');
{
    const C = makeCtx().window.PulseCamera;
    const mkTrack = (id) => ({ id, stopped: false, stop() { this.stopped = true; } });
    const t1 = mkTrack('t1'), t2 = mkTrack('t2');
    const tracks = [t1];
    const stream = { id: 'S1', removeTrack(t) { const i = tracks.indexOf(t); if (i >= 0) tracks.splice(i, 1); }, addTrack(t) { tracks.push(t); } };

    C.swapTrack(stream, t1, t2);
    ok('옛 트랙을 정지한다', t1.stopped === true);
    ok('옛 트랙이 빠지고 새 트랙이 들어간다', tracks.length === 1 && tracks[0] === t2, JSON.stringify(tracks.map((t) => t.id)));
    ok('스트림 객체는 그대로 (두 번째 교체가 실패하지 않게)', stream.id === 'S1');

    let threw = false;
    try { C.swapTrack(null, t1, t2); C.swapTrack(stream, null, t2); } catch (_) { threw = true; }
    ok('인자가 없어도 던지지 않는다', !threw);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
