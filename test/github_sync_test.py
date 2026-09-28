import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / "deploy"))
import github_sync as sync


class GitHubSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.source, self.destination = root / "source", root / "github.git"
        self.command("init", str(self.source))
        self.command("init", "--bare", str(self.destination))
        self.sha = self.commit("initial")
        for name, value in [("ROOT", root / "sync"), ("SOURCE", str(self.source)),
                            ("DESTINATION", str(self.destination)), ("head", lambda: self.sha),
                            ("eligible", lambda sha: True)]:
            patcher = patch.object(sync, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def command(self, *args):
        return subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL, text=True).strip()

    def commit(self, message):
        self.command("-C", str(self.source), "checkout", "-B", "main")
        self.command("-C", str(self.source), "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                     "commit", "--allow-empty", "-m", message)
        return self.command("-C", str(self.source), "rev-parse", "HEAD")

    def test_initial_sync_and_update(self):
        sync.sync()
        self.assertEqual(sync.remote_head(), self.sha)
        self.sha = self.commit("update")
        sync.sync()
        self.assertEqual(sync.remote_head(), self.sha)
        sync.sync()  # Already synchronized: safe to retry.
        self.assertEqual(self.command("--git-dir=" + str(self.destination), "for-each-ref", "--format=%(refname)"),
                         "refs/heads/main")

    def test_failed_checks_do_not_publish(self):
        with patch.object(sync, "eligible", return_value=False):
            sync.sync()
        self.assertEqual(self.command("--git-dir=" + str(self.destination), "show-ref", "--head")
                         if (self.destination / "refs/heads/main").exists() else "", "")

    def test_changed_main_during_fetch_does_not_publish(self):
        with patch.object(sync, "head", side_effect=[self.sha, "b" * 40]):
            sync.sync()
        self.assertIsNone(sync.remote_head())

    def test_divergent_github_history_is_not_overwritten(self):
        sync.sync()
        old = self.sha
        self.sha = self.commit("gitea update")
        divergent = self.command("-C", str(self.source), "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                                "commit-tree", "HEAD^{tree}", "-p", old, "-m", "github-only change")
        self.command("-C", str(self.source), "push", str(self.destination), divergent + ":refs/heads/main")
        with self.assertRaises(RuntimeError):
            sync.sync()
        self.assertEqual(sync.remote_head(), divergent)


if __name__ == "__main__":
    unittest.main()
