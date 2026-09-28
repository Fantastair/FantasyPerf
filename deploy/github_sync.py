#!/usr/bin/env python3
"""One-way, fast-forward-only sync of CI-verified Gitea main to GitHub."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
from datetime import datetime, timezone

from publish import head, eligible

ROOT = Path("/var/lib/fantasyperf-sync")
SOURCE = "http://127.0.0.1:3000/Fantastair/FantasyPerf.git"
DESTINATION = "git@github.com:Fantastair/FantasyPerf.git"


def git(*args):
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_CONFIG_NOSYSTEM="1",
               GIT_CONFIG_GLOBAL="/dev/null",
               GIT_SSH_COMMAND=("ssh -i /var/lib/fantasyperf-sync/github_key "
                                "-o IdentitiesOnly=yes -o BatchMode=yes "
                                "-o StrictHostKeyChecking=yes -o ConnectTimeout=15 "
                                "-o UserKnownHostsFile=/etc/fantasyperf/github_known_hosts"))
    result = subprocess.run(
        ["git", "-c", "core.hooksPath=/dev/null", "--git-dir=" + str(ROOT / "repo.git"), *args],
        env=env, text=True, capture_output=True, timeout=120,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()


def remote_head():
    result = git("ls-remote", DESTINATION, "refs/heads/main")
    return result.split()[0] if result else None


def sync():
    ROOT.mkdir(parents=True, exist_ok=True)
    with (ROOT / ".sync.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        sha = head()
        if not eligible(sha):
            print(f"Waiting for successful main CI: {sha}")
            return
        if not (ROOT / "repo.git").exists():
            git("init", "--bare", str(ROOT / "repo.git"))
        if remote_head() == sha:
            return
        git("fetch", "--no-tags", SOURCE, "refs/heads/main:refs/remotes/gitea/main")
        if git("rev-parse", "refs/remotes/gitea/main") != sha or head() != sha or not eligible(sha):
            print("main or CI changed; leaving GitHub unchanged")
            return
        # Explicit refspec: never mirror other branches, delete refs or force-push.
        git("push", DESTINATION, f"{sha}:refs/heads/main")
        if remote_head() != sha:
            raise RuntimeError("GitHub head does not match the verified commit")
        status = {"commit": sha, "synced_at": datetime.now(timezone.utc).isoformat()}
        pending = ROOT / ".status-next"
        pending.write_text(json.dumps(status) + "\n")
        pending.replace(ROOT / "status.json")
        print(f"Synced GitHub main: {sha}")


if __name__ == "__main__":
    sync()
