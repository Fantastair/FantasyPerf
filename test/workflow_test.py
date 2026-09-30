"""回归检查：发布与镜像同步只能由 main 的 push 运行在 verify 通过后触发。

Actions 是部署的唯一入口，因此工作流的门禁本身就是安全边界的一部分：
host job 绝不能检出仓库或执行仓库代码，否则 PR 只要指定 runs-on 标签就能拿到
宿主机权限。
"""
from pathlib import Path
import re
import unittest

WORKFLOW = Path(__file__).parents[1] / ".gitea/workflows/ci.yml"
JOB_HEADING = re.compile(r"^ {2}([A-Za-z0-9_-]+):\s*$")
PUSH_GUARD = "github.event_name == 'push' && github.ref == 'refs/heads/main'"


def job_blocks(text):
    blocks, current = {}, None
    for line in text.splitlines():
        match = JOB_HEADING.match(line)
        if match:
            current = match.group(1)
            blocks[current] = []
        elif current:
            blocks[current].append(line)
    return {name: "\n".join(lines) for name, lines in blocks.items()}


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.text = WORKFLOW.read_text(encoding="utf-8")
        self.jobs = job_blocks(self.text)

    def test_release_jobs_need_verified_main_push(self):
        for name in ("deploy", "mirror"):
            with self.subTest(job=name):
                block = self.jobs[name]
                self.assertIn("needs: verify", block)
                self.assertIn(PUSH_GUARD, block)
                self.assertIn("runs-on: fantasyperf-release", block)

    def test_release_jobs_never_run_repository_code(self):
        allowed = re.compile(
            r"sudo -n (systemctl start fantasyperf-(deploy|github-sync)\.service"
            r"|journalctl -u fantasyperf-(deploy|github-sync)\.service -n 40 --no-pager -o cat)$"
        )
        for name in ("deploy", "mirror"):
            with self.subTest(job=name):
                block = self.jobs[name]
                self.assertNotIn("uses:", block)
                self.assertNotIn("checkout", block)
                self.assertNotIn("npm", block)
                self.assertNotIn("python3", block)
                # 只允许白名单里的 sudo 调用。
                calls = [line.split(" || ")[0].strip()
                         for line in block.splitlines() if line.strip().startswith("sudo ")]
                self.assertTrue(calls)
                for call in calls:
                    self.assertRegex(call, allowed)

    def test_verification_job_still_runs_the_full_suite(self):
        block = self.jobs["verify"]
        self.assertIn("runs-on: fantasyperf-ci", block)
        for step in ("npm ci", "npm test", "npm run test:e2e", "npm run build"):
            self.assertIn(step, block)
        self.assertIn("python3 -m unittest discover -s test", block)

    def test_sudoers_whitelist_matches_workflow_calls(self):
        whitelist = (Path(__file__).parents[1] / "deploy/sudoers-fantasyperf-release").read_text(encoding="utf-8")
        calls = set()
        for name in ("deploy", "mirror"):
            for command in re.findall(r"sudo -n (.+?)(?: \|\||$)", self.jobs[name], re.MULTILINE):
                calls.add("/usr/bin/" + command.strip())
        for call in calls:
            with self.subTest(command=call):
                self.assertIn(call, whitelist)

    def test_no_polling_timers_remain(self):
        timers = list((Path(__file__).parents[1] / "deploy").glob("*.timer"))
        self.assertEqual(timers, [])


if __name__ == "__main__":
    unittest.main()
