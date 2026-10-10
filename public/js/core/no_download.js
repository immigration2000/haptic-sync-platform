/* 콘텐츠 다운로드 입구 차단 (2026-10-10)
 *
 * 무엇을 닫는가:
 *   · 네이티브 영상 컨트롤의 ⬇ 다운로드 버튼        → controlsList="nodownload"
 *   · 영상·캔버스 우클릭 메뉴("비디오를 다른 이름으로 저장" / "이미지를 저장")
 *   · 원격 재생(캐스팅) 버튼                        → noremoteplayback
 *
 * 왜 한 곳에 두는가:
 *   영상 요소가 7개 뷰에 흩어져 있고, 통화·함께보기·VR 폴백은 **나중에** 영상을 만들거나
 *   `controls` 를 뒤늦게 붙인다. 뷰마다 속성을 박으면 반드시 빠진 데가 생긴다.
 *   layout 에서 한 번 로드하고, 나중에 생기는 영상까지 MutationObserver 로 따라간다.
 *
 * ⚠ 한계 — 이것은 **UI 차단**이다. 영상 파일 URL(`/content/...`)은 그대로 접근 가능하므로
 *   주소창·개발자도구로는 여전히 내려받을 수 있다. 실제 보호는 **짧은 만료의 서명 URL +
 *   세그먼트(HLS) 전송**이 필요하다 (PROJECT_STATUS §8 잔여 항목).
 *   그러니 "다운로드를 막았다"고 단정하지 말 것 — 쉬운 입구만 닫은 상태다.
 */
(function () {
    'use strict';

    const LIST = 'nodownload noremoteplayback';

    function harden(v) {
        if (!v || v.tagName !== 'VIDEO') return;
        try {
            if (v.dataset.pulseNodl === '1') return;      // 이미 처리됨
            v.dataset.pulseNodl = '1';
            v.setAttribute('controlsList', LIST);         // 속성으로 넣어야 한다 (프로퍼티는 읽기 전용 토큰리스트)
            v.disableRemotePlayback = true;
        } catch (_) {}
    }

    function scan(node) {
        if (!node) return;
        harden(node);
        try {
            if (node.querySelectorAll) node.querySelectorAll('video').forEach(harden);
        } catch (_) {}
    }

    // 우클릭 저장 차단 — 영상·캔버스에만. 문서에서 캡처 단계로 한 번 잡으면
    // 나중에 생기는 요소(통화 영상, VR 캔버스)까지 전부 커버된다.
    document.addEventListener('contextmenu', function (e) {
        const t = e.target;
        if (t && (t.tagName === 'VIDEO' || t.tagName === 'CANVAS')) e.preventDefault();
    }, true);

    function start() {
        scan(document);
        try {
            new MutationObserver(function (muts) {
                for (const m of muts) {
                    if (m.type === 'attributes') { harden(m.target); continue; }
                    if (m.addedNodes) m.addedNodes.forEach(scan);
                }
            }).observe(document.documentElement, {
                childList: true, subtree: true,
                attributes: true, attributeFilter: ['controls'],   // controls 를 나중에 붙이는 경로(VR 폴백)
            });
        } catch (_) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
