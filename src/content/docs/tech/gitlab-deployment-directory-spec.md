---
title: GitLab Omnibus 部署目录规范：配置、数据、日志与运行组件的边界
description: 以实测为基准梳理 GitLab 四类目录的职责边界、关键文件清单与 hook 部署位置。
pubDate: 2026-09-30
---

> 性质：现场实测版（du/ls 实测，两实例对照）｜版本：两台均为 gitlab-ce 13.12.15 Omnibus（el7）
> ⚠️ 凭据纪律：本文只写**路径**，`gitlab.rb` / `gitlab-secrets.json` / `initial_root_password` 的**内容值**一律不落

## 一、四类目录总览（两台对照）

| 类别 | 路径 | 外网 ksphere | 内网 gitlab28 | 说明 |
|------|------|--------------|---------------|------|
| ① 配置 | `/etc/gitlab/` | 数 KB 级（gitlab.rb 149K） | gitlab.rb 83K | **backup tar 不含**，需单独保护（见备份文档 R2） |
| ② 数据 | `</var/opt/gitlab>/` | **1.4T** | **88G** | git-data 为主 |
| ②′ 备份数据（内网自定义） | `<备份目录>/` | —（用默认路径） | **8.2T**（含 503G 残缺 tar） | gitlab.rb L308 指定 |
| ③ 日志 | `/var/log/gitlab/` | 7.1G | 638M | logrotate 内置轮转 |
| ④ 运行组件 | `/opt/gitlab/` | 2.1G | 2.1G | embedded 自带全家桶 |

磁盘余量：外网 / 4.9T 用 2.2T（45%）✅；内网 /data 10T 用 9.2T（**92% ⚠️**）。

## 二、① /etc/gitlab/（配置类，改前必备份）

**外网 ksphere 实测清单**：
```
gitlab.rb                 149242B  2024-09-03   ← 主配置（生效）
gitlab.rb1102             148966B  2023-11-02   ← 历史备份
gitlab.rb_20240903        149248B  2024-09-04   ← 历史备份
gitlab-secrets.json       19107B   2024-09-03   ← ★ 加密密钥（丢失=加密数据不可恢复）
initial_root_password      749B    2023-11-02   ← 初始 root 口令（装机遗留，建议核实后处理）
trusted-certs/            空
```

**内网 gitlab28 实测清单**：
```
gitlab.rb                 83774B   2026-06-02
gitlab.rb_20250523        150B     2025-05-23
gitlab.rb_20250603        83614B   2025-06-03
gitlab-secrets.json       19151B   2026-03-24   ← ★
ssh_host_*_key(s)         2025-05-24           ← SSH 主机密钥备份
```

**关键差异**（gitlab.rb 生效配置，路径级记录）：
- 内网 L308：`gitlab_rails['backup_path'] = "<备份目录>"`（外网全默认）
- 两台均有历史 .rb 备份习惯 ✅（建议统一为 `gitlab.rb_YYYYMMDD` 命名——内网已遵循）

## 三、② </var/opt/gitlab>/（数据类）

外网实测顶层：`git-data`（★ 仓库本体，repositories/ 29 个仓库目录）、`backups`（外网备份落点）、`postgresql`、`redis`、`gitaly`、`gitlab-rails`（uploads/artifacts/lfs 等）、`gitlab-shell`、`nginx`、`prometheus` 及各 exporter 数据、`ftp_backup_ls.sh`（运维脚本，与备份上传相关）。

内网差异：数据主体同样在此（88G），但**备份走 <备份目录>**（自定义）。

**运维口径**：
- 扩容/迁移只动 `git-data`（支持挂盘迁移后 `gitlab-ctl reconfigure`）
- `postgresql` 目录严禁直拷（热数据不一致），恢复走官方 rake 流程
- 排查占用：`du -sh </var/opt/gitlab>/* | sort -rh | head`

## 四、③ /var/log/gitlab/（日志类）

- 外网 7.1G / 内网 638M；logrotate 组件内置轮转（gitlab-ctl status 可见）
- 排障入口速查：`nginx/gitlab_access.log`（访问）、`gitlab-rails/production_json.log`（应用）、`gitaly/current`（git 操作）、`postgresql/current`（数据库）

## 五、④ /opt/gitlab/（运行组件）

- 两台均 2.1G；`embedded/` 自带 Ruby/PostgreSQL/Redis/NGINX 全家桶，**不做手动管理**
- `embedded/service/`：gitlab-rails（主应用）、gitlab-shell（★ hook 所在）、gitaly-ruby、grafana、mattermost（遗留，未启用）
- 常用二进制：`/opt/gitlab/bin/`（gitlab-ctl / gitlab-rake / gitlab-rails）
- **hook 路径**（本平台关键）：
  - HTTP(Gitaly) 推送生效位：`/opt/gitlab/embedded/service/gitlab-shell/hooks/pre-receive.d/pre-receive`
  - SSH 推送生效位：`/opt/gitlab/embedded/service/gitlab-shell/pre-receive.d/pre-receive`（实测外网此目录为空，当前仅 HTTP 位部署）

## 六、hook 现状核对（INC-002 结案 + md5 基线）

| 实例 | 文件 | md5 | PUSH_CHECK_API 指向 | 结论 |
|------|------|-----|---------------------|------|
| 外网 | hooks/pre-receive.d/pre-receive（21508B, 2026-08-24） | `8ec44fad6c45ef69556c19458b0ff18a` | `http://<审查服务主机>:8081/push-check` | ✅ **INC-002 已修复**（<内网审查节点> 仅存在于注释行） |
| 内网 | 同路径（md5 与外网不同属预期——网络段配置差异） | `31f15d9735bb40a5c9612b163be4aeba` | `http://<内网审查节点>:8081/push-check` | ✅ 符合内网设计 |

旁证备份件：外网另有 pre-receive.bak-20260825（hooks/pre-receive.d/）、pre-receive.bak.20260513142336、pre-receive-old、backup_hooks/pre-receive-20241029——hook 变更留痕习惯良好，建议沿用。
