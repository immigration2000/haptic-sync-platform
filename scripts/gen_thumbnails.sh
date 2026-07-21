#!/bin/bash
# 영상에서 10% 시점 프레임 추출 → 480x270 jpg 썸네일
ROOT="D:/Leeminsoo/Project/Website/IWeb/IRealverse-main/pulse/public/content"
THUMB="$ROOT/thumbnails"
mkdir -p "$THUMB"

# 영상 duration의 약 10% 또는 30초 중 작은 값을 사용
gen() {
    local src="$1"; local dst="$2"
    [ ! -f "$src" ] && { echo "[skip] $src"; return; }
    [ -f "$dst" ] && { echo "[exists] $dst"; return; }
    # ffprobe로 duration 가져와서 10% 시점
    local dur
    dur=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$src" 2>/dev/null | head -1)
    local seek=30
    if [ -n "$dur" ]; then
        seek=$(echo "$dur * 0.1" | awk '{printf "%.0f", $1}')
        [ "$seek" -gt 60 ] && seek=60
        [ "$seek" -lt 2 ] && seek=2
    fi
    ffmpeg -y -ss "$seek" -i "$src" -vframes 1 -vf "scale=480:-2:flags=lanczos" -q:v 4 "$dst" 2>/dev/null
    echo "[done] $(basename $dst) @ ${seek}s"
}

# VOD 1~10
for i in 1 2 3 4 5 6 7 8 9 10; do
    gen "$ROOT/vods/vod$i.mp4" "$THUMB/vod$i.jpg"
done

# VR 5종 (4K 압축본은 2560x1280이라 그대로 추출 후 480px로 scale)
for i in 001 002 003 004 005; do
    gen "$ROOT/vrs/vr_technician_$i.mp4" "$THUMB/vr_technician_$i.jpg"
done

echo
echo "=== 생성된 썸네일 ==="
ls -lh "$THUMB" | grep -v total
