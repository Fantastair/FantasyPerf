"""Regression checks for the privileged boundary between CI and static serving."""
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("publish", Path(__file__).parents[1] / "deploy/publish.py")
publish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publish)
SHA = "a" * 40


class DeploymentTests(unittest.TestCase):
    def ci_run(self, **overrides):
        return dict(dict(id=1, head_sha=SHA, event="push", head_branch="main",
                         path=".github/workflows/ci.yml", status="completed", conclusion="success",
                         head_repository={"full_name": publish.REPO}, run_attempt=1), **overrides)

    def jobs(self):
        return [dict(name=name, head_sha=SHA, status="completed", conclusion="success")
                for name in publish.REQUIRED_JOBS]

    def eligible(self, runs=None, jobs=None):
        def get(url):
            return {"jobs": self.jobs() if jobs is None else jobs} if "/jobs?" in url else {
                "workflow_runs": [self.ci_run()] if runs is None else runs}
        with patch.object(publish, "get", side_effect=get):
            return publish.eligible(SHA)

    def test_only_completed_main_push_from_this_repository_can_publish(self):
        self.assertTrue(self.eligible())
        for changed in [dict(event="pull_request"), dict(head_branch="dev"),
                        dict(head_sha="b" * 40), dict(path="other.yml"),
                        dict(head_repository={"full_name": "someone/FantasyPerf"}),
                        dict(status="in_progress", conclusion=None),
                        dict(conclusion="failure"), dict(conclusion="cancelled")]:
            with self.subTest(changed=changed):
                self.assertFalse(self.eligible(runs=[self.ci_run(**changed)]))

    def test_every_matrix_job_must_be_present_and_successful(self):
        self.assertFalse(self.eligible(jobs=[]))
        for name in publish.REQUIRED_JOBS:
            jobs = self.jobs()
            self.assertFalse(self.eligible(jobs=[j for j in jobs if j["name"] != name]))
            for changed in [dict(conclusion="skipped"), dict(conclusion="failure"),
                            dict(status="in_progress"), dict(head_sha="b" * 40)]:
                with self.subTest(name=name, changed=changed):
                    altered = [dict(j, **changed) if j["name"] == name else j for j in jobs]
                    self.assertFalse(self.eligible(jobs=altered))

    def test_new_failed_run_overrides_old_success(self):
        self.assertFalse(self.eligible(runs=[self.ci_run(), self.ci_run(id=2, conclusion="failure")]))

    def test_git_head_is_validated_without_using_the_api(self):
        import subprocess
        response = subprocess.CompletedProcess([], 0, SHA + "\trefs/heads/main\n")
        with patch.object(publish.subprocess, "run", return_value=response), \
             patch.object(publish, "get", side_effect=AssertionError("REST not needed")):
            self.assertEqual(publish.head(), SHA)
            response.stdout = SHA + "\trefs/heads/dev\n"
            with self.assertRaises(ValueError):
                publish.head()

    def test_public_archive_never_receives_api_credentials(self):
        from unittest.mock import MagicMock
        with tempfile.TemporaryDirectory() as temp:
            token = Path(temp) / "read.token"
            token.write_text("test-only-secret")
            response = MagicMock()
            response.__enter__.return_value.read.return_value = b"archive"
            with patch.object(publish, "TOKEN", token), \
                 patch.object(publish.urllib.request, "urlopen", return_value=response) as fetch:
                publish.get(SHA, raw=True)
                request = fetch.call_args.args[0]
                self.assertNotIn("Authorization", request.headers)
                self.assertEqual(request.full_url,
                                 f"https://codeload.github.com/{publish.REPO}/tar.gz/{SHA}")

    def archive(self, extra=None):
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode="w:gz") as tar:
            for name in ["index.html", "LICENSE", "src/app.js", "src/style.css", ".git/config"]:
                item = tarfile.TarInfo("fantasyperf/" + name)
                item.size = 2
                tar.addfile(item, io.BytesIO(b"ok"))
            if extra:
                tar.addfile(extra)
        return stream.getvalue()

    def test_only_static_files_are_extracted(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            publish.extract_static(self.archive(), root)
            self.assertTrue((root / "src/app.js").is_file())
            self.assertFalse((root / ".git").exists())

    def test_reject_links_and_path_traversal(self):
        link = tarfile.TarInfo("fantasyperf/src/secret.js")
        link.type = tarfile.SYMTYPE
        link.linkname = "/etc/passwd"
        traversal = tarfile.TarInfo("fantasyperf/src/../../escape")
        for item in [link, traversal]:
            with self.subTest(name=item.name), tempfile.TemporaryDirectory() as temp:
                with self.assertRaises(ValueError):
                    publish.extract_static(self.archive(item), Path(temp))

    def test_failed_http_check_restores_previous_release(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            old = root / "releases" / ("b" * 40)
            old.mkdir(parents=True)
            (root / "current").symlink_to(old)
            with patch.object(publish, "ROOT", root), \
                 patch.object(publish, "head", return_value=SHA), \
                 patch.object(publish, "eligible", return_value=True), \
                 patch.object(publish, "get", return_value=self.archive()), \
                 patch.object(publish.urllib.request, "urlopen", side_effect=OSError("unavailable")):
                with self.assertRaises(OSError):
                    publish.publish()
            self.assertEqual((root / "current").resolve(), old.resolve())

    def test_changed_main_during_download_keeps_current_release(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            old = root / "releases" / ("b" * 40)
            old.mkdir(parents=True)
            (root / "current").symlink_to(old)
            with patch.object(publish, "ROOT", root), \
                 patch.object(publish, "head", side_effect=[SHA, "c" * 40]), \
                 patch.object(publish, "eligible", return_value=True), \
                 patch.object(publish, "get", return_value=self.archive()):
                publish.publish()
            self.assertEqual((root / "current").resolve(), old.resolve())

    def test_pending_ci_is_throttled_but_new_main_is_checked_immediately(self):
        with tempfile.TemporaryDirectory() as temp, \
             patch.object(publish, "ROOT", Path(temp)), \
             patch.object(publish, "head", side_effect=[SHA, SHA, "b" * 40]), \
             patch.object(publish, "eligible", return_value=False) as check:
            publish.publish()
            publish.publish()
            self.assertEqual(check.call_count, 1)
            publish.publish()
            self.assertEqual(check.call_count, 2)


if __name__ == "__main__":
    unittest.main()
