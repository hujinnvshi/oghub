---
title: GitLab 备份体系实测复盘：一份高危误判与三条故障链
description: 两个 GitLab 实例的备份实测过程：本地备份、异机上传、完整性校验，以及一次把纯 tar 当 gzip 校验导致的错误告警。
pubDate: 2026-09-30
---

> 性质：现场实测核对版（9 步只读实测，非文档搬运）｜实测人：ZCode 会话
> 实例：外网 ksphere（<外网GitLab>）+ 内网 gitlab28（<内网GitLab>），均为 **gitlab-ce 13.12.15**（el7.rpm，Omnibus 安装）
> 纪律遵守：全程只读（ls/grep/md5sum/df/tar -tzf），未执行备份/恢复/重启；凭据不落本文（FTP/RSYNC 口令仅存敏感清单）

## 一、结论速览（风险分级）

| 实例 | 本地备份 | 异机备份 | 新鲜度 | 完整性 | **综合评级** |
|------|---------|---------|--------|--------|-------------|
| 外网 ksphere | ✅ 周日 00:00，默认路径，5 份轮转 | ✅ 周日 08:00 FTP → <外网备份服务器>，近 6 次连续成功 | 最新 09-27（3 天前） | ✅ tar 头部结构完整 | 🟡 **基本健康，两项隐患**（见 §五） |
| 内网 gitlab28 | ✅ **本地 4 份 tar 结构完整可读**（09-05/12/19/26，含尾部条目；09-26 rake 收尾报错但产物完整，见 §三） | ❌ **上传链路断了 7 个月**（最近成功 2026-02-21；rsync 未安装，错误码 127） | 最新 09-26（3 天前） | ✅ `tar -tf` 头尾验证通过（⚠️ 校验方法见 §七勘误） | 🟡 **本地有备份、异机断链 7 个月（中高危）** |

## 二、外网 ksphere 备份体系（健康面）

**配置**（gitlab.rb 无 backup_* 生效配置 → 全默认）：
- backup_path = `</var/opt/gitlab>/backups`（rails runner 实测确认）
- keep_time = 0（外网配置层不限保留，靠 keep5 清理脚本；注意内网为 1209600=14 天，见 §三）

**任务链**（root crontab，三条）：
```
0 0  * * 0   gitlab-rake gitlab:backup:create                    # 周日 00:00 生成
0 8  * * SUN  </var/opt/gitlab>/uploadbackuptar.sh >> /var/log/upload_to_ftp.log  # 周日 08:00 异机上传
0 10 * * SUN  /root/CleanBackupFile/cleanup_backups_keep5.sh    # 周日 10:00 清理保留 5 份
```

**本地现状**（09-30 实测）：5 份 tar（08-23 ~ 09-27，每份 229-232G，合计 1.2T）；磁盘 / 4.9T 用 2.2T（45%）——余量充足。

**异机上传**：`uploadbackuptar.sh` 用 FTP 上传**最新一份**到 **<外网备份服务器>**（FTP 账号 gitlab，口令见敏感清单）。`upload_to_ftp.log` 实测：08-16 / 08-23 / 08-30 / 09-06 / 09-20 / 09-27 **连续 6 次成功**。
> ⚠️ 注：09-13 与 09-27 之间实际间隔两周（09-13 无成功记录），建议核对 FTP 端留存与日志全量。

**完整性抽检**：09-27 最新 tar 列表验证通过（⚠️ 方法勘误见 §七：GitLab 13.12 备份为**纯 tar 未压缩**，正确命令是 `tar -tf`；`-tzf` 靠 GNU tar 自动回退碰巧通过）。未做内容级校验（restore 演练单独立项）。

## 三、内网 gitlab28 备份体系（失效面，三条故障链）

**配置**：gitlab.rb L308 `gitlab_rails['backup_path'] = "<备份目录>"`（自定义到数据盘）。

**本地备份实际健康（09-30 勘误后结论）**：
- 4 份主 tar（09-05/12/19/26，各 503G）`tar -tf` 实测：头部条目正常 + **尾条目 backup_information.yml 可读**（顺序流读到末尾=全包数据块完整）→ **结构完整**
- `gitlab_backup.log` 09-26 有 `creating archive failed`（rake 收尾报错）但产物可读——报错发生在收尾环节（permission/chdir 类），不影响 tar 本体；建议下个备份周期观察是否复现
- 本地保留：gitlab.rb **L1955** `backup_keep_time=1209600`（14 天）滚动保留，2~4 份属设计行为

**故障 ② 上传链路断链（唯一确凿故障）**：
- `/root/gitlab_backup_upload.sh` 设计：rsync 到 **<内网备份服务器>:/backup/gitlab**
- 实测 **rsync 未安装**（`which rsync` 无）→ 错误码 127；lftp 已装但当前分支不走
- `/var/log/localbackup/backup_upload.log`：历史成功 **7 次，最近成功 2026-02-21**——**异机备份中断 7 个月+**
- ⇒ 风险实质：本地单点有备份（含磁盘单点风险），**异机副本缺失 7 个月**；远端 <内网备份服务器> 上存有 2 月前副本（待核实留存）

## 四、恢复要点（引用官方口径，不自行发挥）

Omnibus 恢复三要素（缺一不可）：
1. 备份 tar（`gitlab-rake gitlab:backup:restore BACKUP=<时间戳>`，要求**同版本 GitLab**——两台均为 13.12.15，互为恢复目标时版本匹配 ✅）
2. `/etc/gitlab/gitlab-secrets.json`（**backup tar 不含**，必须单独保护——见下）
3. `/etc/gitlab/gitlab.rb`（同上单独保护）
官方文档：docs.gitlab.com/ce/raketasks/backup_restore.html

## 五、风险清单与建议（按优先级）

| # | 风险 | 等级 | 建议 |
|---|------|------|------|
| R1 | 异机备份断链 7 个月（本地虽有 4 份完整 tar 但同机单点） | 🔴 高 | ①修上传链（装 rsync 或切 lftp 分支——lftp 已装改动最小）；②修完手动触发一次上传补齐异机副本；③核实远端 <内网备份服务器> 留存与 2 月前旧副本可用性；④连续两周验证日志；⑤防磁盘高水位（clean_disk.sh 定时化）+ 观察 09-26 类 rake 收尾报错是否复现 |
| R2 | **两台的 gitlab-secrets.json 与 gitlab.rb 均无异地副本**（备份 tar 不含二者；丢失即双因子/CI 变量等加密数据不可恢复） | 🔴 高 | 将 /etc/gitlab/gitlab.rb + gitlab-secrets.json 纳入每周异机上传脚本（小文件，秒级） |
| R3 | 外网异机走 FTP 明文协议（凭据+230G 数据明文传输） | 🟡 中 | 内网环境可接受；长期改 rsync over ssh / scp。**勿在本文档记录口令** |
| R4 | 外网 09-13 疑似漏传（日志无当日成功记录） | 🟡 中 | 核对 <外网备份服务器> FTP 端实际留存份数 |
| R5 | keep_time=0 依赖脚本清理（外网 keep5 有效；内网清理从未生效） | 🟢 低 | 内网修复后统一；可选 gitlab.rb 设 backup_keep_time 双保险 |
| R6 | 无恢复演练记录（两台） | 🟡 中 | 单独立项（涉及停机窗口），建议先在测试机验证 |

## 六、实测命令留痕（复测用）

```bash
# 配置与任务
grep -nE "backup_path|backup_keep_time" /etc/gitlab/gitlab.rb
/opt/gitlab/bin/gitlab-rails runner 'puts Gitlab.config.backup.path'   # 实测生效值
crontab -l | grep -iE 'backup|gitlab|ftp|upload'
# 现状
ls -lht </var/opt/gitlab>/backups/ | head        # 外网
ls -lht <备份目录>/ | head            # 内网
df -h /data
# 异机证据
tail /var/log/upload_to_ftp.log                # 外网
tail /var/log/localbackup/backup_upload.log    # 内网
# 完整性（只读）
tar -tzf <最新tar> | head
```


## 七、勘误与方法论教训（2026-09-30 当日三轮修正）

本文件经历三次修正，教训值得留痕：

1. **勘误一（磁盘归因）**：df 92%→30% 回落初判"僵尸句柄虚占"，实为**用户手动清理备份包**——归因前应先问"最近谁动过"。
2. **勘误二（损坏误判，最严重）**：用 `tar -tzf`（gzip 参数）校验**纯 tar** 文件，GNU tar 打 stderr 警告后自动回退按纯 tar 读——外网碰巧 exit 0 判 ✅、内网被 stderr 文本误导判 ❌，得出"三份全坏、零有效备份"的错误高危结论。**被用户质疑"他们不是tar格式的吗"后用魔数对照（两台前 16 字节一致：`repositories/...` 纯 tar 头）+ 正确命令 `tar -tf` 复测推翻**。
3. **方法论**：① 校验命令必须匹配真实格式（`.tar` 扩展名 ≠ gzip，GitLab 13.12 备份是纯 tar）；② **stderr 文本不能当退出码判据**，判定用 exit code + 正向证据（如能读到尾条目）；③ 对照组实验（同版本另一台）能快速识破方法性错误。

**复测正确命令**（替代 §六 中 tar -tzf）：
```bash
tar -tf <备份.tar> 2>/dev/null | head    # 头部可列
timeout 300 tar -tf <备份.tar> 2>/dev/null | tail -1   # 尾条目=backup_information.yml 即结构完整
```


## 八、异机备份修复实施记录（2026-09-30 当日，用户授权）

**通道切换：rsync → lftp-FTPS**（原 rsync over ssh 对 Serv-Up 服务器从未具备条件）：
- FTP 账户验证：`331 → 230` 认证成功序列 + 64KB 小文件试传/列表/清理全通
- `/root/gitlab_backup_upload.sh` 重写为 lftp-FTPS 版（保留日志/锁/僵尸清理框架；超时 1h→6h；校验改本地 vs 远端字节数）；原版备份为 `gitlab_backup_upload.sh.bak-rsync-20260930`
- crontab 无需改动（路径不变，每周六 10:00 照跑）

**真实补传（503G @ 09-26 备份）**：
- 实测链路 ~600-950MB/s；**数据连接周期性被掐**（每 ~17-20GB 断一次，疑防火墙 TTL/Serv-U 会话限制）
- 部署 `/root/upload_watchdog.sh` 看门狗：每 60s 探远端字节，两轮不涨自动 `pkill` 并重启上传（`put -c` 断点续传），直至远端=本地字节
- 首次停滞在 17.2GB（恰好 16GiB 整，是否 Serv-U 限制待长期观察）；watchdog 接管后 80G→97G 波动推进
- **遗留观察项**：①补传完成后核对 watchdog.log 终态「字节一致」；②下个周六 cron 自动跑时验证脚本自带重试是否足够，不足则把重试循环内嵌进上传脚本；③数据连接被掐根因（防火墙/Serv-U）待网络侧确认

**运维教训（本轮新增）**：
- `pkill -f <词>` 会匹配承载命令自身的 shell 造成自杀断连——用 `pkill -x <精确名>`
- 大文件跨网传输必配「断点续传 + 字节级看门狗」，不能信任单次连接
