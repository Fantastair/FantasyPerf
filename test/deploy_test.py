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
    def eligible(self, event="push", run_status="completed", run_conclusion="success",
                 job_status="success", path="ci.yml@refs/heads/main"):
        run = dict(id=1, head_sha=SHA, event=event, head_branch="main", path=path,
                   status=run_status, conclusion=run_conclusion)
        job = dict(name="verify", head_sha=SHA, status="completed", conclusion=job_status)
        def get(url):
            return {"jobs": [job]} if url.endswith("/jobs") else {"workflow_runs": [run]}
        with patch.object(publish, "get", side_effect=get):
            return publish.eligible(SHA)

    def test_only_verified_main_push_can_publish(self):
        self.assertTrue(self.eligible())
        # deploy job 就在这条 push 运行内部触发发布，此时运行仍在进行。
        self.assertTrue(self.eligible(run_status="in_progress", run_conclusion=None))
        self.assertTrue(self.eligible(run_status="running", run_conclusion=None))
        self.assertFalse(self.eligible(event="pull_request"))
        self.assertFalse(self.eligible(run_conclusion="failure"))
        self.assertFalse(self.eligible(run_conclusion="cancelled"))
        self.assertFalse(self.eligible(job_status="skipped"))
        self.assertFalse(self.eligible(run_status="in_progress", run_conclusion=None,
                                       job_status="in_progress"))
        self.assertFalse(self.eligible(path="other.yml@refs/heads/main"))

    def test_new_failed_run_overrides_old_success(self):
        runs = [dict(id=i, head_sha=SHA, event="push", head_branch="main",
                     path="ci.yml@refs/heads/main", status="completed", conclusion=conclusion)
                for i, conclusion in [(1, "success"), (2, "failure")]]
        job = dict(name="verify", head_sha=SHA, status="completed", conclusion="success")
        def get(url):
            return {"jobs": [job]} if url.endswith("/jobs") else {"workflow_runs": runs}
        with patch.object(publish, "get", side_effect=get):
            self.assertFalse(publish.eligible(SHA))

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


if __name__ == "__main__":
    unittest.main()
