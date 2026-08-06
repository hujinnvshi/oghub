---
title: learn-ascendc-operator
description: 从达芬奇架构到亲手写出 Ascend C 算子 —— 昇腾 NPU 算子开发的学习笔记与实战工程。
---

![CANN](https://img.shields.io/badge/CANN-9.1.0--beta.3-blue) ![NPU](https://img.shields.io/badge/NPU-Ascend%20910B3-success) ![status](https://img.shields.io/badge/status-WIP%20%2F%20学习中-yellow)

> 从达芬奇架构到亲手写出 Ascend C 算子——昇腾 NPU 算子开发的学习笔记与实战工程。

- **源码仓库**：[hujinnvshi/learn-ascendc-operator](https://github.com/hujinnvshi/learn-ascendc-operator)
- **在线文档**：<https://hujinnvshi.github.io/learn-ascendc-operator/>

## 这是什么

一站式记录学习 **昇腾（Ascend）AI 算子开发** 的过程：从硬件架构（达芬奇 / Cube），到 Ascend C 编程（TQue / Tiling / SPMD），到用 `msopgen` 走完一个真实算子的 **编译 → 打包 → 安装** 全流程。配套 MkDocs Material 文档站，以及一个在 **Ascend 910B3 真机** 上编译通过的 Add 算子工程。

## 亮点

- **理论 + 实战**：既讲达芬奇架构 / Cube / Tiling 原理，也动手写、编译、安装一个真实算子。
- **真机背书**：在 **Ascend 910B3**（20 AI Core / 64 GB HBM / dav-c220）上验证，kernel 经 CANN 编译器完整编译并注册。
- **全流程覆盖**：`msopgen` 生成工程 → `build.sh` 编译 → 打包 `.run` → 安装到 vendors，一条龙。
- **真实踩坑**：沉淀了 CANN beta 上手工搭建编译链的工程细节（宏 / include / 库依赖），官方文档里找不到。

## 内容板块

| 板块 | 内容 |
|---|---|
| 学习路线 | 5 阶段路径（前置 → 架构 → Ascend C → 实战 → 认证）+ 官方资源 |
| 赛事变现 | 算子挑战赛 / 众智计划等变现路径与奖金 |
| 硬件档案 | 910B3 规格 + `npu-smi` 查询清单 + Cube 微架构 |
| Add 算子实战 | msopgen 标准工程 + 手工 Kernel Launch 探索 |

## 技术栈

| 类别 | 选型 |
|---|---|
| 硬件 | Ascend 910B3（dav-c220，20 Cube + 40 Vector，64 GB HBM） |
| 软件栈 | CANN 9.1.0-beta.3 · Ascend C · ccec/bisheng 编译器 |
| 开发工具 | msopgen · build.sh(cmake) · npu-smi |
| 文档 | MkDocs Material（中文搜索 / 暗色 / 导航） |
| 部署 | GitHub Pages + GitHub Actions 自动构建 |

## 适合谁

- 想入门 **昇腾 Ascend C 算子开发**、不知从何下手的开发者 / 学生；
- 有 **CUDA** 经验、想迁移到国产 NPU 生态的工程师；
- 对 **AI 芯片架构**（达芬奇 / Cube / Tensor Core 类设计）感兴趣的人；
- 想了解"一个算子从代码到能在 NPU 上跑"完整流程的人。

## 运行验证

- ✅ **kernel 编译通过**：msopgen 工程经 CANN 官方编译器完整编译，打包并安装到 `vendors/customize`。
- ⚠️ **端到端运行**：CANN beta 下手工搭测试链有若干工程细节，建议用 **MindStudio IDE** 打开 `AddProject/` 一键验证。

> License：MIT —— 欢迎学习、引用、贡献。
