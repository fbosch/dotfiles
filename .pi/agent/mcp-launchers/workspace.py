"""Launch project MCPs against a filtered, read-only snapshot, never the live tree."""

import argparse
import errno
import fnmatch
import os
import signal
import stat
import subprocess
import sys
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path, PurePosixPath


IMAGES = {
    "ast-grep": "docker.io/mcp/ast-grep@sha256:5fc3f2e9dcf2c019e92662f608b8d89e12134ed6d91e6f5461de6efd506a1e72",
    "serena": "ghcr.io/oraios/serena@sha256:6c9459e4246a39c9deaa4f23fb05a526ac6e237b24c8e84a927a098fa1ab6730",
}
BLOCKED_DIRECTORIES = {
    ".git", ".hg", ".svn", ".ssh", ".gnupg", ".aws", ".azure", ".kube",
    ".docker", ".cache", ".direnv", ".devenv", ".serena", ".venv", "venv",
    "node_modules", "__pycache__",
}
BLOCKED_FILES = {
    "auth.json", "mcp-auth.json", "credentials", "credentials.json",
    ".git-credentials", ".netrc", ".npmrc", ".pypirc", ".yarnrc.yml",
    "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
    ".shinit", ".profile", ".bashrc", ".bash_profile", ".zshrc", ".zprofile", "config.fish",
}
BLOCKED_PATTERNS = (".env*", "*.pem", "*.key", "*.p12", "*.pfx", "*.jks", "*.keystore", "secrets.*")
PI_RUNTIME = {
    "auth-profiles", "sessions", "subagent-sessions", "fff", "npm", "git",
    "tools", "tmp", "web-search-cache", "cache", "tasks", "mcp-cache.json",
    "mcp-onboarding.json", "models-store.json", "trust.json",
    "mcp.log", "mcp.log.1",
}
MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_SNAPSHOT_BYTES = 512 * 1024 * 1024
MAX_FILES = 100_000

# This API matches the pinned Serena image. Metadata is writable, source files are not.
SERENA_BOOTSTRAP = """
import contextlib, os, sys
from serena.config.serena_config import ProjectConfig, SerenaConfig
with contextlib.redirect_stdout(sys.stderr):
    config = SerenaConfig.from_config_file()
    project = ProjectConfig.autogenerate('/workspace', config)
    project.read_only = True
    project.save(config.get_project_yml_location('/workspace'))
os.execv('/workspaces/serena/.venv/bin/serena', [
    'serena', 'start-mcp-server', '--project', '/workspace', '--context', 'agent',
    '--enable-web-dashboard', 'False', '--open-web-dashboard', 'False',
])
"""


def allowed_path(name):
    path = PurePosixPath(name)
    if not name or path.is_absolute() or any(p in ("", ".", "..") for p in name.split("/")):
        return False
    parts = tuple(p.lower() for p in path.parts)
    if any(p in BLOCKED_DIRECTORIES for p in parts):
        return False
    if parts[-1] in BLOCKED_FILES or any(fnmatch.fnmatchcase(parts[-1], p) for p in BLOCKED_PATTERNS):
        return False
    for i in range(len(parts) - 2):
        if parts[i:i + 2] == (".pi", "agent") and parts[i + 2] in PI_RUNTIME:
            return False
    return True


def tracked_files(root_fd):
    # Staging is single-threaded: inherit the pinned cwd instead of resolving it again.
    previous_fd = os.open(".", os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fchdir(root_fd)
        return git_sources()
    finally:
        os.fchdir(previous_fd)
        os.close(previous_fd)


def git_sources():
    # Ignore inherited Git routing and disable fsmonitor so enumeration runs no repository hook.
    environment = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    environment.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull, GIT_OPTIONAL_LOCKS="0")
    command = ["git", "-c", "core.fsmonitor=false"]
    prefix = subprocess.run(command + ["rev-parse", "--show-prefix"], env=environment, capture_output=True, check=False)
    result = subprocess.run(
        command + ["ls-files", "--cached", "--stage", "-z", "--", "."],
        env=environment, capture_output=True, check=False,
    )
    if prefix.returncode or result.returncode:
        raise ValueError("A readable Git working tree is required; refusing an unfiltered directory mount")
    names = set()
    for entry in result.stdout.split(b"\0"):
        if not entry:
            continue
        metadata, name = entry.split(b"\t", 1)
        mode, _, stage = metadata.split()
        if stage != b"0":
            raise ValueError("Resolve Git index conflicts before starting a workspace MCP")
        if mode in (b"100644", b"100755"):
            names.add(os.fsdecode(name))
    return names, os.fsdecode(prefix.stdout).removesuffix("\n")


def open_source(root_fd, name):
    """Anchor every component to open directory descriptors; never traverse symlinks."""
    parent = os.dup(root_fd)
    try:
        parts = PurePosixPath(name).parts
        for component in parts[:-1]:
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent)
            parent = child
        return os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    finally:
        os.close(parent)


def copy_source(root_fd, name, destination, remaining):
    try:
        source_fd = open_source(root_fd, name)
    except OSError as error:
        if error.errno in (errno.ENOENT, errno.ELOOP, errno.ENOTDIR):
            return None
        raise
    with os.fdopen(source_fd, "rb") as source:
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode):
            return None
        if before.st_nlink != 1:
            raise ValueError(f"Hard-linked source is not permitted: {name}")
        if before.st_size > min(MAX_FILE_BYTES, remaining):
            raise ValueError(f"Snapshot size limit exceeded: {name}")
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        count = 0
        with target.open("xb") as output:
            while chunk := source.read(1024 * 1024):
                count += len(chunk)
                if count > min(MAX_FILE_BYTES, remaining):
                    raise ValueError(f"Source grew beyond the snapshot size limit: {name}")
                output.write(chunk)
        after = os.fstat(source.fileno())
        if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise ValueError(f"Source changed while copying; reconnect to retry: {name}")
        target.chmod(0o555 if before.st_mode & 0o111 else 0o444)
        return count


def populate_snapshot(cwd, destination, includes=()):
    explicit = set(includes)
    total = 0
    copied = 0
    root_fd = os.open(cwd, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        tracked, prefix = tracked_files(root_fd)
        for name in explicit:
            if not allowed_path(name) or not allowed_path(prefix + name):
                raise ValueError(f"Explicit include is not an allowed relative source file: {name}")
        candidates = tracked | explicit
        if len(candidates) > MAX_FILES:
            raise ValueError("Snapshot file-count limit exceeded")
        for name in sorted(candidates):
            if not allowed_path(name) or not allowed_path(prefix + name):
                continue
            size = copy_source(root_fd, name, destination, MAX_SNAPSHOT_BYTES - total)
            if size is None:
                if name in explicit:
                    raise ValueError(f"Explicit include must be an existing regular file without symlinks: {name}")
                continue
            total += size
            copied += 1
    finally:
        os.close(root_fd)
    if not copied:
        raise ValueError("No permitted source files found; refusing to start an empty workspace MCP")
    return copied


@contextmanager
def snapshot_workspace(cwd, includes=(), cache_root=None):
    # Keep snapshots under HOME so Podman machines on macOS can see the same path.
    cache = Path(cache_root) if cache_root else Path.home() / ".cache/pi/mcp-workspaces"
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    if cache.is_symlink() or cache.stat().st_uid != os.getuid() or cache.stat().st_mode & 0o077:
        raise ValueError("MCP snapshot cache must be a private directory owned by the current user")
    with tempfile.TemporaryDirectory(prefix="snapshot-", dir=cache) as temporary:
        root = Path(temporary).resolve()
        if ":" in str(root):
            raise ValueError("Podman volume source paths cannot contain ':'")
        source = root / "source"
        source.mkdir()
        count = populate_snapshot(Path(cwd).resolve(), source, includes)
        # Reserve writable metadata separately from the read-only source mount.
        (source / ".serena").mkdir()
        print(f"MCP snapshot: {count} source files; reconnect after host edits to refresh", file=sys.stderr)
        yield source


def container_arguments(server, snapshot):
    common = ["run", "-i", "--rm", "--cap-drop=ALL", "--security-opt=no-new-privileges",
              "--cidfile", str(snapshot.parent / "container.cid")]
    if server == "ast-grep":
        return common + [
            "--read-only", "--network=none", "--tmpfs",
            "/tmp:rw,noexec,nosuid,nodev,size=64m",  # noqa: S108 — container-local tmpfs, not host storage.
            "-v", f"{snapshot}:/src:ro,Z", IMAGES[server],
        ]
    if server == "serena":
        return common + [
            "--init", "-v", f"{snapshot}:/workspace:ro,Z",
            "--tmpfs", "/workspace/.serena:rw,noexec,nosuid,nodev,size=256m",
            "-e", "SERENA_DOCKER=1", "-e", "SERENA_HOME=/tmp/serena-home",
            "--entrypoint", "/workspaces/serena/.venv/bin/python",
            IMAGES[server], "-c", SERENA_BOOTSTRAP,
        ]
    raise ValueError(f"Unknown MCP server: {server}")


def remove_container(cidfile):
    if not cidfile.is_file():
        return
    # Killing the attached Podman client does not necessarily stop its container.
    result = subprocess.run(
        ["podman", "rm", "--force", "--ignore", "--cidfile", str(cidfile)],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, timeout=10, check=False,
    )
    if result.returncode:
        raise ValueError("Could not remove this MCP container; inspect Podman before reconnecting")


def run_container(arguments):
    cidfile = Path(arguments[arguments.index("--cidfile") + 1])
    child = None
    timer = None
    received_signal = None

    def forward(signum, _frame):
        nonlocal timer, received_signal
        received_signal = signum
        if child is None:
            raise SystemExit(128 + signum)
        if child.poll() is None:
            child.send_signal(signum)
            if timer is None:
                timer = threading.Timer(5, child.kill)
                timer.daemon = True
                timer.start()

    previous = {sig: signal.signal(sig, forward) for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
    try:
        child = subprocess.Popen(["podman", *arguments])
        status = child.wait()
        return 128 + received_signal if received_signal else (status if status >= 0 else 128 - status)
    finally:
        if timer:
            timer.cancel()
        for sig, handler in previous.items():
            signal.signal(sig, handler)
        remove_container(cidfile)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("server", choices=tuple(IMAGES))
    parser.add_argument("--include", action="append", default=[], metavar="RELATIVE_FILE",
                        help="Explicitly include one untracked source file; exclusions still apply")
    args = parser.parse_args()

    def interrupt_snapshot(signum, _frame):
        raise SystemExit(128 + signum)

    previous = {sig: signal.signal(sig, interrupt_snapshot) for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
    try:
        with snapshot_workspace(Path.cwd(), args.include) as snapshot:
            return run_container(container_arguments(args.server, snapshot))
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"MCP workspace: {error}", file=sys.stderr)
        return 1
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


if __name__ == "__main__":
    sys.exit(main())
