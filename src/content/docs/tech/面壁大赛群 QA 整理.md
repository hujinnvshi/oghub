---
title: 面壁大赛群 QA 整理
description: 面壁 MiniCPM 昇腾挑战赛参赛群常见问题与官方回答整理。
pubDate: 2026-08-07
---

# 面壁大赛群 QA 整理

**【问题】****  【官方回答】****  【客户端排查建议】**

**Q1\. DevEnv\_493092 的 user\_data 丢了，疑似被挂载到 deleted**

**【官方回答】**（暂无官方回复，请参考下方排查建议或联系官方处理）

**【客户端排查建议】**

- 检查挂载状态：执行 df \-h 查看 user\_data 目录是否仍然挂载在正确位置。

- 检查目录内容：执行 ls \-la /home/ma\-user/work/user\_data/ 确认数据是否真的丢失，还是仅挂载路径变化。

- 检查环境状态：在管理页面确认该环境是否被意外标记为「已删除」状态。

- 查看系统日志：执行 dmesg \| tail \-50 查看是否有存储相关的内核错误。

- 若确认数据丢失，记录环境名称 DevEnv\_493092 和公网 IP，联系官方协助恢复。

- 预防建议：后续重要数据请同步保存到 shared\_assets/ 共享空间，避免仅依赖 user\_data。



**Q2\. 线上 container 提示 GlusterFS 故障，数据丢了……**

**【官方回答】**（暂无官方回复，请参考下方排查建议或联系官方处理）

**【客户端排查建议】**

- 检查 GlusterFS 挂载状态：执行 mount \| grep gluster 确认存储是否正常挂载。

- 查看系统日志：执行 dmesg \| grep \-i gluster 查找 GlusterFS 相关错误信息。

- 检查容器状态：执行 docker ps \-a 或 kubectl get pods 查看容器运行状态。

- 尝试重新挂载：若挂载点丢失，可尝试 mount \-a 重新挂载所有文件系统。

- 若无法恢复，记录环境名称和公网 IP，联系官方排查 GlusterFS 后端故障。

- 预防建议：关键模型权重和数据及时备份到 shared\_assets/ 共享目录。



**Q3\. 418 问题怎么解决**

**【官方回答】 **提供公网 IP 地址、环境名称，联系我们处理。

![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=MDdkOWU5NmFkMjVlZGNhMDZhNzEyZjUxOWI0YWFiZjBfYzQ5OGZlMGQ5NzM0MDAwODQ1OGZlMDk4MGY1NTk2ZTNfSUQ6NzY2ODYwODIwMjY0OTYxOTc1Nl8xNzg2MDY5ODExOjE3ODYxNTYyMTFfVjM)



**【客户端排查建议】**

- 清除浏览器缓存和 Cookie 后重新访问页面。

- 尝试使用浏览器无痕/隐私模式（Chrome: Ctrl\+Shift\+N）访问。

- 检查网络代理设置：关闭 VPN、代理软件后重试。

- 更换网络环境测试：切换到手机热点或其他网络确认是否为网络问题。

- 查询当前公网 IP：在终端执行 curl ifconfig\.me 或 curl cip\.cc。

- 若以上均无效，截图报错页面，提供公网 IP 和环境名称联系官方处理。



**Q5\. ssh: Could not resolve hostname openlibing\-devenv\-858221: 不知道这样的主机。过程试图写入的管道不存在。请问这个报错咋办**

**【官方回答】 **提供「开发环境名称」、「SSH 版本」，需要我们定位。

**【客户端排查建议】**

- 确认环境运行状态：在管理页面确认该开发环境是否处于「运行中」状态。

- 检查 SSH 配置：执行 cat \~/\.ssh/config 查看 SSH 配置是否正确。

- 尝试使用 IP 直接连接：从管理页面获取环境 IP，用 ssh user@\<IP\> 替代 hostname 连接。

- 检查本地 DNS 设置：执行 nslookup \<hostname\> 确认域名是否能解析。

- 检查 SSH 版本：执行 ssh \-V，确认使用较新版本的 SSH 客户端。

- 若仍无法连接，记录环境名称和 SSH 版本，联系官方定位 DNS 解析问题。



**Q6\. 请问为什么 WebIDE 会 403 呢**

**【官方回答】 **前提：平台资源需要外网或者蓝区访问。若访问网站页面提示 403：提供公网 IP、个人信息、参赛信息，联系我们处理。若连接环境提示 403：尝试浏览器无痕模式或者清除浏览器缓存访问，若仍不行则提供环境名称给我们排查定位。



![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=MDRmNDc2ZmM0OWZhYWFjYTQwYjk4NzEyNjM2Y2JlZWVfMGVjODA2ODUxZjFjMjc0NTNjYjZlNWMwYzhlYWE5YTZfSUQ6NzY2ODYwNzE2MTcxMDM0OTI0Ml8xNzg2MDY5ODExOjE3ODYxNTYyMTFfVjM)

**【客户端排查建议】**

- 确认网络环境：确保在可访问外网或蓝区的网络下使用平台。

- 尝试无痕模式：Chrome 按 Ctrl\+Shift\+N 打开无痕窗口访问。

- 清除浏览器缓存和 Cookie：在浏览器设置中清除站点数据后重试。

- 关闭代理/VPN：检查是否开启了代理软件，关闭后重试。

- 更换浏览器：尝试使用 Chrome / Edge / Firefox 不同浏览器访问。

- 重新登录账号：退出后重新登录，刷新会话状态。

- 若以上均无效，提供公网 IP、环境名称和参赛信息联系官方处理。



**Q7\. 打开 WebIDE 看到 502 Bad Gateway**

**【官方回答】 **页面白屏或者 502，提供环境名称，联系我们处理。

![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=NmNmYjljMzFjMGE4OWM2ZTEyYWNmNjNlYjBlMjIzMjFfYWFiMDhlZGIzMjgwMTAwYjMwMGRiY2UyMGE0ZTljZmFfSUQ6NzY2ODYwNzA5ODk1OTQ2NTcxNF8xNzg2MDY5ODExOjE3ODYxNTYyMTFfVjM)



**【客户端排查建议】**

- 强制刷新页面：按 Ctrl\+F5 强制刷新，排除浏览器缓存问题。

- 等待后重试：502 通常是临时服务波动，等待 1\-2 分钟后重新访问。

- 检查环境状态：在管理页面确认环境是否处于正常运行状态。

- 清除浏览器缓存：清除后重新打开 WebIDE。

- 尝试重连环境：在管理页面点击连接，尝试不同的连接方式。

- 若持续 502，提供环境名称联系官方排查后端服务。



**Q8\. 比赛环境是 CANN 9\.0\.0 还是 9\.1\.0？9\.1 的话已经完成的工作有哪些迁移方式？**

**【官方回答】**

CANN 9\.0\.0 升级成 9\.1\.0 beta1 方法如下：

1. 在机器上通过 uname \-a 确认自己的机器是 aarch64 还是 x86\_64。



2. 在 https://www\.hiascend\.com/developer/download/community/result?module=cann\&cann=9\.1\.0\-beta\.1下载需要的 CANN 版本软件包（建议下载Ascend\-cann\-toolkit\_9\.1\.0\-beta\.1\_linux\-aarch64\.run）。

![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=ODhhNGJkZTQ0YzI4ODgzOGFlMDFkNmM0MzQ4ZjdkOGZfNGMzZDk0YmE1YmNiZGRiZmEwYzUyNWYxNWE5Y2ZlOWNfSUQ6NzY3MDM2MjcwNTEzNTkxMzkyNF8xNzg2MDY5ODExOjE3ODYxNTYyMTFfVjM)

3. 先赋予 run 包执行权限：chmod \+x xxx\.run

4. 用 run 包执行时添加更新参数：\./xxx\.run \-\-upgrade

5. 出现类似 \[xxx upgrade success\] 即更新成功。

6. 用命令【sed \-i 's\|/usr/local/Ascend/cann\-9\.0\.0\|/usr/local/Ascend/cann\-9\.1\.0\-beta\.1\|g' \~/\.bashrc】更新一下\.bashrc确保每次启动终端都会执行cann的set\_env\.sh脚本

7. 不管是升版本还是降版本均可用这个方法。

**【客户端排查建议】**

- 确认当前 CANN 版本：cat /usr/local/Ascend/ascend\-toolkit/latest/version\.cfg

- 确认机器架构：uname \-a（区分 aarch64 / x86\_64）

- 确认 NPU 驱动版本：npu\-smi info，确保驱动与目标 CANN 版本兼容

- 备份当前环境数据：将重要代码和数据同步到 shared\_assets/ 共享空间

- 下载对应架构的 CANN run 包，执行 chmod \+x 赋予执行权限

- 执行 \./xxx\.run \-\-upgrade 进行版本升级/降级

- 升级后验证：python \-c "import acl; print\('ACL OK'\)" 确认 CANN 可用

- 若升级失败，查看 /var/log/ascend\_seclog/ 下的日志定位原因



**Q9\. 可以帮我看下这个开发环境吗？试了 WebIDE 和 VSCode 都连接不上，想删了新建也删不掉。DevEnv\_928461**

**【官方回答】**（暂无官方回复，请参考下方排查建议或联系官方处理）

**【客户端排查建议】**

- 检查环境状态：在管理页面确认 DevEnv\_928461 是否处于「运行中」状态。

- 尝试强制刷新管理页面后重新点击删除按钮。

- 清除浏览器缓存后重试删除操作。

- 检查网络连通性：在终端执行 ping \<环境IP\> 确认网络是否可达。

- 尝试更换连接方式：如果 WebIDE 和 VSCode 都不行，尝试 SSH 命令行连接。

- 若环境卡在异常状态无法删除，提供环境名称 DevEnv\_928461 联系官方协助删除。



**Q10\. 请问容器初始化发现驱动不识别，是否可以重置系统呢？**

**【官方回答】**（暂无官方回复，请参考下方排查建议或联系官方处理）

![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=NjAxMjZjODg0MGZlMGI1ODU3NmJmMzRjYTRhMmFjMzZfZDZmNzQzZjQ0MGJlMmZjNzA0OGVmNzcxN2RkMDU0MjJfSUQ6NzY2ODYwNzAwODk5MTYxMjE2OV8xNzg2MDY5ODExOjE3ODYxNTYyMTFfVjM)



**【客户端排查建议】**

- 检查 NPU 驱动状态：执行 npu\-smi info 确认 NPU 是否被识别。

- 查看驱动日志：执行 dmesg \| grep \-i ascend 查找驱动相关错误。

- 检查 CANN 与驱动版本兼容性：确认 CANN 版本和 NPU 驱动版本是否匹配。

- 检查内核版本：执行 uname \-r，确认内核是否与驱动兼容。

- 尝试销毁当前环境后重新创建（选择与官方推荐一致的镜像和 CANN 版本）。

- 若重创后仍不识别，截图 npu\-smi 输出和报错信息，提供环境名称联系官方。



**Q11\. user\_data 目录的数据不能持久保存吗？为什么断开链接了但没删环境，重新链接之后 user\_data 空了？**

**【官方回答】**（暂无官方回复，请参考下方排查建议或联系官方处理）

**【客户端排查建议】**

- 确认环境未被删除：在管理页面确认环境仍存在，只是断开了连接。

- 检查挂载点：执行 df \-h 和 mount \| grep user\_data 确认存储是否正常挂载。

- 检查数据目录：执行 ls \-la /home/ma\-user/work/user\_data/ 确认文件是否存在。

- 查看隐藏文件：执行 ls \-laR /home/ma\-user/work/ 查看完整目录结构。

- 检查是否有多个挂载点冲突：执行 mount 查看是否有重复挂载导致数据被遮盖。

- 若数据确实丢失，提供环境名称联系官方排查存储问题。

- 预防建议：重要数据请保存到 shared\_assets/ 而非 user\_data，避免数据丢失风险。



**Q12\. 我今天也是连不上，DevEnv\_642647**

**【官方回答】**（暂无官方回复，请参考下方排查建议或联系官方处理）

![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=YmM1MzY2MGEyNGU3MTA4N2I5NTcyYmMyMWFhZGExMWFfMzQ4ZTRlOTgzMzNlZTk4ZTZkZTFmZWQ2M2RjYWI3OGFfSUQ6NzY2ODYwNjk1NDAyNjA2MDc4MV8xNzg2MDY5ODExOjE3ODYxNTYyMTFfVjM)



**【客户端排查建议】**

- 确认环境状态：在管理页面确认 DevEnv\_642647 是否处于「运行中」状态。

- 尝试重连环境：在管理页面点击连接按钮，选择不同的方式尝试重新连接。

- 检查网络连通性：在终端执行 ping \<环境IP\> 确认网络是否可达。

- 尝试不同连接方式：依次尝试 WebIDE、VSCode Remote\-SSH、终端 SSH 连接。

- 检查本地网络：确认本地网络稳定，无防火墙/代理阻断。

- 若仍连不上，截图报错信息，提供环境名称 DevEnv\_642647 联系官方排查。



**Q13\. 报异常**

**【官方回答】 **提供公网 IP 地址、开发环境名称，联系我们处理。

![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=MDk4YzU3N2EwYzg4M2FkNWZhZjY2NDQwNGFmZjRkYmZfOTg1ZDk3NjhiYmQ0MTZhZGYzMzMzYTZjOThhMmU1NGVfSUQ6NzY2ODYwNjg5OTQ3NDIyMjAzN18xNzg2MDY5ODExOjE3ODYxNTYyMTFfVjM)

![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=OGZiZWM2Y2QzZDA5MmVlMDc0NDMyMTNkMzFjMWE0MjJfYTQ3ZjI1NTZkZjUyYTBhMzJhMzRlYzVjMzMxOWY2NDlfSUQ6NzY2ODYwNzMyMzU4NTM5OTc3OF8xNzg2MDY5ODExOjE3ODYxNTYyMTFfVjM)



**【客户端排查建议】**

- 截取完整的异常报错信息（包括错误码、堆栈等）。

- 检查环境运行状态：在管理页面确认环境是否正常运行。

- 尝试重连环境：点击连接后观察异常是否消失，或者换别的方式连接。

- 提供环境名称、公网 IP 和完整报错截图，联系官方处理。



**Q14\. 这个一直显示「连接中」，然后无法连接是为什么呢？等了 5 分钟了。DevEnv\_524700**

**【官方回答】 **提供开发环境名称，联系我们排查。

![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=ODMyNTE0ZmEzZTllNzI3ZWJmZWFmNjFhYjI3MzdjNjFfYTVmZjQ3MTEyYjBhZDgwN2MwYmE2MTBhNjI3ZThiYjlfSUQ6NzY2ODYwNjg2MDUxNzI2NDM0M18xNzg2MDY5ODExOjE3ODYxNTYyMTFfVjM)



**【客户端排查建议】**

- 继续等待 3\-5 分钟：有时资源调度需要较长时间，耐心等待看是否自动恢复。

- 取消连接后重新尝试：点击取消按钮，等待 30 秒后重新点击连接。

- 检查网络稳定性：确认本地网络无波动，尝试切换网络后重试。

- 尝试更换连接方式：若 WebIDE 卡住，尝试 VSCode 或 SSH 连接。

- 检查环境资源状态：确认环境是否处于「创建中」或「异常」状态。

- 若持续无法连接，提供环境名称 DevEnv\_524700 联系官方排查。



**Q15\. 开了个 4 卡的机器，但是环境一直在创建。能不能取消了呢？DevEnv\_748981**

**【官方回答】**（暂无官方回复，请参考下方排查建议或联系官方处理）

![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=ZTk0MzgzMDJkMDYzY2I0YmI0YTIxYTQzNTM0NTZkMzBfNzViNWRjMmI0YjRhZTU5YmMzNjMzZDY4ZmRkNjdiMTJfSUQ6NzY2ODYwNjgwMjY1MzYxMzMwN18xNzg2MDY5ODExOjE3ODYxNTYyMTFfVjM)



**【客户端排查建议】**

- 继续等待 5\-10 分钟：4 卡资源创建通常比单卡更慢，多卡调度需要时间。

- 检查资源配额：在管理页面确认卡时配额是否足够支撑 4 卡环境。

- 尝试在管理页面取消创建：查看是否有「取消」或「删除」按钮。

- 若无法取消：等待创建超时自动失败后，资源会自动释放。

- 若卡时持续消耗，提供环境名称 DevEnv\_748981 联系官方协助取消。

- 后续建议：开发阶段先用 1 卡环境，需要多卡测试时再创建 4 卡环境，节省卡时。



**Q16\. 无法正常连接到 VSCode，链接报错：连接环境失败: Client network socket disconnected before secure TLS connection was established**

**【官方回答】**（暂无官方回复，请参考下方排查建议或联系官方处理）

**【客户端排查建议】**

- 检查网络稳定性：TLS 握手失败通常是网络波动导致，尝试切换网络后重试。

- 更新 VSCode：确保使用最新版本的 VSCode（Help → Check for Updates）。

- 更新 Remote\-SSH 扩展：在扩展面板中检查并更新 Remote\-SSH 插件。

- 查看详细 SSH 日志：在终端执行 ssh \-v \<环境地址\> 查看详细连接日志定位问题。

- 检查防火墙/代理：关闭本地防火墙或代理软件后重试。

- 尝试调整 SSH 超时设置：在 SSH 配置中添加 ServerAliveInterval 60 保持连接。

- 若持续失败，提供环境名称和完整报错信息联系官方排查。

****

**容器内部使用报错例如【容器初始化发现驱动不识别】经过上述排查处理还是不正常，且不想删除容器的情况下，在右侧可以提在线工单由内部人员处理**



![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=NGVlZjBhNTViYjI0YmE0OWYwNDE4MzU0OTNmZmEwOGJfODExODhiMTY3M2RlY2YyOTM3YzEyOWRhOTc2ZTgxYTJfSUQ6NzY2ODYwNjY5MDU5NDczNzEzMV8xNzg2MDY5ODExOjE3ODYxNTYyMTFfVjM)

**类似502，418，403的问题按照建议多次尝试过后还无法处理，可以在如下网址中提工单解决问题类型输入【开发资源/HiDevLab\-在线开发】记得按照对应提示提供对应的环境信息**

[https://www\.hiascend\.com/feedback/add?referrer=/support](https://www.hiascend.com/feedback/add?referrer=/support)



![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=MTJhYTM0ODQxOTdhYzJhODgxZmU5MTA1OTQ2YjI3MDVfYTQ0M2Q0YTlkYmZkM2QyNjgxNTVkYWMwNmZiY2Q0NDFfSUQ6NzY2ODYwNjcyNTY2NjI0NTYwOF8xNzg2MDY5ODExOjE3ODYxNTYyMTFfVjM)

提交工单后，需要关注工单信息可以在昇腾社区\-\>支持与服务\-\>开发者支持与服务\-\>技术工单\-\>查看工单

https://www\.hiascend\.com/support

![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=MWZiYmI3ZTI3YjIzMTVhNjAwODBkZGU1Y2Y5NTBmOTJfMjQ0OGY5MWM0OWUxZWU2OTg4ODNiNGEwNDc1MzdiMjNfSUQ6NzY2OTcwODEzNTIyNjAxODc3M18xNzg2MDY5ODExOjE3ODYxNTYyMTFfVjM)

查看工单页面

https://www\.hiascend\.com/feedback

![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=ZWE4YTg5MzAzZTBhYjEzZDNlM2M1Yzg2NmRjNDdlYzZfNTQxYTBiZDA0MGYyZTA1NGZhNTYwNDY2YTJhMjhlNGRfSUQ6NzY2OTcwODU1MzE3NDkyODU3MF8xNzg2MDY5ODExOjE3ODYxNTYyMTFfVjM)



