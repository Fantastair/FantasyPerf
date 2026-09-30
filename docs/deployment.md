# Gitea 部署方案

日常开发以 Gitea 为主仓库。向 `main` 提交 PR 后执行单元测试、Chromium / WebKit 测试及构建；指定审查者批准后才可合并。合并后由 Actions 在同一条运行里、`verify` 通过之后触发部署与 GitHub 单向同步，不再需要定时轮询。

## 当前状态

- 工作流为 `.gitea/workflows/ci.yml`，包含 `verify`（容器 Runner）、`deploy`、`mirror` 三个 job。详见「部署触发」。
- `verify` 使用仓库专属 `fantasyperf-ci` 容器 Runner，镜像为 `mcr.microsoft.com/playwright:v1.63.0-noble`。更新 Playwright 时需同步更新 Runner 镜像版本。
- `deploy` / `mirror` 使用仓库专属 `fantasyperf-release` **宿主机模式** Runner，只调用白名单里的 `systemctl`，不检出仓库、不执行仓库代码。
- 目标服务器通过 SSH 别名 `1003` 访问，已有 Gitea、Nginx 和宿主机 Runner。
- 仓库为 `Fantastair/FantasyPerf`，网站使用 4096 端口。
- CI 任务不得使用服务器现有的 `linux:host` 标签。`verify` 必须继续在容器里执行，不向任务挂载 Docker socket、部署目录或宿主机凭据；宿主机标签只给只做触发的发布任务。
- 服务器现状（2026-09-29）：`fantasyperf-release-runner` 已启用并注册到本仓库（标签 `fantasyperf-release`，宿主模式，用户 `fantasyperf-release`）；`fantasyperf-deploy` / `fantasyperf-github-sync` 仍为静态单元，只由 Actions 或人工 `systemctl start` 触发；两个轮询定时器已停用并删除，单元文件备份在 `/usr/local/lib/fantasyperf/disabled-timers/`。

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

部署权限和 GitHub 写入凭据不进入 PR 测试任务。

## 部署触发

部署与镜像同步都由 Actions 驱动，没有轮询定时器：

```
push 到 main
  └─ .gitea/workflows/ci.yml
       ├─ verify   runs-on: fantasyperf-ci      （容器 Runner：单元测试、Python 安全检查、浏览器测试、构建）
       ├─ deploy   needs: verify, 仅 main push, runs-on: fantasyperf-release
       │             └─ sudo -n systemctl start fantasyperf-deploy.service      → publish.py 发布静态站点
       └─ mirror   needs: verify, 仅 main push, runs-on: fantasyperf-release
                     └─ sudo -n systemctl start fantasyperf-github-sync.service → github_sync.py 推送 GitHub
```

- PR 的运行只会执行 `verify`；`deploy` / `mirror` 被 `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` 拦住。
- 宿主机 job 只写两行 `sudo -n systemctl start …`（加一行 `journalctl` 回显日志），由 `/etc/sudoers.d/fantasyperf-release` 逐字授权，**不检出仓库、不执行仓库代码**。因此 PR 即使指定 `runs-on: fantasyperf-release` 也拿不到发布能力，也没有任何凭据经过 Actions。
- 发布进程使用独立的 `fantasyperf-deploy` 系统用户和仅可读公开仓库的凭据，从 Gitea 下载指定提交，按当前 `scripts/build.mjs` 的静态构建约定提取 `index.html`、`src/` 和 `LICENSE`。不会执行仓库代码，拒绝符号链接和路径穿越，并在切换后验证 HTTP 服务，失败自动恢复旧版本。构建约定变化时必须同步更新发布脚本。
- `publish.py` 只认 `main` 的 push 运行里 `verify` 成功：deploy job 就在同一条运行内部，因此运行可能仍在进行，脚本以 `verify` job 的结果为准；运行已结束却不是 success（失败、取消）时一律不放行。
- 部署位置为 `/srv/fantasyperf/releases/<commit>`，`current` 指向当前版本，`version.json` 显示已部署提交。版本目录暂不自动删除。

### 一次性安装（服务器 root）

**上线顺序很重要**：`deploy` / `mirror` 需要 `fantasyperf-release` 标签的 Runner。请先安装 Runner 并确认它在线，再合并含这两个 job 的改动；否则推送到 `main` 的运行会停在「等待 Runner」，直至装上 Runner 后重新运行。切换期间旧的轮询定时器可继续保留作为兵库，确认 Actions 能正常发布后再按第 5 步停用。

```sh
# 1. 宿主模式 runner 专用用户（无登录 shell）
sudo useradd --system --home /var/lib/fantasyperf-release --create-home \
  --shell /usr/sbin/nologin fantasyperf-release

# 2. 发布与同步脚本、站点目录
sudo install -d -m 0755 /usr/local/lib/fantasyperf
sudo install -m 0755 deploy/publish.py deploy/github_sync.py /usr/local/lib/fantasyperf/
sudo install -d -o fantasyperf-deploy -g fantasyperf-deploy -m 0750 /srv/fantasyperf

# 3. 发布/同步单元、runner 配置、sudo 白名单
sudo install -m 0644 deploy/fantasyperf-deploy.service \
  deploy/fantasyperf-github-sync.service \
  deploy/fantasyperf-release-runner.service /etc/systemd/system/
sudo install -m 0644 deploy/release-runner.yaml /etc/fantasyperf/release-runner.yaml
sudo install -m 0440 deploy/sudoers-fantasyperf-release /etc/sudoers.d/fantasyperf-release

# 4. 在 仓库 → 设置 → Actions → Runner 生成注册令牌后注册（标签必须与 workflow 一致）
sudo -u fantasyperf-release /usr/local/bin/fantasyperf-runner register --no-interactive \
  --instance http://127.0.0.1:3000 --token <REGISTRATION_TOKEN> \
  --name fantasyperf-release --labels fantasyperf-release:host

# 5. 启用宿主机 runner，停用并删除旧的轮询定时器
sudo systemctl daemon-reload
sudo systemctl enable --now fantasyperf-release-runner.service
sudo systemctl disable --now fantasyperf-deploy.timer fantasyperf-github-sync.timer 2>/dev/null
sudo rm -f /etc/systemd/system/fantasyperf-deploy.timer /etc/systemd/system/fantasyperf-github-sync.timer
sudo systemctl daemon-reload
```

安装后自检：

```sh
sudo -l -U fantasyperf-release                             # 应列出四条白名单命令，且不提示密码
systemctl list-timers --all | grep fantasyperf              # 安装完成后应无输出（不再轮询）
ssh 1003 'sudo systemctl status fantasyperf-release-runner' # active (running)
```

`deploy/` 下的服务和配置是安装源文件，不会随普通网页部署覆盖服务器配置。运维修改需单独安装并验证。

## 服务器运维

部署由 Actions 触发，日志同时在 Actions 的 `deploy` / `mirror` job 与服务器 journal 里。需要人工介入时：

```sh
ssh 1003 'sudo systemctl status fantasyperf-release-runner fantasyperf-deploy fantasyperf-github-sync'
ssh 1003 'sudo journalctl -u fantasyperf-deploy -n 30 --no-pager'
ssh 1003 'sudo systemctl start fantasyperf-deploy'        # 手动重试（等同 deploy job 的动作）
```

回滚：现在没有定时轮询，回滚只需要把 `current` 原子切换到已验证的旧版本；在下一次 push 到 `main` 触发 `deploy` 之前不会被覆盖。重新部署最新 `main` 时，在 Actions 里重跑 `deploy` job（或手动 `systemctl start fantasyperf-deploy`）即可。

发布失败不会影响线上站点：发布路径先写入新版本目录，只有在 HTTP 校验通过后才切换 `current`。

## GitHub 同步

目标为 `https://github.com/Fantastair/FantasyPerf`。首次设置需创建空的公开仓库，在该仓库的 Settings → Deploy keys 中添加服务器生成的公钥，并启用 Allow write access。私钥仅保存在服务器 `/var/lib/fantasyperf-sync/github_key`，不进入 Git。

`ci.yml` 的 `mirror` job 在 `verify` 成功后触发 `fantasyperf-github-sync.service`（同样只在 `main` 的 push 运行里执行）。只有全部检查成功，才推送该提交及其历史到 GitHub 的 `main`。不会同步开发分支或标签，不使用强制推送；GitHub 出现独立提交时任务会失败并保留两端数据，由维护者处理历史差异。

同步与网站部署是两个独立 job，各自重试，同步失败不会影响网站。日志可通过 Actions 的 `mirror` job 或以下命令查看：

```sh
ssh 1003 'sudo journalctl -u fantasyperf-github-sync -n 30 --no-pager'
ssh 1003 'sudo systemctl start fantasyperf-github-sync'   # 手动重试
```

GitHub 连接使用标准 SSH 22 端口，严格校验 GitHub 官方主机密钥。最后一次成功推送记录保存在 `/var/lib/fantasyperf-sync/status.json`。只有完成 GitHub 公钥授权后才能成功同步；安装服务文件不代表授权已完成。
