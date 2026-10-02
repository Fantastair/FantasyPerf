#!/usr/bin/env python3
"""Poll GitHub main and publish only its completed, successful push CI.

Never executes repository code. The static build contract remains
index.html + src/ + LICENSE (scripts/build.mjs).
"""
import fcntl
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

API = "https://api.github.com"
REPO = "Fantastair/FantasyPerf"
ROOT = Path(os.environ.get("FANTASYPERF_ROOT", "/srv/fantasyperf"))
TOKEN = Path(os.environ.get("FANTASYPERF_TOKEN", "/etc/fantasyperf/github-read.token"))
REQUIRED_JOBS = {"checks", "verify"} | {
    f"browser ({browser}, {shard}/2)"
    for browser in ("chromium", "firefox", "webkit") for shard in (1, 2)
}


def get(path, raw=False):
    headers = {"User-Agent": "FantasyPerf-deploy", "Accept": "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28"}
    if raw:
        # Public archive download deliberately carries no API credential.
        url = f"https://codeload.github.com/{REPO}/tar.gz/{path}"
        headers = {"User-Agent": "FantasyPerf-deploy"}
    else:
        url = f"{API}/repos/{REPO}/{path}"
        if TOKEN.is_file():
            headers["Authorization"] = "Bearer " + TOKEN.read_text().strip()
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read(32 * 1024 * 1024 + 1)
    if len(data) > 32 * 1024 * 1024:
        raise ValueError("Response exceeds 32 MiB")
    return data if raw else json.loads(data)


def head():
    # Git polling does not consume GitHub's anonymous REST API quota.
    result = subprocess.run(
        ["git", "-c", "credential.helper=", "ls-remote",
         f"https://github.com/{REPO}.git", "refs/heads/main"],
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_CONFIG_NOSYSTEM": "1",
             "GIT_CONFIG_GLOBAL": "/dev/null"},
        check=True, capture_output=True, text=True, timeout=30,
    )
    match = re.fullmatch(r"([0-9a-f]{40})\s+refs/heads/main\s*", result.stdout)
    if not match:
        raise ValueError("Invalid main ref")
    return match.group(1)


def eligible(sha):
    """Require the newest matching push run and every matrix job to succeed."""
    runs = get(f"actions/workflows/ci.yml/runs?event=push&branch=main&head_sha={sha}&per_page=100")
    runs = [r for r in runs["workflow_runs"] if
            r["head_sha"] == sha and r["event"] == "push" and
            r["head_branch"] == "main" and
            r["path"].split("@", 1)[0] == ".github/workflows/ci.yml" and
            r.get("head_repository", {}).get("full_name", "").lower() == REPO.lower()]
    if not runs:
        return False
    run = max(runs, key=lambda r: r["id"])
    if run.get("status") != "completed" or run.get("conclusion") != "success":
        return False
    # filter=latest includes successful jobs retained when rerunning failed jobs.
    jobs = get(f"actions/runs/{run['id']}/jobs?filter=latest&per_page=100")["jobs"]
    names = {j["name"] for j in jobs}
    return REQUIRED_JOBS <= names and all(
        j.get("status") == "completed" and j.get("conclusion") == "success"
        and j.get("head_sha") == sha for j in jobs
    )


def extract_static(data, destination):
    total = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError("Unsafe archive path")
            # GitHub archives contain one top-level repository directory.
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
        retry = ROOT / ".ci-retry.json"
        if retry.exists():
            state = json.loads(retry.read_text())
            if state.get("sha") == sha and time.time() < state.get("after", 0):
                return
        # Pending/failed CI is checked at most every two minutes (public API quota).
        retry.write_text(json.dumps({"sha": sha, "after": time.time() + 120}))
        if not eligible(sha):
            print(f"Waiting for successful main CI: {sha}")
            return
        if not target.exists():
            with tempfile.TemporaryDirectory(prefix=".staging-", dir=releases) as temp:
                staging = Path(temp)
                extract_static(get(sha, raw=True), staging)
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
        retry.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        publish()
    except urllib.error.HTTPError as error:
        if error.code not in (403, 429):
            raise
        # Retain the current release and respect GitHub's rate-limit cooldown.
        retry = ROOT / ".ci-retry.json"
        if retry.exists():
            state = json.loads(retry.read_text())
            state["after"] = max(time.time() + int(error.headers.get("Retry-After", "120")),
                                 float(error.headers.get("X-RateLimit-Reset", "0")))
            retry.write_text(json.dumps(state))
        print(f"GitHub HTTP {error.code}; keeping current release and retrying later")
