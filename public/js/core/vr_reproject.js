/* VR 재투영 렌더러 — 180° SBS 어안(fisheye) VR 영상을 평면(직선) 시점으로 변환
 *
 * 입력: 좌우 분할(SBS) + 등거리 어안. 한쪽 눈만 크롭해 정면 직선투영으로 펴서 캔버스에 그린다.
 * 새 파일 없이, 기존 mp4를 텍스처로 사용. WebGL 미지원/실패 시 ok:false 반환(호출측이 원본 폴백).
 *
 * 사용:
 *   const vr = window.VRReproject.create(videoEl, canvasEl, { hFovDeg:100, fisheyeFovDeg:180, eye:'left' });
 *   if (vr.ok) vr.start();
 */
(function () {
    const VERT = `
        attribute vec2 aPos;
        varying vec2 vUv;
        void main() {
            vUv = aPos * 0.5 + 0.5;        // [0,1]
            gl_Position = vec4(aPos, 0.0, 1.0);
        }`;

    const FRAG = `
        precision highp float;
        uniform sampler2D uTex;
        uniform float uTanH;        // tan(출력 수평 half-FOV)
        uniform float uTanV;        // tan(출력 수직 half-FOV)
        uniform float uFisheyeHalf; // 어안 half-FOV (rad) = 90° → PI/2
        uniform float uEyeScaleX;   // SBS 한 눈 폭 비율 (0.5)
        uniform float uEyeOffX;     // 한 눈 시작 U (왼눈 0.0, 오른눈 0.5)
        uniform float uPitch;       // 상하 시점 (rad, X축 회전)
        uniform float uYaw;         // 좌우 시점 (rad, Y축 회전)
        varying vec2 vUv;
        const float PI = 3.14159265358979;
        void main() {
            vec2 ndc = vUv * 2.0 - 1.0;                 // [-1,1]
            vec3 dir = normalize(vec3(ndc.x * uTanH, ndc.y * uTanV, 1.0));
            // 시점 회전: pitch(상하, X축) → yaw(좌우, Y축)
            float cp = cos(uPitch), sp = sin(uPitch);
            dir = vec3(dir.x, dir.y * cp - dir.z * sp, dir.y * sp + dir.z * cp);
            float cy = cos(uYaw), sy = sin(uYaw);
            dir = normalize(vec3(dir.x * cy + dir.z * sy, dir.y, -dir.x * sy + dir.z * cy));
            float theta = acos(clamp(dir.z, -1.0, 1.0)); // 정면축과의 각
            float r = theta / uFisheyeHalf;              // 등거리 어안 정규화 반경
            if (r > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
            float phi = atan(dir.y, dir.x);
            vec2 eye = vec2(cos(phi), sin(phi)) * r * 0.5 + 0.5;  // 한 눈 내부 [0,1]
            vec2 uv = vec2(eye.x * uEyeScaleX + uEyeOffX, eye.y);
            gl_FragColor = texture2D(uTex, uv);
        }`;

    function compile(gl, type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.warn('VR shader:', gl.getShaderInfoLog(s)); return null;
        }
        return s;
    }

    function create(video, canvas, opts) {
        opts = opts || {};
        const hFovDeg      = opts.hFovDeg || 100;
        const fisheyeFovDeg = opts.fisheyeFovDeg || 180;
        const eye          = opts.eye || 'left';

        let gl;
        try {
            gl = canvas.getContext('webgl', { alpha: false, antialias: true })
              || canvas.getContext('experimental-webgl');
        } catch (_) {}
        if (!gl) return { ok: false };

        const vs = compile(gl, gl.VERTEX_SHADER, VERT);
        const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
        if (!vs || !fs) return { ok: false };
        const prog = gl.createProgram();
        gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return { ok: false };
        gl.useProgram(prog);

        // 풀스크린 쿼드
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
        const aPos = gl.getAttribLocation(prog, 'aPos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        // 텍스처
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

        const uTex        = gl.getUniformLocation(prog, 'uTex');
        const uTanH       = gl.getUniformLocation(prog, 'uTanH');
        const uTanV       = gl.getUniformLocation(prog, 'uTanV');
        const uFisheyeHalf= gl.getUniformLocation(prog, 'uFisheyeHalf');
        const uEyeScaleX  = gl.getUniformLocation(prog, 'uEyeScaleX');
        const uEyeOffX    = gl.getUniformLocation(prog, 'uEyeOffX');
        const uPitch      = gl.getUniformLocation(prog, 'uPitch');
        const uYaw        = gl.getUniformLocation(prog, 'uYaw');

        gl.uniform1i(uTex, 0);
        gl.uniform1f(uEyeScaleX, 0.5);

        // 실시간 조절 가능한 파라미터
        const params = { hFovDeg, fisheyeFovDeg, eye, pitchDeg: opts.pitchDeg || 0, yawDeg: opts.yawDeg || 0 };
        let tanH = Math.tan(hFovDeg * Math.PI / 180 / 2);
        const D2R = Math.PI / 180;
        function applyParams() {
            tanH = Math.tan(params.hFovDeg * D2R / 2);
            gl.uniform1f(uFisheyeHalf, (params.fisheyeFovDeg * D2R) / 2);
            gl.uniform1f(uEyeOffX, params.eye === 'right' ? 0.5 : 0.0);
            gl.uniform1f(uPitch, (params.pitchDeg || 0) * D2R);
            gl.uniform1f(uYaw, (params.yawDeg || 0) * D2R);
        }
        applyParams();

        let raf = null, running = false;

        function resize() {
            const w = canvas.clientWidth || 960;
            const h = canvas.clientHeight || 540;
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
            if (canvas.width !== pw || canvas.height !== ph) {
                canvas.width = pw; canvas.height = ph;
                gl.viewport(0, 0, pw, ph);
            }
            gl.uniform1f(uTanH, tanH);
            gl.uniform1f(uTanV, tanH * (ph / pw));  // 출력 종횡비 반영
        }

        function drawOnce() {
            if (video.readyState < 2) return;
            resize();
            try {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            } catch (_) { /* 일시적 디코드 미준비 */ }
        }
        function frame() {
            if (!running) return;
            drawOnce();
            raf = requestAnimationFrame(frame);
        }

        return {
            ok: true,
            start() { if (!running) { running = true; drawOnce(); frame(); } },
            stop()  { running = false; if (raf) cancelAnimationFrame(raf); },
            resize,
            render: drawOnce,
            getParams() { return Object.assign({}, params); },
            setParams(p) { Object.assign(params, p); applyParams(); drawOnce(); },  // 즉시 1프레임 반영
        };
    }

    window.VRReproject = { create };
})();
