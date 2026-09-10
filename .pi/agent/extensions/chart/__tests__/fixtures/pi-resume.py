"""Exercise installed Pi's interactive saved-session startup and /reload, without an LLM."""
import datetime
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import struct
import subprocess
import sys
import tempfile
import termios
import time
import uuid

with tempfile.TemporaryDirectory(prefix="chart-pi-resume-") as temporary:
    directory = Path(temporary)
    session = directory / "saved.jsonl"
    report = directory / "report.jsonl"
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    entries = [{"type": "session", "version": 3, "id": str(uuid.uuid4()),
                "timestamp": timestamp, "cwd": temporary}]
    parent = None

    def append(message):
        global parent
        entry_id = f"{len(entries):08x}"
        entries.append({"type": "message", "id": entry_id, "parentId": parent,
                        "timestamp": timestamp, "message": {**message, "timestamp": 1}})
        parent = entry_id

    # Persist bins, not freshly executed tools. Fractional edges match the reported saved shape.
    details = {"type": "histogram", "rows": [
        {"lower": 42, "upper": 59.33333333333333, "count": 7},
        {"lower": 59.33333333333333, "upper": 76.66666666666666, "count": 14},
        {"lower": 76.66666666666666, "upper": 94, "count": 3},
        {"lower": 94, "upper": 111.33333333333333, "count": 2},
        {"lower": 111.33333333333333, "upper": 128.66666666666669, "count": 1},
        {"lower": 128.66666666666669, "upper": 146, "count": 1}],
        "title": "Saved histogram", "xLabel": "Value", "yLabel": "Count",
        "imageWidthCells": 80, "fontFamily": "JetBrainsMono NF", "fontSize": 14}
    usage = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0,
             "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}}
    for index in range(32):
        append({"role": "user", "content": "Show a histogram"})
        append({"role": "assistant", "api": "openai-responses", "provider": "openai",
                "model": "gpt-4o", "usage": usage, "stopReason": "toolUse",
                "content": [{"type": "toolCall", "id": f"chart-{index}",
                             "name": "chart_histogram", "arguments": {"data": [42, 146]}}]})
        append({"role": "toolResult", "toolCallId": f"chart-{index}",
                "toolName": "chart_histogram", "content": [{"type": "text", "text": "Saved histogram"}],
                "details": details, "isError": False})
    session.write_text("\n".join(json.dumps(entry) for entry in entries) + "\n")
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 60, 110, 1760, 2280))
    child = subprocess.Popen([
        sys.argv[1], "--offline", "--no-extensions", "--no-skills", "--no-context-files",
        "--no-prompt-templates", "--no-themes", "--session", str(session),
        "-e", str(Path(__file__).with_suffix(".ts")),
    ], cwd=temporary, env={**os.environ, "TERM": "xterm-kitty",
        # Pi migrates JSONL files directly inside its agent directory; keep the fixture outside it.
        "PI_CODING_AGENT_DIR": str(directory / "agent"), "PI_CHART_RESUME_REPORT": str(report)},
        stdin=slave, stdout=slave, stderr=slave)
    os.close(slave)
    reloaded = False
    deadline = time.monotonic() + 70
    try:
        while time.monotonic() < deadline:
            assert child.poll() is None, "Pi exited before restored charts rendered"
            if select.select([master], [], [], 0.05)[0]:
                os.read(master, 65536)
            events = [json.loads(line) for line in report.read_text().splitlines()] if report.exists() else []
            assert not any(event["status"] == "unavailable" for event in events), "Histogram unavailable on session replay"
            reason = "reload" if reloaded else "startup"
            images = sum(event == {"reason": reason, "status": "image"} for event in events)
            if images == 32:
                print(f"CHART_RESUME_OK {reason} {images}", flush=True)
                if reloaded:
                    break
                os.write(master, b"/reload\r")
                reloaded = True
        else:
            raise AssertionError(f"Saved charts did not finish: {reason}, {images}/32")
    finally:
        child.kill()
        child.wait(timeout=5)
        os.close(master)
