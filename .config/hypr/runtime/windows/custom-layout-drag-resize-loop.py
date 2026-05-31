#!/usr/bin/env python3
import json
import os
import socket
import sys
import time


def socket_path():
    runtime_dir = os.environ.get("XDG_RUNTIME_DIR")
    signature = os.environ.get("HYPRLAND_INSTANCE_SIGNATURE")
    if not runtime_dir or not signature:
        raise RuntimeError("missing Hyprland socket environment")
    return f"{runtime_dir}/hypr/{signature}/.socket.sock"


def request(path, message):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.connect(path)
        sock.sendall(message.encode())
        chunks = []
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            chunks.append(chunk)
    return b"".join(chunks).decode(errors="replace")


def cursor_axis(path, axis):
    response = request(path, "j/cursorpos")
    return int(json.loads(response)[axis])


def dispatch(path, command, edge, position):
    request(path, f'dispatch hl.dsp.layout("{command} {edge} {position}")')


def main(argv):
    if len(argv) != 9:
        print(
            "usage: custom-layout-drag-resize-loop.py axis command edge initial sleep numerator denominator state_file pid_file",
            file=sys.stderr,
        )
        return 2

    axis = argv[0]
    command = argv[1]
    edge = argv[2]
    initial = int(argv[3])
    sleep_interval = float(argv[4])
    numerator = int(argv[5])
    denominator = int(argv[6])
    state_file = argv[7]
    pid_file = argv[8]
    path = socket_path()
    last_scaled = None

    try:
        for _ in range(1200):
            if not os.path.exists(state_file):
                break

            try:
                current = cursor_axis(path, axis)
            except Exception:
                time.sleep(sleep_interval)
                continue

            scaled = initial + (current - initial) * numerator // denominator
            if scaled != last_scaled:
                try:
                    dispatch(path, command, edge, scaled)
                    last_scaled = scaled
                except Exception:
                    pass

            time.sleep(sleep_interval)
    finally:
        for file_path in (state_file, pid_file):
            try:
                os.unlink(file_path)
            except FileNotFoundError:
                pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
