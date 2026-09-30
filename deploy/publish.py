#!/usr/bin/env python3
"""Publish the latest main only after its own Gitea push CI succeeds.

Runs under a dedicated unprivileged systemd user, triggered by the deploy job of
.gitea/workflows/ci.yml (needs: verify, push to main only). Never executes
repository code. The static build contract is index.html + src/ + LICENSE
(scripts/build.mjs).
"""
import fcntl
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile
import tempfile
import urllib.request

API = os.environ.get("FANTASYPERF_API", "http://127.0.0.1:3000/api/v1")
REPO = "Fantastair/FantasyPerf"
ROOT = Path(os.environ.get("FANTASYPERF_ROOT", "/srv/fantasyperf"))
TOKEN = Path(os.environ.get("FANTASYPERF_TOKEN", "/etc/fantasyperf/deploy.token"))


def get(path, raw=False):
    request = urllib.request.Request(
        f"{API}/repos/{REPO}/{path}",
        headers={"Authorization": "token " + TOKEN.read_text().strip()},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read(32 * 1024 * 1024 + 1)
    if len(data) > 32 * 1024 * 1024:
        raise ValueError("Response exceeds 32 MiB")
    return data if raw else json.loads(data)


def head():
    sha = get("branches/main")["commit"]["id"]
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Invalid commit SHA")
    return sha


# 任务被 deploy job 在运行内部触发时，这条 push 运行本身仍在进行中。
UNFINISHED = ("in_progress", "running", "waiting", "queued", "pending")


def eligible(sha):
    """返回 True 表示该提交的 verify 已通过，可以发布。

    只认 main 的 push 运行；运行已结束但不是 success（失败、取消）时一律不放行，
    仍在进行时以 verify job 的结果为准——deploy job 就在这条运行内部。
    """
    runs = get(f"actions/runs?event=push&branch=main&head_sha={sha}&limit=50")
    runs = [r for r in runs["workflow_runs"] if
            r["head_sha"] == sha and r["event"] == "push" and
            r["head_branch"] in ("main", "refs/heads/main") and
            r["path"].split("@", 1)[0] in ("ci.yml", ".gitea/workflows/ci.yml")]
    if not runs:
        return False
    run = max(runs, key=lambda r: r["id"])
    state = run.get("conclusion") or run.get("status")
    if state != "success" and state not in UNFINISHED:
        return False
    jobs = get(f"actions/runs/{run['id']}/jobs")["jobs"]
    return any(j["name"] == "verify" and (j.get("conclusion") or j.get("status")) == "success"
               and j["head_sha"] == sha for j in jobs)


def extract_static(data, destination):
    total = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError("Unsafe archive path")
            # Gitea archives contain one top-level repository directory.
            relative = PurePosixPath(*path.parts[1:])
            if not relative.parts:
                continue
            if str(relative) not in ("index.html", "LICENSE") and relative.parts[0] != "src":
                continue
            if member.isdir():
                continue
            if not member.isfile():
                raise ValueError("Static files must not be links or special files")
            total += member.size
            if total > 32 * 1024 * 1024:
                raise ValueError("Static site exceeds 32 MiB")
            output = destination.joinpath(*relative.parts)
            output.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source, output.open("wb") as target:
                shutil.copyfileobj(source, target)
            output.chmod(0o644)
    for required in ("index.html", "LICENSE", "src/app.js", "src/style.css"):
        if not (destination / required).is_file():
            raise ValueError(f"Missing required file: {required}")


def publish():
    ROOT.mkdir(parents=True, exist_ok=True)
    with (ROOT / ".deploy.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        sha = head()
        releases = ROOT / "releases"
        releases.mkdir(exist_ok=True)
        current = ROOT / "current"
        target = releases / sha
        if current.is_symlink() and current.resolve() == target:
            return
        if not eligible(sha):
            print(f"Waiting for successful main CI: {sha}")
            return
        if not target.exists():
            with tempfile.TemporaryDirectory(prefix=".staging-", dir=releases) as temp:
                staging = Path(temp)
                extract_static(get(f"archive/{sha}.tar.gz", raw=True), staging)
                (staging / "version.json").write_text(json.dumps({"commit": sha}) + "\n")
                staging.chmod(0o755)
                staging.rename(target)
        # A newer merge or rerun during download must not publish this result.
        if head() != sha or not eligible(sha):
            print("main or CI changed; leaving current deployment unchanged")
            return
        previous = current.resolve() if current.is_symlink() else None
        pending = ROOT / ".current-next"
        pending.unlink(missing_ok=True)
        pending.symlink_to(target)
        pending.replace(current)
        try:
            with urllib.request.urlopen("http://127.0.0.1:4096/version.json", timeout=10) as r:
                if json.load(r)["commit"] != sha:
                    raise ValueError("HTTP deployment check failed")
            with urllib.request.urlopen("http://127.0.0.1:4096/", timeout=10) as r:
                if r.status != 200:
                    raise ValueError("HTTP index check failed")
        except Exception:
            if previous is not None:
                pending.symlink_to(previous)
                pending.replace(current)
            else:
                current.unlink(missing_ok=True)
            raise
        print(f"Published {sha}; previous={previous}")


if __name__ == "__main__":
    publish()
