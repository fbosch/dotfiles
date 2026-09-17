#!/usr/bin/env python3
import json
import os
import shutil
import stat
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "caliper-skill-eval.sh"
SECRETS = ("seed-secret", "candidate-secret", "judge-secret")

PI = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
role = sys.argv[-1] if sys.argv else ""
if role in ("--version", "-v"):
    raise SystemExit(0)
agent_dir = os.environ.get("PI_CODING_AGENT_DIR", str(Path(os.environ["HOME"]) / ".pi" / "agent"))
auth_path = Path(agent_dir) / "auth.json"
data = json.loads(auth_path.read_text())
secret_in_env = any(value in os.environ.values() for value in ("seed-secret", "candidate-secret", "judge-secret"))
log = Path(os.environ["CALIPER_LOG"])
record = {"kind": "pi", "role": role, "agent": str(agent_dir),
          "seed": data.get("token") == "seed-secret", "candidate": data.get("token") == "candidate-secret",
          "secret_in_env": secret_in_env, "no_extensions": "--no-extensions" in sys.argv}
with log.open("a") as stream:
    stream.write(json.dumps(record) + "\n")
if role == "candidate":
    data["token"] = "candidate-secret"
elif role == "judge":
    data["token"] = "judge-secret"
auth_path.write_text(json.dumps(data) + "\n")
'''

CALIPER = r'''#!/usr/bin/env python3
import json, os, shutil, subprocess, sys
from pathlib import Path
argv = sys.argv[1:]
log = Path(os.environ["CALIPER_LOG"])
def write(value):
    with log.open("a") as stream: stream.write(json.dumps(value) + "\n")
write({"kind": "caliper", "argv": argv, "home": os.environ.get("HOME", ""),
       "agent": os.environ.get("PI_CODING_AGENT_DIR", "")})
if argv and argv[0] == "validate":
    raise SystemExit(0)
if argv and argv[0] == "run":
    candidate_home = Path(os.environ["HOME"]) / "candidate home"
    candidate_agent = candidate_home / ".pi" / "agent"
    candidate_agent.mkdir(parents=True)
    source_agent = Path(os.environ["HOME"]) / ".pi" / "agent"
    for name in ("auth.json", "settings.json"):
        source = source_agent / name
        if source.exists(): shutil.copy2(source, candidate_agent / name)
    env = os.environ.copy()
    env.update(HOME=str(candidate_home), PI_CODING_AGENT_DIR=str(candidate_agent))
    subprocess.run([os.environ["PI_CLI_PATH"], "candidate"], env=env, check=True)
    conflict = os.environ.get("CALIPER_CONFLICT_PATH")
    if conflict:
        Path(conflict).write_text(json.dumps({"token": "external-change"}) + "\n")
    subprocess.run([os.environ["PI_CLI_PATH"], "judge"], env=os.environ.copy(), check=True)
    raise SystemExit(int(os.environ.get("CALIPER_EXIT", "0")))
raise SystemExit(2)
'''

class CaliperSkillEvalTests(unittest.TestCase):
    def run_eval(self, profile=None, ablate=False, exit_code=0, conflict=False, extra=None):
        root = Path(tempfile.mkdtemp(prefix="caliper fixture "))
        agent = root / "pi agent with spaces"
        (agent / "auth-profiles").mkdir(parents=True)
        default = agent / "auth.json"
        named = agent / "auth-profiles" / "ct.json"
        default.write_text(json.dumps({"token": "default-secret"}) + "\n")
        named.write_text(json.dumps({"token": "seed-secret"}) + "\n")
        for path in (default, named): path.chmod(0o600)
        (agent / "settings.json").write_text('{"defaultProjectTrust":"always"}\n')
        bin_dir = root / "mock bin"
        bin_dir.mkdir()
        for name, content in (("pi", PI), ("caliper", CALIPER)):
            path = bin_dir / name
            path.write_text(content)
            path.chmod(0o700)
        log = root / "events.jsonl"
        tmpdir = root / "temporary directory with spaces"
        tmpdir.mkdir()
        env = os.environ.copy()
        env.update({"HOME": str(root / "home"), "PI_CODING_AGENT_DIR": str(agent),
                    "TMPDIR": str(tmpdir), "CALIPER_LOG": str(log),
                    "CALIPER_EXIT": str(exit_code),
                    "PATH": str(bin_dir) + os.pathsep + env.get("PATH", "")})
        if conflict:
            env["CALIPER_CONFLICT_PATH"] = str(named if profile else default)
        args = []
        if ablate: args.append("--ablate")
        if profile: args += ["--auth-profile", profile]
        args += list(extra or ["cli-ux"])
        result = subprocess.run([str(SCRIPT), *args], cwd=ROOT, env=env, text=True,
                                capture_output=True)
        events = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
        return root, agent, default, named, result, events

    def tearDown(self):
        for root in getattr(self, "roots", []): shutil.rmtree(root, ignore_errors=True)

    def track(self, root):
        if not hasattr(self, "roots"): self.roots = []
        self.roots.append(root)

    def test_named_profile_is_used_by_candidate_and_judge_and_ablation_is_preserved(self):
        root, agent, default, named, result, events = self.run_eval(profile="ct", ablate=True,
                                                                      extra=["cli-ux", "model with spaces", "low", "2", "judge", "high"])
        self.track(root)
        self.assertEqual(result.returncode, 0, result.stderr)
        caliper = [e for e in events if e["kind"] == "caliper"]
        self.assertEqual(caliper[1]["argv"][0], "run")
        self.assertIn("--ablate", caliper[1]["argv"])
        self.assertEqual([e["role"] for e in events if e["kind"] == "pi"], ["candidate", "judge"])
        pi_events = [e for e in events if e["kind"] == "pi"]
        self.assertTrue(pi_events[0]["seed"])
        self.assertTrue(pi_events[1]["candidate"])
        self.assertTrue(all(e["no_extensions"] and not e["secret_in_env"] for e in pi_events))
        self.assertEqual(json.loads(named.read_text())["token"], "judge-secret")
        self.assertEqual(json.loads(default.read_text())["token"], "default-secret")
        self.assertEqual(stat.S_IMODE(named.stat().st_mode), 0o600)
        self.assertNotIn("seed-secret", result.stdout + result.stderr)
        self.assertNotIn("judge-secret", result.stdout + result.stderr)
        self.assertFalse(Path(caliper[0]["home"]).exists())

    def test_default_profile_and_child_status(self):
        root, agent, default, named, result, events = self.run_eval(exit_code=17, extra=["cli-ux", "m", "medium", "1", "j", "high"])
        self.track(root)
        self.assertEqual(result.returncode, 17)
        self.assertEqual(json.loads(default.read_text())["token"], "judge-secret")
        self.assertEqual(json.loads(named.read_text())["token"], "seed-secret")
        self.assertFalse(Path([e for e in events if e["kind"] == "caliper"][0]["home"]).exists())

    def test_conflict_does_not_overwrite_source(self):
        root, agent, default, named, result, _ = self.run_eval(profile="ct", conflict=True)
        self.track(root)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(named.read_text())["token"], "external-change")
        self.assertIn("changed during evaluation", result.stderr)

    def test_invalid_missing_profiles_and_missing_option_value_fail_closed(self):
        for profile in ("missing", "../escape", "foo/bar", "."):
            root, _, _, _, result, events = self.run_eval(profile=profile)
            self.track(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(events)
        root, _, _, _, result, events = self.run_eval(extra=["--auth-profile"])
        self.track(root)
        self.assertEqual(result.returncode, 2)
        self.assertFalse(events)

if __name__ == "__main__":
    unittest.main()
