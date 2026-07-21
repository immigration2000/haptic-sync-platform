/* PULSE BJ Session — 무료 체험 → 시간제 결제 → 연장 공통 모듈
 *
 * 사용:
 *   const session = PulseSession.create({
 *       bjUserId, peerName, kind,
 *       onTerminate: () => endCall(false),   // 결제 거절/잔액부족/시간만료 → 통화 종료
 *   });
 *   peer.on('connect', () => session.startFreePreview());
 *   ... endCall 시 session.stop();
 *
 * 시퀀스:
 *   1) 연결 직후 무료 체험 배너 + 카운트다운 (BJ가 정한 free_preview_sec)
 *   2) 0초 → 결제 모달: "N분 이용 / X Ruby / 잔액 …"
 *   3) 결제 → 차감 → N분 세션 타이머 + "남은 시간" 표시
 *   4) 만료 30초 전 → 연장 모달
 *   5) 거절/만료/잔액부족 → onTerminate()
 */
(function () {
    function fmt(sec) {
        sec = Math.max(0, Math.floor(sec));
        return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
    }

    function create(opts) {
        const { bjUserId, peerName, kind, onTerminate } = opts;
        let info = null;            // 세션 요금 정보
        let phase = 'idle';         // idle | preview | paid | modal
        let remain = 0;             // 남은 초
        let tickTimer = null;
        let extendPrompted = false;

        // ─── UI 요소 (오버레이) ────────────────────────────
        const wrap = document.createElement('div');
        wrap.className = 'ps-wrap';
        wrap.innerHTML = `
            <div class="ps-banner" id="ps-banner" hidden>
                <span class="ps-banner-dot"></span>
                <span id="ps-banner-text">무료 체험</span>
                <span class="ps-banner-time" id="ps-banner-time">00:00</span>
            </div>
            <div class="ps-modal-backdrop" id="ps-modal" hidden>
                <div class="ps-modal">
                    <div class="ps-modal-tag" id="ps-modal-tag">결제 안내</div>
                    <h3 class="ps-modal-title" id="ps-modal-title">통화를 계속하시겠어요?</h3>
                    <div class="ps-modal-bj" id="ps-modal-bj">—</div>
                    <div class="ps-modal-pricebox">
                        <div class="ps-pricerow"><span>이용 시간</span><strong id="ps-modal-min">— 분</strong></div>
                        <div class="ps-pricerow"><span>분당 요금</span><strong id="ps-modal-rate">— Ruby</strong></div>
                        <div class="ps-pricerow ps-total"><span>결제 금액</span><strong id="ps-modal-cost">— Ruby</strong></div>
                        <div class="ps-pricerow ps-balance"><span>현재 잔액</span><strong id="ps-modal-balance">— Ruby</strong></div>
                    </div>
                    <div class="ps-modal-msg" id="ps-modal-msg"></div>
                    <div class="ps-modal-actions">
                        <button class="ps-btn-pay" id="ps-btn-pay">결제하고 계속</button>
                        <button class="ps-btn-cancel" id="ps-btn-cancel">종료하고 다른 BJ 찾기</button>
                    </div>
                    <a class="ps-charge-link" id="ps-charge-link" href="/mypage/billing" target="_blank" hidden>＋ Ruby 충전하러 가기</a>
                </div>
            </div>
        `;
        document.body.appendChild(wrap);

        const $ = (id) => wrap.querySelector('#' + id);
        const banner   = $('ps-banner');
        const bannerTx = $('ps-banner-text');
        const bannerTm = $('ps-banner-time');
        const modal    = $('ps-modal');
        const modalTag = $('ps-modal-tag');
        const modalTitle = $('ps-modal-title');
        const modalBj  = $('ps-modal-bj');
        const elMin    = $('ps-modal-min');
        const elRate   = $('ps-modal-rate');
        const elCost   = $('ps-modal-cost');
        const elBal    = $('ps-modal-balance');
        const elMsg    = $('ps-modal-msg');
        const btnPay   = $('ps-btn-pay');
        const btnCancel= $('ps-btn-cancel');
        const chargeLink = $('ps-charge-link');

        function showModal(isExtend) {
            phase = 'modal';
            modalTag.textContent = isExtend ? '시간 연장' : '결제 안내';
            modalTitle.textContent = isExtend ? '시간이 거의 끝났어요. 연장할까요?' : '무료 체험 종료 — 계속하시겠어요?';
            modalBj.textContent = info.stageName;
            elMin.textContent  = info.blockMin + ' 분';
            elRate.textContent = info.ratePerMin.toLocaleString() + ' Ruby';
            elCost.textContent = info.cost.toLocaleString() + ' Ruby';
            elBal.textContent  = info.balance.toLocaleString() + ' Ruby';
            const lack = info.balance < info.cost;
            elMsg.textContent = lack ? '⚠ 잔액이 부족합니다. 충전 후 다시 시도해주세요.' : '';
            elMsg.style.display = lack ? 'block' : 'none';
            btnPay.disabled = lack;
            chargeLink.hidden = !lack;
            modal.hidden = false;
        }
        function hideModal() { modal.hidden = true; }

        async function fetchInfo() {
            const r = await fetch('/bj/session/info/' + bjUserId);
            info = await r.json();
            return info;
        }

        function startBlock() {
            phase = 'paid';
            extendPrompted = false;
            remain = info.blockMin * 60;
            banner.hidden = false;
            banner.classList.add('ps-paid');
            bannerTx.textContent = '이용 중';
            runTick();
        }

        function startFreePreview() {
            fetchInfo().then(() => {
                if (!info || !info.ok) { onTerminate && onTerminate(); return; }
                phase = 'preview';
                remain = info.freePreviewSec;
                banner.hidden = false;
                banner.classList.remove('ps-paid');
                bannerTx.textContent = '무료 체험';
                runTick();
            });
        }

        function runTick() {
            if (tickTimer) clearInterval(tickTimer);
            bannerTm.textContent = fmt(remain);
            tickTimer = setInterval(() => {
                remain--;
                bannerTm.textContent = fmt(remain);

                if (phase === 'paid' && !extendPrompted && remain <= 30 && remain > 0) {
                    extendPrompted = true;
                    fetchInfo().then(() => showModal(true)); // 잔액 갱신 후 연장 모달
                }
                if (remain <= 0) {
                    clearInterval(tickTimer);
                    if (phase === 'preview') {
                        fetchInfo().then(() => showModal(false)); // 무료 끝 → 결제 모달
                    } else if (phase === 'paid') {
                        // 연장 안 했으면 종료
                        if (modal.hidden) { onTerminate && onTerminate(); }
                    }
                }
            }, 1000);
        }

        btnPay.addEventListener('click', async () => {
            btnPay.disabled = true;
            try {
                const r = await fetch('/bj/session/charge', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-csrf-token': (document.querySelector('meta[name=csrf-token]') || {}).content || '',
                    },
                    body: JSON.stringify({ bjUserId, kind: kind || 'call' }),
                });
                const d = await r.json();
                if (!d.ok) {
                    if (d.reason === 'INSUFFICIENT') {
                        info.balance = d.balance;
                        elMsg.textContent = `⚠ 잔액 부족 (필요 ${d.needed.toLocaleString()}, 보유 ${d.balance.toLocaleString()})`;
                        elMsg.style.display = 'block';
                        chargeLink.hidden = false;
                        btnPay.disabled = true;
                        return;
                    }
                    elMsg.textContent = '결제 실패. 다시 시도해주세요.';
                    elMsg.style.display = 'block';
                    btnPay.disabled = false;
                    return;
                }
                info.balance = d.balance;
                hideModal();
                startBlock();
            } catch (e) {
                elMsg.textContent = '네트워크 오류.';
                elMsg.style.display = 'block';
                btnPay.disabled = false;
            }
        });

        btnCancel.addEventListener('click', () => {
            hideModal();
            stop();
            onTerminate && onTerminate();
        });

        function stop() {
            if (tickTimer) clearInterval(tickTimer);
            banner.hidden = true;
            modal.hidden = true;
        }
        function destroy() {
            stop();
            try { wrap.remove(); } catch (_) {}
        }

        return { startFreePreview, stop, destroy };
    }

    window.PulseSession = { create };
})();
