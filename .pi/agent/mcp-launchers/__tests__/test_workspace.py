import importlib.util
import io
import json
import os
import runpy
import signal
import subprocess
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import Mock, patch


LAUNCHERS = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("workspace", LAUNCHERS / "workspace.py")
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Cannot load the workspace helper")
workspace = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(workspace)


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="mcp-tests-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.project = self.root / "projekt æøå with spaces"
        self.project.mkdir()
        self.cache = self.root / "cache"
        self.environment = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        self.environment.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull)
        self.git("init", "--quiet")
        self.put("src/main.py", "print('original')\n")
        self.git("add", "--", "src/main.py")

    def git(self, *args):
        subprocess.run(["git", "-C", str(self.project), *args], env=self.environment,
                       check=True, capture_output=True)

    def put(self, name, content):
        path = self.project / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        return path

    def snapshot(self, includes=(), cwd=None):
        return workspace.snapshot_workspace(cwd or self.project, includes, self.cache)

    def test_current_tracked_content_is_copied_and_reconnect_refreshes_it(self):
        original = self.put("src/main.py", "print('unstaged edit')\n")
        with self.snapshot() as snapshot:
            copied = snapshot / "src/main.py"
            self.assertEqual(copied.read_text(), original.read_text())
            self.assertNotEqual(copied.stat().st_ino, original.stat().st_ino)
            self.assertEqual(copied.stat().st_mode & 0o222, 0)
            original.write_text("print('new edit')\n")
            self.assertEqual(copied.read_text(), "print('unstaged edit')\n")
        self.assertFalse(snapshot.parent.exists())
        with self.snapshot() as fresh:
            self.assertEqual((fresh / "src/main.py").read_text(), original.read_text())

    def test_credentials_and_runtime_state_are_excluded_even_if_tracked(self):
        excluded = [
            ".pi/agent/auth.json", ".pi/agent/mcp-auth.json", ".pi/agent/sessions/session.jsonl",
            ".pi/agent/auth-profiles/local.json", ".pi/agent/trust.json", ".env", ".env.production",
            "nested/.envrc", "keys/private.pem", ".ssh/id_ed25519", "secrets.yaml",
            "node_modules/package/index.js", ".serena/project.yml", ".cache/data.json",
            ".shinit", ".config/fish/config.fish", ".bashrc", ".zshrc",
        ]
        for name in excluded:
            self.put(name, "sensitive sentinel")
        self.git("add", "--all")
        with self.snapshot() as snapshot:
            for name in excluded:
                with self.subTest(name=name):
                    self.assertFalse((snapshot / name).exists())
            self.assertFalse((snapshot / ".git").exists())
            self.assertTrue((snapshot / "src/main.py").is_file())

    def test_exclusions_use_repository_paths_from_nested_working_directories(self):
        self.put(".pi/agent/source.py", "safe source")
        self.put(".pi/agent/sessions/tracked.jsonl", "private session")
        self.git("add", "--all")
        self.put(".pi/agent/sessions/untracked.jsonl", "private session")
        agent = self.project / ".pi/agent"
        with self.snapshot(cwd=agent) as snapshot:
            self.assertTrue((snapshot / "source.py").is_file())
            self.assertFalse((snapshot / "sessions").exists())
        with self.assertRaisesRegex(ValueError, "No permitted source"), self.snapshot(cwd=agent / "sessions"):
            self.fail("runtime directory accepted")
        for cwd, name in [(agent, "sessions/untracked.jsonl"), (agent / "sessions", "untracked.jsonl")]:
            with (
                self.subTest(cwd=cwd),
                self.assertRaisesRegex(ValueError, "allowed relative"),
                self.snapshot([name], cwd=cwd),
            ):
                self.fail("nested runtime include accepted")

    def test_untracked_files_require_explicit_inclusion_and_exclusions_cannot_be_overridden(self):
        self.put("src/ny æøå.py", "new source")
        self.put("src/ignored.py", "ignored source")
        self.put(".gitignore", "src/ignored.py\n")
        self.put(".pi/agent/auth.json", "credential sentinel")
        with self.snapshot() as snapshot:
            self.assertFalse((snapshot / "src/ny æøå.py").exists())
        with self.snapshot(["src/ny æøå.py", "src/ignored.py"]) as snapshot:
            self.assertEqual((snapshot / "src/ny æøå.py").read_text(), "new source")
            self.assertEqual((snapshot / "src/ignored.py").read_text(), "ignored source")
        for name in ["../outside.py", "/etc/passwd", ".pi/agent/auth.json", "src/../src/main.py"]:
            with (
                self.subTest(name=name),
                self.assertRaisesRegex(ValueError, "allowed relative"),
                self.snapshot([name]),
            ):
                self.fail("unsafe include accepted")

    def test_working_directory_does_not_expand_to_repository_parent(self):
        self.put("outside.py", "not part of the selected subtree")
        self.git("add", "outside.py")
        with self.snapshot(cwd=self.project / "src") as snapshot:
            self.assertTrue((snapshot / "main.py").is_file())
            self.assertFalse((snapshot / "outside.py").exists())

    def test_symlinks_and_replaced_parent_directories_are_never_followed(self):
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "secret.py").write_text("outside sentinel")
        (self.project / "link.py").symlink_to(outside / "secret.py")
        self.put("parent/secret.py", "initial source")
        self.git("add", "--all")
        (self.project / "parent/secret.py").unlink()
        (self.project / "parent").rmdir()
        (self.project / "parent").symlink_to(outside, target_is_directory=True)
        with self.snapshot() as snapshot:
            self.assertFalse((snapshot / "link.py").exists())
            self.assertFalse((snapshot / "parent/secret.py").exists())
        with self.assertRaisesRegex(ValueError, "without symlinks"), self.snapshot(["link.py"]):
            self.fail("explicit symlink accepted")

    def test_tracked_file_replaced_by_symlink_is_skipped(self):
        target = self.root / "external.py"
        target.write_text("outside sentinel")
        self.put("other.py", "source")
        self.git("add", "other.py")
        (self.project / "other.py").unlink()
        (self.project / "other.py").symlink_to(target)
        with self.snapshot() as snapshot:
            self.assertFalse((snapshot / "other.py").exists())

    def test_hardlinks_and_oversized_files_fail_closed_and_cleanup(self):
        os.link(self.project / "src/main.py", self.project / "alias.py")
        with self.assertRaisesRegex(ValueError, "Hard-linked"), self.snapshot():
            self.fail("hardlink accepted")
        (self.project / "alias.py").unlink()
        with (
            patch.object(workspace, "MAX_FILE_BYTES", 1),
            self.assertRaisesRegex(ValueError, "size limit"),
            self.snapshot(),
        ):
            self.fail("oversized file accepted")
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_no_git_or_empty_source_set_has_no_unfiltered_fallback(self):
        empty = self.root / "not-a-repository"
        empty.mkdir()
        with self.assertRaisesRegex(ValueError, "Git working tree"), self.snapshot(cwd=empty):
            self.fail("non-Git directory accepted")
        (self.project / "src/main.py").unlink()
        with self.assertRaisesRegex(ValueError, "No permitted source"), self.snapshot():
            self.fail("empty snapshot accepted")

    def test_private_cache_is_required(self):
        self.cache.mkdir(mode=0o755)
        with self.assertRaisesRegex(ValueError, "private directory"), self.snapshot():
            self.fail("shared cache accepted")

    def fake_podman(self):
        binary_directory = self.root / "bin"
        binary_directory.mkdir(exist_ok=True)
        executable = binary_directory / "podman"
        executable.write_text("#!" + sys.executable + "\n" + '''import json, os, pathlib, signal, sys
args = sys.argv[1:]
mount = args[args.index('-v') + 1]
source = pathlib.Path(mount.rsplit(':', 2)[0])
record = {'args': args, 'source': str(source), 'files': sorted(str(p.relative_to(source)) for p in source.rglob('*') if p.is_file())}
pathlib.Path(os.environ['MCP_CAPTURE']).write_text(json.dumps(record))
if os.environ.get('MCP_WAIT'):
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    print('ready', flush=True)
    signal.pause()
sys.exit(int(os.environ.get('MCP_EXIT', '0')))
''')
        executable.chmod(0o755)
        home = self.root / "home"
        home.mkdir(exist_ok=True)
        return {**os.environ, "PATH": str(binary_directory) + os.pathsep + os.environ["PATH"],
                "HOME": str(home), "MCP_CAPTURE": str(self.root / "capture.json")}

    def test_both_launchers_mount_only_readonly_snapshots_and_preserve_restrictions(self):
        environment = self.fake_podman()
        for server, target in [("ast-grep", "/src"), ("serena", "/workspace")]:
            with self.subTest(server=server):
                result = subprocess.run([str(LAUNCHERS / server)], cwd=self.project,
                                        env=environment, capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, "")
                record = json.loads(Path(environment["MCP_CAPTURE"]).read_text())
                args = record["args"]
                mounts = [args[i + 1] for i, a in enumerate(args) if a == "-v"]
                self.assertEqual(mounts, [record["source"] + ":" + target + ":ro,Z"])
                self.assertNotIn(str(self.project), " ".join(args))
                self.assertEqual(record["files"], ["src/main.py"])
                self.assertIn("--cap-drop=ALL", args)
                self.assertIn("--security-opt=no-new-privileges", args)
                self.assertIn(workspace.IMAGES[server], args)
                self.assertFalse(Path(record["source"]).exists())
                if server == "ast-grep":
                    self.assertIn("--network=none", args)
                    self.assertIn("--read-only", args)
                else:
                    self.assertIn("/workspace/.serena:rw,noexec,nosuid,nodev,size=256m", args)
                    self.assertIn("SERENA_HOME=/tmp/serena-home", args)
                    self.assertNotIn("pi-serena:/workspaces/serena/config", args)

    def test_container_failure_and_signal_cleanup_snapshot(self):
        environment = self.fake_podman()
        failed = subprocess.run([str(LAUNCHERS / "ast-grep")], cwd=self.project,
                                env={**environment, "MCP_EXIT": "42"}, capture_output=True, timeout=10)
        self.assertEqual(failed.returncode, 42)
        record = json.loads(Path(environment["MCP_CAPTURE"]).read_text())
        self.assertFalse(Path(record["source"]).exists())
        with subprocess.Popen([str(LAUNCHERS / "ast-grep")], cwd=self.project,
                              env={**environment, "MCP_WAIT": "1"},
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) as child:
            assert child.stdout is not None
            self.assertEqual(child.stdout.readline().strip(), "ready")
            child.send_signal(signal.SIGTERM)
            child.communicate(timeout=10)
            self.assertEqual(child.returncode, 128 + signal.SIGTERM)
        record = json.loads(Path(environment["MCP_CAPTURE"]).read_text())
        self.assertFalse(Path(record["source"]).exists())

    def test_serena_bootstrap_sets_readonly_before_starting_stdio(self):
        module = types.ModuleType("serena.config.serena_config")
        config = Mock()
        config.get_project_yml_location.return_value = "/workspace/.serena/project.yml"
        project = Mock(read_only=False)
        serena_config = Mock()
        serena_config.from_config_file.return_value = config
        project_config = Mock()
        project_config.autogenerate.return_value = project
        module.__dict__.update(SerenaConfig=serena_config, ProjectConfig=project_config)
        bootstrap = self.put("bootstrap.py", workspace.SERENA_BOOTSTRAP)
        output = io.StringIO()
        with patch.dict(sys.modules, {module.__name__: module}), patch("os.execv") as execute, redirect_stdout(output):
            runpy.run_path(str(bootstrap))
        self.assertTrue(project.read_only)
        project.save.assert_called_once_with("/workspace/.serena/project.yml")
        self.assertIn("--enable-web-dashboard", execute.call_args.args[1])
        self.assertEqual(output.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
