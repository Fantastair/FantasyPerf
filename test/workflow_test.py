"""CI gate and separation between public tests and internal deployment."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).parents[1]


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.text = (ROOT / '.github/workflows/ci.yml').read_text()
        headings = list(re.finditer(r'^  ([\w-]+):\s*$', self.text.split('jobs:', 1)[1], re.M))
        jobs = self.text.split('jobs:', 1)[1]
        self.jobs = {h.group(1): jobs[h.end():headings[i+1].start() if i+1 < len(headings) else len(jobs)]
                     for i, h in enumerate(headings)}

    def test_aggregate_fails_when_any_dependency_is_failed_or_skipped(self):
        verify = self.jobs['verify']
        self.assertIn('needs: [checks, browser]', verify)
        self.assertIn('if: ${{ always() }}', verify)
        self.assertIn('test "$CHECKS" = success && test "$BROWSERS" = success', verify)

    def test_matrix_shards_tests_and_keeps_other_jobs_running_after_failure(self):
        browser = self.jobs['browser']
        self.assertIn('browser: [chromium, firefox, webkit]', browser)
        self.assertIn('shard: [1, 2]', browser)
        self.assertIn('fail-fast: false', browser)
        self.assertIn('--fully-parallel', browser)  # Split tests even within one spec file.
        self.assertIn('--shard=${{ matrix.shard }}/2', browser)
        self.assertIn('browser (${{ matrix.browser }}, ${{ matrix.shard }}/2)', browser)

    def test_ci_runs_complete_checks_without_internal_server_access(self):
        for step in ['npm ci', 'npm test', 'python3 -m unittest discover -s test', 'npm run build']:
            self.assertIn(step, self.jobs['checks'])
        self.assertIn('contents: read', self.text)
        for unsafe in ['self-hosted', 'sudo ', 'ssh ', 'secrets.', 'fantasyperf-release', 'pull_request_target']:
            self.assertNotIn(unsafe, self.text)
        self.assertFalse((ROOT / '.gitea/workflows/ci.yml').exists())

    def test_polling_service_is_unprivileged_and_independent_of_gitea(self):
        service = (ROOT / 'deploy/fantasyperf-deploy.service').read_text()
        timer = (ROOT / 'deploy/fantasyperf-deploy.timer').read_text()
        for boundary in ['User=fantasyperf-deploy', 'ProtectSystem=strict',
                         'NoNewPrivileges=true', 'ReadWritePaths=/srv/fantasyperf']:
            self.assertIn(boundary, service)
        self.assertNotIn('gitea.service', service)
        self.assertIn('OnCalendar=*-*-* 03:00:00 Asia/Shanghai', timer)
        self.assertNotIn('OnUnitInactiveSec=', timer)
        self.assertNotIn('OnBootSec=', timer)
        self.assertIn('Unit=fantasyperf-deploy.service', timer)


if __name__ == '__main__':
    unittest.main()
