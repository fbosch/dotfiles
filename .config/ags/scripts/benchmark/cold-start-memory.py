#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import signal
import statistics
import subprocess
import sys
import tempfile
import time
import uuid
import xml.etree.ElementTree as ET
from contextlib import ExitStack
from datetime import datetime, timezone
from pathlib import Path


SAMPLE_COUNT = 5
SAMPLE_INTERVAL_SECONDS = 0.5
MIN_SETTLE_SECONDS = 2.0
DEFAULT_SETTLE_TIMEOUT_SECONDS = 15.0
MIN_PSS_RANGE_KB = 1024
MAX_PSS_RANGE_RATIO = 0.01
MIN_VALID_RUNS = 5
MAX_PSS_MAD_RATIO = 0.03
MAX_ATTEMPTS_PER_RUN = 5


class TerminationRequested(RuntimeError):
    pass


def parse_args():
    parser = argparse.ArgumentParser(
        description="Measure isolated fresh-process AGS startup memory",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    measure = commands.add_parser("measure")
    measure.add_argument("--source", type=Path, required=True)
    measure.add_argument("--label", required=True)
    measure.add_argument("--runs", type=int, default=7)
    measure.add_argument("--output", type=Path, required=True)
    measure.add_argument(
        "--settle-timeout",
        type=float,
        default=DEFAULT_SETTLE_TIMEOUT_SECONDS,
    )

    pair = commands.add_parser("measure-pair")
    pair.add_argument("--baseline-source", type=Path, required=True)
    pair.add_argument("--candidate-source", type=Path, required=True)
    pair.add_argument("--runs", type=int, default=7)
    pair.add_argument("--output", type=Path, required=True)
    pair.add_argument(
        "--settle-timeout",
        type=float,
        default=DEFAULT_SETTLE_TIMEOUT_SECONDS,
    )

    compare = commands.add_parser("compare")
    compare.add_argument("baseline", type=Path)
    compare.add_argument("candidate", type=Path, nargs="?")
    compare.add_argument("--output", type=Path)
    return parser.parse_args()


def require_command(name):
    command = shutil.which(name)
    if command is None:
        raise RuntimeError(f"Required command is unavailable: {name}")
    return command


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def command_output(argv):
    try:
        result = subprocess.run(
            argv,
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None


def measurement_environment(commands):
    monitor_layout = command_output(["hyprctl", "monitors", "-j"])
    return {
        "hostname": platform.node(),
        "kernel": platform.release(),
        "machine": platform.machine(),
        "ags_version": command_output([commands["ags"], "--version"]),
        "ags_path": str(Path(commands["ags"]).resolve()),
        "runtime_path": str(Path(commands["runtime"]).resolve()),
        "runtime_sha256": sha256_file(Path(commands["runtime"]).resolve()),
        "nvidia_driver": command_output(
            [
                commands["nvidia_smi"],
                "--query-gpu=driver_version",
                "--format=csv,noheader",
            ]
        )
        if commands["nvidia_smi"]
        else None,
        "wayland_display": os.environ.get("WAYLAND_DISPLAY"),
        "hyprland_instance": os.environ.get("HYPRLAND_INSTANCE_SIGNATURE"),
        "monitor_layout_sha256": hashlib.sha256(
            monitor_layout.encode(),
        ).hexdigest()
        if monitor_layout
        else None,
    }


def process_stat(pid):
    stat = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8")
    fields = stat[stat.rfind(")") + 2 :].split()
    return {
        "identity": f"{pid}:{fields[19]}",
        "cpu_ticks": int(fields[11]) + int(fields[12]),
    }


def process_identity(pid):
    try:
        return process_stat(pid)["identity"]
    except (FileNotFoundError, IndexError, ValueError):
        return None


def read_kb_field(path, field):
    try:
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                if line.startswith(f"{field}:"):
                    return int(line.split()[1])
    except (FileNotFoundError, PermissionError, ValueError):
        return None
    return None


def read_process_memory(pid, identity, clock_ticks):
    stat = process_stat(pid)
    if stat["identity"] != identity:
        raise RuntimeError(f"Process identity changed for PID {pid}")
    pss_kb = read_kb_field(Path(f"/proc/{pid}/smaps_rollup"), "Pss")
    rss_kb = read_kb_field(Path(f"/proc/{pid}/status"), "VmRSS")
    if pss_kb is None or rss_kb is None:
        raise RuntimeError(f"Memory sample unavailable for PID {pid}")
    return {
        "pid": pid,
        "identity": identity,
        "pss_kb": pss_kb,
        "rss_kb": rss_kb,
        "cpu_ms": round(stat["cpu_ticks"] * 1000 / clock_ticks),
    }


def direct_gjs_child(launcher_pid):
    children_path = Path(
        f"/proc/{launcher_pid}/task/{launcher_pid}/children",
    )
    try:
        children = [int(value) for value in children_path.read_text().split()]
    except (FileNotFoundError, ValueError):
        return None
    gjs_children = []
    for pid in children:
        try:
            if Path(f"/proc/{pid}/comm").read_text().strip() == "gjs":
                gjs_children.append(pid)
        except FileNotFoundError:
            continue
    if len(gjs_children) == 1:
        return gjs_children[0]
    if len(gjs_children) > 1:
        raise RuntimeError(
            f"Expected one GJS child for launcher {launcher_pid}, found {gjs_children}",
        )
    return None


def wait_for_gjs_child(launcher_pid, timeout_seconds=5.0):
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        child = direct_gjs_child(launcher_pid)
        if child is not None:
            return child
        time.sleep(0.05)
    raise RuntimeError(f"GJS child did not appear for launcher {launcher_pid}")


def nvidia_vram_mib(pid, nvidia_smi):
    if nvidia_smi is None:
        return None
    try:
        result = subprocess.run(
            [nvidia_smi, "-q", "-x"],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
        root = ET.fromstring(result.stdout)
    except (subprocess.SubprocessError, ET.ParseError):
        return None
    for process in root.findall(".//process_info"):
        if process.findtext("pid") != str(pid):
            continue
        used_memory = process.findtext("used_memory", "")
        match = re.search(r"(\d+)\s+MiB", used_memory)
        return int(match.group(1)) if match else None
    return None


def wait_for_ready(ags, instance_name, launcher, timeout_seconds=10.0):
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if launcher.poll() is not None:
            raise RuntimeError(
                f"Benchmark launcher exited with status {launcher.returncode}",
            )
        request = subprocess.run(
            [ags, "request", "-i", instance_name, ""],
            capture_output=True,
            text=True,
            timeout=1,
        )
        if request.returncode == 0:
            return
        time.sleep(0.1)
    raise RuntimeError(f"AGS instance did not become ready: {instance_name}")


def capture_sample(
    launcher_pid,
    launcher_identity,
    gjs_pid,
    gjs_identity,
    clock_ticks,
    nvidia_smi,
):
    launcher = read_process_memory(launcher_pid, launcher_identity, clock_ticks)
    gjs = read_process_memory(gjs_pid, gjs_identity, clock_ticks)
    gjs["nvidia_vram_mib"] = nvidia_vram_mib(gjs_pid, nvidia_smi)
    return {
        "launcher": launcher,
        "gjs": gjs,
        "combined": {
            "pss_kb": launcher["pss_kb"] + gjs["pss_kb"],
            "rss_kb": launcher["rss_kb"] + gjs["rss_kb"],
            "cpu_ms": launcher["cpu_ms"] + gjs["cpu_ms"],
        },
    }


def is_settled(samples):
    if len(samples) < SAMPLE_COUNT:
        return False
    pss_values = [sample["combined"]["pss_kb"] for sample in samples]
    allowed_range = max(
        MIN_PSS_RANGE_KB,
        round(statistics.median(pss_values) * MAX_PSS_RANGE_RATIO),
    )
    return max(pss_values) - min(pss_values) <= allowed_range


def median_value(samples, *path):
    values = []
    for sample in samples:
        value = sample
        for key in path:
            value = value[key]
        if value is not None:
            values.append(value)
    return round(statistics.median(values)) if values else None


def summarize_samples(samples):
    return {
        "launcher": {
            "pid": samples[-1]["launcher"]["pid"],
            "identity": samples[-1]["launcher"]["identity"],
            "pss_kb": median_value(samples, "launcher", "pss_kb"),
            "rss_kb": median_value(samples, "launcher", "rss_kb"),
            "cpu_ms": median_value(samples, "launcher", "cpu_ms"),
        },
        "gjs": {
            "pid": samples[-1]["gjs"]["pid"],
            "identity": samples[-1]["gjs"]["identity"],
            "pss_kb": median_value(samples, "gjs", "pss_kb"),
            "rss_kb": median_value(samples, "gjs", "rss_kb"),
            "cpu_ms": median_value(samples, "gjs", "cpu_ms"),
            "nvidia_vram_mib": median_value(
                samples,
                "gjs",
                "nvidia_vram_mib",
            ),
        },
        "combined": {
            "pss_kb": median_value(samples, "combined", "pss_kb"),
            "rss_kb": median_value(samples, "combined", "rss_kb"),
            "cpu_ms": median_value(samples, "combined", "cpu_ms"),
        },
    }


def stop_owned_process(
    ags,
    instance_name,
    launcher,
    launcher_identity,
    gjs_pid,
    gjs_identity,
):
    def is_owned(pid, identity):
        return identity is not None and process_identity(pid) == identity

    def launcher_is_alive():
        if launcher.poll() is not None:
            return False
        return launcher_identity is None or is_owned(launcher.pid, launcher_identity)

    try:
        subprocess.run(
            [ags, "quit", "-i", instance_name],
            capture_output=True,
            timeout=2,
        )
    except (OSError, subprocess.SubprocessError):
        pass

    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        if (
            launcher_is_alive() is False
            and is_owned(gjs_pid, gjs_identity) is False
        ):
            return
        time.sleep(0.05)

    launcher_owned = launcher_is_alive()
    gjs_owned = is_owned(gjs_pid, gjs_identity)
    if launcher_owned is False and gjs_owned is False:
        return
    try:
        os.killpg(launcher.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass

    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if (
            launcher_is_alive() is False
            and is_owned(gjs_pid, gjs_identity) is False
        ):
            return
        time.sleep(0.05)

    if (
        launcher_is_alive()
        or is_owned(gjs_pid, gjs_identity)
    ):
        try:
            os.killpg(launcher.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        launcher.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass


def measure_run(
    source,
    label,
    run_number,
    settle_timeout_seconds,
    commands,
    bundle_path,
    instance_name,
    log_path,
):
    safe_label = re.sub(r"[^a-zA-Z0-9-]", "-", label)
    if safe_label == "":
        raise RuntimeError("Measurement label must contain a letter or number")
    start = time.monotonic()
    launcher = None
    launcher_identity = None
    gjs_pid = -1
    gjs_identity = None
    termination_signals = {signal.SIGTERM, signal.SIGHUP}
    previous_signal_mask = signal.pthread_sigmask(
        signal.SIG_BLOCK,
        termination_signals,
    )
    signal_mask_restored = False
    try:
        with log_path.open("w", encoding="utf-8") as log:
            launcher = subprocess.Popen(
                [commands["runtime"], str(bundle_path)],
                cwd=source,
                env={**os.environ, "AGS_MEMORY_BENCHMARK_INSTANCE": instance_name},
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        signal_mask_restored = True
        signal.pthread_sigmask(signal.SIG_SETMASK, previous_signal_mask)
        launcher_identity = process_identity(launcher.pid)
        if launcher_identity is None:
            raise RuntimeError("Failed to capture benchmark launcher identity")
        gjs_pid = wait_for_gjs_child(launcher.pid)
        gjs_identity = process_identity(gjs_pid)
        if gjs_identity is None:
            raise RuntimeError("Failed to capture benchmark GJS identity")
        wait_for_ready(commands["ags"], instance_name, launcher)
        ready_at = time.monotonic()
        samples = []
        deadline = ready_at + settle_timeout_seconds
        while time.monotonic() < deadline:
            if time.monotonic() - ready_at < MIN_SETTLE_SECONDS:
                time.sleep(SAMPLE_INTERVAL_SECONDS)
                continue
            samples.append(
                capture_sample(
                    launcher.pid,
                    launcher_identity,
                    gjs_pid,
                    gjs_identity,
                    commands["clock_ticks"],
                    commands["nvidia_smi"],
                )
            )
            samples = samples[-SAMPLE_COUNT:]
            if is_settled(samples):
                break
            time.sleep(SAMPLE_INTERVAL_SECONDS)
        settled = is_settled(samples)
        if not samples:
            raise RuntimeError("No valid memory samples were captured")
        pss_values = [sample["combined"]["pss_kb"] for sample in samples]
        result = summarize_samples(samples)
        result.update(
            {
                "label": label,
                "run": run_number,
                "ready_ms": round((ready_at - start) * 1000),
                "settled_ms": round((time.monotonic() - start) * 1000),
                "settled": settled,
                "pss_window_range_kb": max(pss_values) - min(pss_values),
            }
        )
        return result
    except Exception as error:
        try:
            log_contents = log_path.read_text(encoding="utf-8")
        except FileNotFoundError:
            log_contents = ""
        if log_contents:
            print(log_contents, file=sys.stderr)
        raise error
    finally:
        if signal_mask_restored is False:
            signal.pthread_sigmask(signal.SIG_SETMASK, previous_signal_mask)
        if launcher is not None:
            stop_owned_process(
                commands["ags"],
                instance_name,
                launcher,
                launcher_identity,
                gjs_pid,
                gjs_identity,
            )


def validate_measurement(source, runs, settle_timeout):
    if not (source / "config-bundled.tsx").is_file():
        raise RuntimeError(f"Not an AGS source directory: {source}")
    if runs < 1:
        raise RuntimeError("--runs must be at least 1")
    if settle_timeout <= MIN_SETTLE_SECONDS:
        raise RuntimeError(
            f"--settle-timeout must exceed {MIN_SETTLE_SECONDS} seconds",
        )


def measurement_commands():
    return {
        "ags": require_command("ags"),
        "runtime": require_command("ags-bundle-runtime"),
        "nvidia_smi": shutil.which("nvidia-smi"),
        "clock_ticks": os.sysconf("SC_CLK_TCK"),
    }


def measurement_settings(runs, settle_timeout):
    return {
        "runs": runs,
        "sample_count": SAMPLE_COUNT,
        "sample_interval_seconds": SAMPLE_INTERVAL_SECONDS,
        "minimum_settle_seconds": MIN_SETTLE_SECONDS,
        "settle_timeout_seconds": settle_timeout,
        "minimum_pss_range_kb": MIN_PSS_RANGE_KB,
        "max_pss_range_ratio": MAX_PSS_RANGE_RATIO,
        "max_attempts_per_run": MAX_ATTEMPTS_PER_RUN,
    }


def prepare_dataset(source, label, runs, settle_timeout, commands, directory):
    safe_label = re.sub(r"[^a-zA-Z0-9-]", "-", label)
    bundle_path = directory / f"{safe_label}-bundle"
    subprocess.run(
        [
            commands["ags"],
            "bundle",
            "--gtk",
            "4",
            "config-bundled.tsx",
            str(bundle_path),
        ],
        cwd=source,
        check=True,
        timeout=60,
    )
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": str(source),
        "label": label,
        "settings": measurement_settings(runs, settle_timeout),
        "provenance": {
            "bundle_sha256": sha256_file(bundle_path),
            "benchmark_sha256": sha256_file(Path(__file__).resolve()),
            "environment": measurement_environment(commands),
        },
        "runs": [],
        "_bundle_path": bundle_path,
        "_instance_prefix": f"ags-memory-{safe_label}",
    }


def append_measurement(dataset, run_number, settle_timeout, commands, directory):
    last_error = None
    for attempt in range(1, MAX_ATTEMPTS_PER_RUN + 1):
        instance_name = (
            f"{dataset['_instance_prefix']}-{run_number}-{uuid.uuid4().hex[:8]}"
        )
        try:
            run = measure_run(
                Path(dataset["source"]),
                dataset["label"],
                run_number,
                settle_timeout,
                commands,
                dataset["_bundle_path"],
                instance_name,
                directory / f"{dataset['label']}-{run_number}-{attempt}.log",
            )
            if run["settled"] is False:
                raise RuntimeError("memory did not settle before the timeout")
            run["attempt"] = attempt
            break
        except TerminationRequested:
            raise
        except (OSError, RuntimeError, subprocess.SubprocessError) as error:
            last_error = error
            print(
                f"{dataset['label']} run {run_number} attempt {attempt} "
                f"was interrupted: {error}",
                file=sys.stderr,
            )
    else:
        raise RuntimeError(
            f"{dataset['label']} run {run_number} failed after "
            f"{MAX_ATTEMPTS_PER_RUN} attempts: {last_error}",
        )
    dataset["runs"].append(run)
    print(
        f"{dataset['label']} run {run_number}: "
        f"PSS={run['combined']['pss_kb'] / 1024:.1f} MiB "
        f"RSS={run['combined']['rss_kb'] / 1024:.1f} MiB "
        f"VRAM={run['gjs']['nvidia_vram_mib']} MiB "
        f"settled={run['settled']}",
    )


def serializable_dataset(dataset):
    return {key: value for key, value in dataset.items() if not key.startswith("_")}


def runtime_root():
    root = Path(os.environ.get("XDG_RUNTIME_DIR", "/tmp")) / "ags-memory"
    root.mkdir(parents=True, exist_ok=True)
    return root


def measure(args):
    source = args.source.resolve()
    validate_measurement(source, args.runs, args.settle_timeout)
    commands = measurement_commands()
    with tempfile.TemporaryDirectory(
        prefix=f"{args.label}-",
        dir=runtime_root(),
    ) as temp_directory:
        directory = Path(temp_directory)
        dataset = prepare_dataset(
            source,
            args.label,
            args.runs,
            args.settle_timeout,
            commands,
            directory,
        )
        for run_number in range(1, args.runs + 1):
            append_measurement(
                dataset,
                run_number,
                args.settle_timeout,
                commands,
                directory,
            )
        result = serializable_dataset(dataset)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Measurements written to {args.output}")


def measure_pair(args):
    baseline_source = args.baseline_source.resolve()
    candidate_source = args.candidate_source.resolve()
    validate_measurement(baseline_source, args.runs, args.settle_timeout)
    validate_measurement(candidate_source, args.runs, args.settle_timeout)
    commands = measurement_commands()
    comparison_id = uuid.uuid4().hex
    with ExitStack() as stack:
        temp_directory = stack.enter_context(
            tempfile.TemporaryDirectory(prefix="pair-", dir=runtime_root()),
        )
        directory = Path(temp_directory)
        baseline = prepare_dataset(
            baseline_source,
            "baseline",
            args.runs,
            args.settle_timeout,
            commands,
            directory,
        )
        candidate = prepare_dataset(
            candidate_source,
            "candidate",
            args.runs,
            args.settle_timeout,
            commands,
            directory,
        )
        order = []
        for run_number in range(1, args.runs + 1):
            datasets = [baseline, candidate]
            if run_number % 2 == 0:
                datasets.reverse()
            for dataset in datasets:
                append_measurement(
                    dataset,
                    run_number,
                    args.settle_timeout,
                    commands,
                    directory,
                )
                order.append({"label": dataset["label"], "run": run_number})
        result = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "comparison_id": comparison_id,
            "order": order,
            "baseline": serializable_dataset(baseline),
            "candidate": serializable_dataset(candidate),
        }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Paired measurements written to {args.output}")


def median_absolute_deviation(values):
    median = statistics.median(values)
    return statistics.median(abs(value - median) for value in values)


def metric_summary(runs, *path):
    values = []
    for run in runs:
        value = run
        for key in path:
            value = value[key]
        if value is not None:
            values.append(value)
    if not values:
        return {"median": None, "min": None, "max": None, "mad": None}
    return {
        "median": round(statistics.median(values), 2),
        "min": min(values),
        "max": max(values),
        "mad": round(median_absolute_deviation(values), 2),
    }


def delta_summary(baseline, candidate):
    if baseline["median"] is None or candidate["median"] is None:
        return {"absolute": None, "percent": None}
    delta = candidate["median"] - baseline["median"]
    percent = delta / baseline["median"] * 100 if baseline["median"] else 0
    return {"absolute": round(delta, 2), "percent": round(percent, 2)}


def paired_delta_interval(baseline_runs, candidate_runs, *path):
    baseline_by_run = {run["run"]: run for run in baseline_runs}
    candidate_by_run = {run["run"]: run for run in candidate_runs}
    deltas = []
    for run_number in sorted(baseline_by_run.keys() & candidate_by_run.keys()):
        baseline = baseline_by_run[run_number]
        candidate = candidate_by_run[run_number]
        for key in path:
            baseline = baseline[key]
            candidate = candidate[key]
        if baseline is not None and candidate is not None:
            deltas.append(candidate - baseline)
    if len(deltas) < 2:
        return {"count": len(deltas), "mean": None, "lower_95": None, "upper_95": None}
    critical_by_degrees_of_freedom = {
        1: 12.706,
        2: 4.303,
        3: 3.182,
        4: 2.776,
        5: 2.571,
        6: 2.447,
        7: 2.365,
        8: 2.306,
        9: 2.262,
    }
    degrees_of_freedom = len(deltas) - 1
    critical = critical_by_degrees_of_freedom.get(degrees_of_freedom, 1.96)
    mean = statistics.mean(deltas)
    margin = critical * statistics.stdev(deltas) / len(deltas) ** 0.5
    return {
        "count": len(deltas),
        "mean": round(mean, 2),
        "lower_95": round(mean - margin, 2),
        "upper_95": round(mean + margin, 2),
    }


def classify_pss(delta, paired_interval):
    absolute_kb = delta["absolute"]
    percent = delta["percent"]
    lower = paired_interval["lower_95"]
    upper = paired_interval["upper_95"]
    if absolute_kb is None or percent is None or lower is None or upper is None:
        return "inconclusive"
    if absolute_kb <= -5120 and percent <= -5 and upper <= -5120:
        return "improvement"
    if absolute_kb >= 5120 and percent >= 5 and lower >= 5120:
        return "regression"
    return "inconclusive"


def compare(args):
    baseline_input = json.loads(args.baseline.read_text(encoding="utf-8"))
    paired = args.candidate is None
    if paired:
        baseline_data = baseline_input["baseline"]
        candidate_data = baseline_input["candidate"]
    else:
        baseline_data = baseline_input
        candidate_data = json.loads(args.candidate.read_text(encoding="utf-8"))
    baseline_runs = [run for run in baseline_data["runs"] if run["settled"]]
    candidate_runs = [run for run in candidate_data["runs"] if run["settled"]]
    quality_issues = []
    if len(baseline_runs) < MIN_VALID_RUNS:
        quality_issues.append("baseline has fewer than five settled runs")
    if len(candidate_runs) < MIN_VALID_RUNS:
        quality_issues.append("candidate has fewer than five settled runs")
    if len(baseline_runs) != len(candidate_runs):
        quality_issues.append("baseline and candidate settled-run counts differ")
    if paired is False:
        quality_issues.append("datasets were not collected in interleaved paired mode")
    if baseline_data.get("settings") != candidate_data.get("settings"):
        quality_issues.append("measurement settings differ")
    baseline_provenance = baseline_data.get("provenance")
    candidate_provenance = candidate_data.get("provenance")
    if not baseline_provenance or not candidate_provenance:
        quality_issues.append("measurement provenance is missing")
    elif (
        baseline_provenance.get("benchmark_sha256")
        != candidate_provenance.get("benchmark_sha256")
    ):
        quality_issues.append("benchmark implementations differ")
    elif baseline_provenance.get("environment") != candidate_provenance.get(
        "environment",
    ):
        quality_issues.append("measurement environments differ")

    baseline_run_ids = [run["run"] for run in baseline_runs]
    candidate_run_ids = [run["run"] for run in candidate_runs]
    if len(set(baseline_run_ids)) != len(baseline_run_ids):
        quality_issues.append("baseline run IDs are not unique")
    if len(set(candidate_run_ids)) != len(candidate_run_ids):
        quality_issues.append("candidate run IDs are not unique")
    matched_run_ids = set(baseline_run_ids) & set(candidate_run_ids)
    if set(baseline_run_ids) != set(candidate_run_ids):
        quality_issues.append("baseline and candidate settled run IDs differ")
    if len(matched_run_ids) < MIN_VALID_RUNS:
        quality_issues.append("fewer than five matched settled pairs")
    if paired:
        if not baseline_input.get("comparison_id"):
            quality_issues.append("paired comparison ID is missing")
        expected_order = []
        for run_number in range(1, baseline_data["settings"]["runs"] + 1):
            labels = ["baseline", "candidate"]
            if run_number % 2 == 0:
                labels.reverse()
            expected_order.extend(
                {"label": label, "run": run_number} for label in labels
            )
        if baseline_input.get("order") != expected_order:
            quality_issues.append("paired run order is invalid")

    metrics = {
        "combined_pss_kb": ("combined", "pss_kb"),
        "combined_rss_kb": ("combined", "rss_kb"),
        "gjs_nvidia_vram_mib": ("gjs", "nvidia_vram_mib"),
        "ready_ms": ("ready_ms",),
        "settled_ms": ("settled_ms",),
        "combined_cpu_ms": ("combined", "cpu_ms"),
    }
    comparisons = {}
    for name, path in metrics.items():
        baseline = metric_summary(baseline_runs, *path)
        candidate = metric_summary(candidate_runs, *path)
        comparisons[name] = {
            "baseline": baseline,
            "candidate": candidate,
            "delta": delta_summary(baseline, candidate),
        }

    for label, summary in (
        ("baseline", comparisons["combined_pss_kb"]["baseline"]),
        ("candidate", comparisons["combined_pss_kb"]["candidate"]),
    ):
        median = summary["median"]
        mad = summary["mad"]
        if median and mad / median > MAX_PSS_MAD_RATIO:
            quality_issues.append(f"{label} PSS MAD exceeds 3%")

    paired_pss_interval = paired_delta_interval(
        baseline_runs,
        candidate_runs,
        "combined",
        "pss_kb",
    )
    status = classify_pss(
        comparisons["combined_pss_kb"]["delta"],
        paired_pss_interval,
    )
    if quality_issues:
        status = "inconclusive"
    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "baseline": str(args.baseline),
        "candidate": str(args.candidate) if args.candidate else None,
        "paired": paired,
        "status": status,
        "quality_issues": quality_issues,
        "valid_runs": {
            "baseline": len(baseline_runs),
            "candidate": len(candidate_runs),
        },
        "metrics": comparisons,
        "paired_pss_delta_kb_95_ci": paired_pss_interval,
    }
    print(f"Comparison: {status}")
    for name, summary in comparisons.items():
        baseline = summary["baseline"]["median"]
        candidate = summary["candidate"]["median"]
        delta = summary["delta"]
        print(
            f"- {name}: {baseline} -> {candidate} "
            f"({delta['absolute']:+} / {delta['percent']:+}%)"
            if delta["absolute"] is not None
            else f"- {name}: unavailable",
        )
    for issue in quality_issues:
        print(f"- quality: {issue}")
    print(
        "- paired PSS delta 95% CI: "
        f"{paired_pss_interval['lower_95']} to {paired_pss_interval['upper_95']} KB",
    )
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(f"Comparison written to {args.output}")


def main():
    args = parse_args()

    def request_termination(signum, _frame):
        raise TerminationRequested(f"received signal {signum}")

    signal.signal(signal.SIGTERM, request_termination)
    signal.signal(signal.SIGHUP, request_termination)
    try:
        if args.command == "measure":
            measure(args)
            return
        if args.command == "measure-pair":
            measure_pair(args)
            return
        compare(args)
    except (OSError, RuntimeError, subprocess.SubprocessError, KeyError) as error:
        print(f"cold-start-memory: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
