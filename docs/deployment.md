# Gitea 部署方案

日常开发以 Gitea 为主仓库。向 `main` 提交 PR 后执行单元测试、Chromium / WebKit 测试及构建；指定审查者批准后才可合并。合并后验证对应提交，再部署静态产物 `dist/`。GitHub 同步暂不配置。

## 当前状态

- 工作流为 `.gitea/workflows/ci.yml`，使用仓库专属 `fantasyperf-ci` 容器 Runner，镜像为 `mcr.microsoft.com/playwright:v1.63.0-noble`。更新 Playwright 时需同步更新 Runner 镜像版本。
- 目标服务器通过 SSH 别名 `1003` 访问，已有 Gitea、Nginx 和宿主机 Runner。
- 仓库为 `Fantastair/FantasyPerf`，网站使用 4096 端口。
- CI 任务不得使用服务器现有的 `linux:host` 标签。新 Runner 应限制到本仓库，使用容器执行，不向任务挂载 Docker socket、部署目录或宿主机凭据。

## main 保护规则

- 禁止直接 push 和 force push。
- 至少一次批准，批准和合并权限限制到指定维护者。
- 新提交使旧批准失效；有拒绝审查、未完成的正式审查请求或分支落后时阻止合并。
- `Fantastair` 保留管理员强制合并特权，可为自己的 PR 豁免批准；此操作也可能绕过 CI，因此部署服务另行检查合并后的 CI 结果。
- 将实际 CI 运行报告的 `verify` 检查上下文设为必需，配置后用 PR 验证，不能仅凭工作流显示名猜测上下文。

PR 作者不能批准自己的 PR。目前只有一名维护者，自己的 PR 在检查成功后由管理员强制合并。新增其他维护者后，可关闭管理员绕过功能。Gitea 的管理员绕过设置作用于仓库管理员，并非只针对一个账号；不要额外授予不必要的管理员权限。

## 部署约束

仅部署已合并到 `main` 且检查成功的提交。部署需串行执行，并在切换前确认该提交仍是最新目标，避免旧任务覆盖新版本。每个提交使用独立版本目录，验证后原子切换 `current`，保留上一版本用于回滚。

网站仅提供静态文件，不运行项目开发服务器，不公开源码仓库或 `.git` 目录。项目文件和参考图仍由用户保存在浏览器或导出的 JSON 中。

部署权限不进入 PR 测试任务。GitHub 写入凭据以后配置，也只允许发布流程使用。

## 服务器运维

`fantasyperf-deploy.timer` 每 30 秒检查一次最新 `main` 的 **push** 工作流，要求 `.gitea/workflows/ci.yml` 的运行及 `verify` 任务成功。PR 上的成功结果不能替代合并后的检查。

发布进程使用独立的 `fantasyperf-deploy` 系统用户和仅可读公开仓库的凭据，从 Gitea 下载指定提交，按当前 `scripts/build.mjs` 的静态构建约定提取 `index.html`、`src/` 和 `LICENSE`。不会执行仓库代码，拒绝符号链接和路径穿越，并在切换后验证 HTTP 服务，失败自动恢复旧版本。构建约定变化时必须同步更新发布脚本。

部署位置为 `/srv/fantasyperf/releases/<commit>`，`current` 指向当前版本，`version.json` 显示已部署提交。版本目录暂不自动删除。

```sh
ssh 1003 'sudo systemctl status fantasyperf-runner fantasyperf-deploy.timer'
ssh 1003 'sudo journalctl -u fantasyperf-deploy -n 30 --no-pager'
ssh 1003 'sudo systemctl start fantasyperf-deploy'
```

`deploy/` 下的服务和配置是安装源文件，不会随普通网页部署覆盖服务器配置。运维修改需单独安装并验证。回滚时先停止定时器，再将 `current` 原子切换到已验证的旧版本；否则定时器会重新部署最新 `main`。恢复自动部署前应通过 PR 修复或回退代码。
