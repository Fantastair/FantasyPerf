# GitHub CI 与内网拉取部署

GitHub 是开发主仓库：<https://github.com/Fantastair/FantasyPerf>。开发分支推送到 GitHub，创建 PR，检查通过后合并到 `main`。内网服务器通过出站 HTTPS 定期检查 GitHub，只发布最新 `main` 提交自身通过的 push CI。开发与测试无需连接内网。

## CI

`.github/workflows/ci.yml` 在面向 `main` 的 PR 和 `main` push 上运行：

- `checks`：Node.js 22，单元测试、Python 部署安全检查、静态构建。
- `browser`：Chromium、Firefox、WebKit，每个浏览器两个分片，共六个并行任务。Playwright 镜像版本必须与锁文件版本一致；`--fully-parallel` 允许单个 spec 内的测试分布到不同分片，各任务内部仍使用一个 worker。
- `verify`：始终执行，只有 `checks` 和所有浏览器分片成功才通过。失败时上传浏览器测试产物，保存七天。

任务运行在 GitHub 托管环境，只有仓库读取权限，不持有内网地址、SSH 密钥或部署凭据。建议在 GitHub Settings → Rules → Rulesets 中保护 `main`：要求 PR、禁止 force push，设置必需检查 `verify`。单维护者仓库应结合自己的审查流程设置批准数量。

## 发布门禁

服务器上的 `fantasyperf-deploy.timer` 每分钟检查一次，调用独立用户 `fantasyperf-deploy` 下的 `publish.py`：

1. `git ls-remote` 获取 GitHub 最新 `main` SHA，已部署时直接返回，不调用 REST API。
2. 查询该 SHA 对应的 `.github/workflows/ci.yml`、`push`、`main` 运行；仅认本仓库，采用最新运行的当前结果。
3. 整条运行必须已完成且成功，`checks`、六个浏览器分片、`verify` 必须全部存在、完成且成功。失败、取消、跳过、PR 运行均不发布。
4. 从 GitHub 下载固定 SHA 的公开源码归档，只提取 `index.html`、`src/`、`LICENSE`，拒绝链接和路径穿越，限制 32 MiB。不在服务器执行仓库代码。
5. 切换前再次确认 `main` 与 CI；原子切换 `/srv/fantasyperf/current`，通过 4096 端口检查首页及 `version.json`，失败恢复旧版本。

当前构建只是复制静态文件（`scripts/build.mjs`），发布提取遵循同一约定。构建方式改变时须同步更新受控发布脚本。版本保存在 `/srv/fantasyperf/releases/<SHA>`，暂不自动清理。锁防止并发发布。

公开仓库无需 API token。未通过或尚未开始的 CI 每两分钟查询一次，避免耗尽匿名 API 配额；限流时按 GitHub 提示等待，保留线上版本。多个服务共享出口时，可另配仅有本仓库 Actions 读取权限的 token，保存为 `/etc/fantasyperf/github-read.token`，权限 `root:fantasyperf-deploy 0640`。该文件不可进入 Git 或 CI。归档下载不携带 API token。

## 安装与迁移

服务器通过 `ssh 1003` 访问，已有 Nginx（4096 端口）与 `fantasyperf-deploy` 用户。首次安装须自行创建该无登录用户及站点目录，安装 `deploy/nginx.conf` 并校验 Nginx。以下在仓库源码目录执行：

```sh
sudo install -d -m 0755 /usr/local/lib/fantasyperf
sudo install -d -o fantasyperf-deploy -g fantasyperf-deploy -m 0755 /srv/fantasyperf
sudo install -m 0755 deploy/publish.py /usr/local/lib/fantasyperf/publish.py
sudo install -m 0644 deploy/fantasyperf-deploy.service deploy/fantasyperf-deploy.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fantasyperf-deploy.timer
```

迁移前备份旧发布脚本及相关 systemd 单元。停用旧 `fantasyperf-github-sync` 服务与两个仓库专用 Gitea Runner，撤销发布 Runner 的 sudo 白名单；防止旧 Gitea 主分支反向写回 GitHub。旧同步服务文件需移入备份后 mask。Gitea 服务和仓库数据保留，现有提交作为历史备份，不再接收日常开发 push。服务器不再依赖 Gitea 镜像，直接从 GitHub 拉取已通过的版本。

本地远程：`origin` 指向 GitHub，`gitea` 保留原内网地址。

```sh
git push -u origin <开发分支>
```

迁移 PR 合并后，还需等待合并提交在 `main` 的 push CI 成功，才会首次发布；PR CI 成功本身不会触发上线。`deploy/` 是受控安装源，普通网页部署不会更新服务器脚本或单元。运维修改必须单独安装。

## 检查与回滚

```sh
ssh 1003 'systemctl list-timers --all fantasyperf-deploy.timer'
ssh 1003 'sudo journalctl -u fantasyperf-deploy -n 30 --no-pager'
ssh 1003 'sudo systemctl start fantasyperf-deploy'  # 仍然检查所有门禁和重试间隔
ssh 1003 'curl -fsS http://127.0.0.1:4096/version.json'
```

需要保持旧版本时，先停止 timer，再等待或停止正在执行的部署服务，然后原子替换 `current` 指向已验证版本。恢复 timer 后会重新部署最新且 CI 已通过的 `main`；要持续回滚，应提交修复/回退 PR。网络、CI 或下载失败不会切换线上版本；HTTP 校验失败会自动还原。
