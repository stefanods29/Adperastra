"""Check the built conversion child with synthetic in-memory fixtures only."""
import argparse
import hashlib
import json
import struct
import subprocess
import time
import zlib
from pathlib import Path


def frame(kind, body):
    return bytes([kind]) + struct.pack("<I", len(body)) + body


def png_chunk(kind, body):
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))


def png_fixture():
    pixels = b"".join(b"\0" + bytes([255, 0, 0, 128]) * 4 for _ in range(2))
    return b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 2, 8, 6, 0, 0, 0)) + png_chunk(b"IDAT", zlib.compress(pixels)) + png_chunk(b"IEND", b"")


def request(mode, converter, data, accepted=(), name="fixture.png", mime="image/png"):
    return {
        "mode": mode, "converter_id": converter,
        "options": {"kind": "image", "value": {"quality": 90, "width": 2,
            "keep_aspect": True, "allow_upscale": False, "background_rgba": [255,255,255,255],
            "first_frame": False, "metadata_keep": True}},
        "accepted_losses": [], "accepted_warning_codes": list(accepted),
        "max_output_bytes": 4 * 1024 * 1024, "input_index": 0,
        "source": {"kind": "snapshot", "name": name, "mime": mime, "byte_len": len(data)},
    }


def run(binary, message, data, snapshot_kind=9):
    wire = frame(8, json.dumps(message).encode()) + frame(snapshot_kind, data)
    started = time.perf_counter()
    result = subprocess.run([str(binary), "--convert-helper"], input=wire,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20,
        creationflags=subprocess.CREATE_NO_WINDOW)
    frames = []
    offset = 0
    while offset < len(result.stdout):
        assert offset + 5 <= len(result.stdout), "truncated reply header"
        kind = result.stdout[offset]
        length = struct.unpack_from("<I", result.stdout, offset + 1)[0]
        assert 0 < length <= 1024 * 1024, "unbounded reply"
        offset += 5
        assert offset + length <= len(result.stdout), "truncated reply body"
        frames.append((kind, result.stdout[offset:offset + length]))
        offset += length
    assert frames, "child produced no framed reply"
    return result.returncode, frames, round((time.perf_counter() - started) * 1000, 3)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("binary", type=Path)
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    binary = args.binary.resolve(strict=True)
    data = png_fixture()
    checks = []
    for mode in ("preview", "convert"):
        code, frames, elapsed = run(binary, request(mode, "image/png", data), data)
        assert code == 0 and frames[-1][0] == 3
        image = b"".join(body for kind, body in frames if kind == (10 if mode == "preview" else 1))
        assert image.startswith(b"\x89PNG\r\n\x1a\n")
        assert struct.unpack_from(">II", image, 16) == (2, 1)
        if mode == "preview":
            assert not any(kind in (1, 5, 6, 7) for kind, _ in frames)
        else:
            assert [kind for kind, _ in frames if kind != 2] == [5, 1, 6, 3]
            metadata = json.loads(next(body for kind, body in frames if kind == 6))
            assert metadata["hash_sha256"] == hashlib.sha256(image).hexdigest()
            assert metadata["byte_len"] == len(image)
        checks.append({"case": mode + "_resize_snapshot", "passed": True, "elapsed_ms": elapsed})
    code, frames, elapsed = run(binary, request("convert", "image/jpeg", data), data)
    assert code == 0 and frames[-1] == (4, b"convert.warning_required")
    assert not any(kind in (1, 5, 6) for kind, _ in frames)
    checks.append({"case": "jpeg_requires_transparency_acknowledgment", "passed": True, "elapsed_ms": elapsed})
    code, frames, elapsed = run(binary, request("convert", "image/jpeg", data, ["transparency_loss"]), data)
    assert code == 0 and frames[-1][0] == 3
    assert b"".join(body for kind, body in frames if kind == 1).startswith(b"\xff\xd8")
    checks.append({"case": "jpeg_with_explicit_loss_acknowledgment", "passed": True, "elapsed_ms": elapsed})
    code, frames, elapsed = run(binary, request("convert", "image/png", data), data, snapshot_kind=1)
    assert code == 0 and frames[-1][0] == 4
    assert not any(kind in (1, 5, 6) for kind, _ in frames)
    checks.append({"case": "wrong_snapshot_frame_refused", "passed": True, "elapsed_ms": elapsed})
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps({"binary": str(binary), "checks": checks,
        "scope": "Real debug helper; synthetic memory snapshots. No packaged UI or performance acceptance."}, indent=2) + "\n", encoding="utf-8")
    print(str(len(checks)) + " real helper checks passed")


if __name__ == "__main__":
    main()
