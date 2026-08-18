---
title: 禅道 18.5 二开准备：目录结构、扩展机制与加载顺序（源码笔记）
description: 一次对禅道（ZenTao）开源版 18.5 的只读源码探索：顶层目录职责、标准模块骨架、ext 扩展机制的真实加载顺序（extension 扩展根、model 合并缓存、hook 注入）、config 加载链，以及新增自定义模块的标准步骤清单。
pubDate: 2026-08-18
---

做禅道（ZenTao）二次开发前，先做**只读源码侦察**是性价比最高的一步：不写、不改，只把"代码该放哪、框架怎么加载、升级会不会丢"三件事搞清楚。本文是我对禅道开源版 **18.5**（zbox 集成环境）目录结构与框架源码的探索笔记，重点回答：**18.5 里 ext 扩展到底放在哪个目录、按什么顺序加载**——这个结论和网上很多旧资料不一样。

文中所有主机地址、端口、真实部署路径均以占位符表示，不含内部部署信息；结论均来自框架源码（附行号）与实机验证。

---

## 一、为什么值得做这次探索

二开最常见的三个问题：

1. **代码放哪**：直接改 vendor 源码，升级就被覆盖；正确的扩展位点在哪？
2. **怎么生效**：写好的扩展文件，框架按什么顺序加载、谁覆盖谁？
3. **会不会丢**：跟随官方升级后，自定义内容能否自动保留？

这三个问题的答案，全部藏在 `<应用根>/framework/base/` 的 `router.class.php` / `control.class.php` / `model.class.php` 里。读一遍源码，比翻十篇过时教程都管用。

## 二、顶层目录：18.5 的布局一览

| 目录 | 职责 |
| --- | --- |
| `www/` | Web 入口与静态资源：`index.php`（路由入口）、`api.php`（API 入口）、`.htaccess`（rewrite）；`js/`、`theme/`、`static/`、`data/`（上传附件） |
| `module/` | 业务模块（90+ 个），每个模块独立骨架；`common` 为公共模块 |
| `framework/` | 框架：`router/control/model/helper/xuanxuan .class.php`（薄封装）+ `base/`（真实实现，`router.class.php` 113K） |
| `config/` | 全局配置：`config.php`、`my.php`（部署覆盖）、`zentaopms.php`（`TABLE_*` 常量）、`routes.php`（API 路由）、`ext/`（特性开关） |
| `api/` | API v1 资源：`v1/entries/*.php`（与 `routes.php` 一一对应） |
| `lib/` | 类库：`dao`（链式查询）、`filter`、`front`、`mobile`、`pager`、`zdb` 及第三方库 |
| `db/` | 安装/升级 SQL（`install.sql`、`update*.sql`）——**非运行时目录** |
| `extension/` | **扩展根**：`biz/`、`lite/`、`max/`、`xuan/`、`custom/`（二开主战场） |
| `hook/` | 安装/升级生命周期钩子（pre/post install/uninstall/upgrade）——**非运行时钩子** |
| `tmp/` | 运行时：`model/`（合并后的模型缓存）、`cache/`、`log/` |
| 其他 | `bin/ztcli`（命令行入口）、`sdk/php/zentao.php`（API SDK）、`doc/`、`test/` |

> 注意：**没有顶层 `lang/` 目录**——语言文件在模块内部；`www/` 下也没有 `css/`——样式在 `theme/` 与模块目录内。

## 三、标准模块骨架：一个模块 = 四件套 + 视图/语言/资源

```
module/<mod>/
├── control.php        # class <mod> extends control（动作方法）
├── model.php          # class <mod>Model extends model（业务逻辑，$this->dao + TABLE_* 常量）
├── config.php         # $config-><mod>->...（模块默认配置）
├── view/              # <method>.html.php；移动端 m.<method>.html.php；xhtml x.<method>.html.php
├── lang/              # zh-cn.php / zh-tw.php / en.php / de.php / fr.php ...
├── js/                # <method>.js（按方法自动加载）
├── css/               # <method>.css（按方法自动加载）
├── ext/               # ⚠️ 遗留目录（18.5 已不加载，见第四节）
└── index.html         # 防目录列举占位
```

关键约定：

- **模块自动发现**：`getModulePath()` 按 `saas → custom → vision → edition → xuan → module 根` 顺序找模块目录，`module/<mod>/` 是兜底位——放进去即可路由，**无需任何注册**。
- **URL 路由**：`requestType=PATH_INFO` + `requestFix='-'`，访问形如 `http://<站点>/zentao/<module>-<method>.html`，由 `.htaccess` 重写进 `index.php/<path>`。
- **类名约定**：control 类 `<mod>`，model 类 `<mod>Model`；支持 `my<mod>` 前缀类优先（`class_exists("my$moduleName")`）。
- **设备前缀**：`m.` = mhtml（移动端）、`x.` = xhtml；`$config->devicePrefix` 控制。
- **JSON 输出**：方法内 `echo json_encode(...)` 即可配合 `viewType=json`。

## 四、ext 扩展机制：18.5 的真实加载顺序（重点）

### 4.1 误区：`module/<mod>/ext` 已不再被加载

网上大量教程（以及不少版本自带文件）把扩展放在 `module/<mod>/ext/`。但 18.5 的框架**对 module 根下的 ext 目录零引用**：扩展路径全部由 `getModuleExtPath()`（`base/router.class.php:1677`）构造，它只返回 `extension/` 根下的路径。vendor 里遗留的 `module/holiday/ext`、`module/stage/ext` 只是历史残留，不参与加载。

> 这条结论决定了二开代码的存放位置，务必以**目标版本的源码**为准——别抄旧教程。

### 4.2 扩展根：`extension/<root>/<module>/ext/<type>/`

`getModuleExtPath()` 返回的扩展根（`<type>` ∈ `control|model|view|lang|config`）：

| key | 路径 | 说明 |
| --- | --- | --- |
| `saas` | `extension/saas/<module>/ext/<type>/` | 多租户场景 |
| `site` | `extension/<edition>/<module>/ext/_<siteCode>/<type>/` | 仅 `extensionLevel=2`（站点级） |
| `custom` | `extension/custom/<module>/ext/<type>/` | **定制开发专用根（二开主战场）** |
| `vision` | `extension/<vision>/<module>/ext/<type>/` | 界面类型扩展（rnd/lite） |
| `xuan` | `extension/xuan/<module>/ext/<type>/` | 喧喧（IM）扩展层 |
| `common` | `extension/<edition>/<module>/ext/<type>/` | 商业版（biz/max）扩展 |

开源版（`edition=open`、`extensionLevel=1`、`vision=rnd`）实际生效根只有 **`custom`** 与 **`xuan`** 两个。扩展系统安装"定制"代码时正是解压到 `extension/custom/`——官方给二开预留的位置。

### 4.3 control 扩展：先到先得

`setActionExtFile()`（`base/router.class.php:1747`）：按 **saas → site → custom → vision → xuan → common** 顺序查找 `ext/control/<method>.php`，**命中即止**。文件内容为"同名类同名方法"，加载后覆盖主 control 的方法：

```php
<?php
class <mod> extends control
{
    public function <method>(...) { /* 覆盖或新增动作 */ }
}
```

### 4.4 model 扩展：合并进 `ext<Mod>Model`，缓存自动重建

`setTargetFile()` / `mergeTargetExtFiles()`（`base/router.class.php:1844`）：把主 `model.php` 与各扩展根 `ext/model/*.php` **合并生成** `ext<Mod>Model extends <Mod>Model`，写入 `tmp/model/<edition>/<vision>/<module>.php`。合并顺序 = 扩展根迭代顺序（common → xuan → vision → custom → site → saas，跳过空路径），**同名方法后者覆盖前者**。

- 缓存按 mtime 判断失效（`needTargetFileUpdate()`），**改完 ext 文件自动重建，无需手工清缓存**；
- 复杂逻辑可放 `ext/model/class/<name>.class.php`（可加密），在 `ext/model/<name>.php` 里用 `$this->loadExtension('name')->method()` 调用。

### 4.5 view / lang / config 扩展：逐层覆盖

- **视图**：`getExtViewFile()`（`base/control.class.php:432`）按 **site → saas → custom → vision → xuan → common** 找 `ext/view/<method>.html.php` 覆盖主视图；
- **语言**：主 `module/<mod>/lang/<locale>.php` + 扩展根 `ext/lang/<locale>/*.php` 全部合并（注意多一层 locale 目录），后者覆盖；
- **配置**：主 `module/<mod>/config.php` + 扩展根 `ext/config/*.php`，之后再叠加数据库配置项。

### 4.6 钩子（Hook）：比整体覆写更优雅

| 钩子 | 位置 | 时机 |
| --- | --- | --- |
| 模型钩子 | `ext/model/hook/<method>.php` | 反射定位方法起止行，把代码**注入方法体开头**（`mergeTargetHookFiles`） |
| 视图钩子 | `ext/view/<method>.*.html.hook.php` | 主视图渲染完成后 include（`parseDefault()`） |
| 生命周期钩子 | 顶层 `hook/{pre,post}{install,uninstall,upgrade}.php` | 扩展安装/卸载/升级时执行 |

模型钩子尤其好用：不改主方法、不整体覆写，只在执行前"插一段逻辑"，升级兼容性最好。

### 4.7 归纳（开源版实际生效顺序）

| 扩展类型 | 生效根 | 覆盖规则 |
| --- | --- | --- |
| control | custom → xuan | 先到先得 |
| model | custom（在 xuan 之后合并） | 后者覆盖 |
| view | custom → xuan | 先到先得 |
| lang / config | custom → xuan | 后者覆盖 |

## 五、config 加载链：一切配置的入口

`<应用根>/config/config.php` 尾部按固定顺序 include（178-189 行）：

```
config.php      # 基础设置（version/edition/requestType/views/langs/db 前缀...）
  ├─ filter.php # 输入过滤规则
  ├─ cache.php  # 缓存设置
  ├─ my.php     # 部署覆盖（DB 连接、debug、requestType）——不入版本库，模板化生成
  ├─ zentaopms.php # TABLE_* 表常量 + 产品/项目术语表
  ├─ routes.php # API v1 路由
  └─ ext/*.php  # 特性开关（glob 顺序，_0_/_1_ 数字前缀控序）
```

值得记住的几个点：

- `TABLE_*` 常量（`zentaopms.php:250-336`）是二开 SQL 的**官方引用方式**：`define('TABLE_BUG', '`' . $config->db->prefix . 'bug`')`——代码里永远写 `TABLE_BUG` 而不是裸表名；
- **迭代模型**：`TABLE_EXECUTION` 与 `TABLE_PROJECT` 指向同一张表（`zt_project`），项目/迭代/看板按 `type` 字段区分——写迭代报表时按 `type='sprint'` 过滤；
- `my.php` 头部注释明说："不要直接修改 config.php，复制到 my.php 修改"——vendor 文件不可改是官方约定；
- 数据库配置项（zt_config）在模块配置加载后再叠加，属于"数据库覆盖代码"的一层。

## 六、新增一个自定义模块的标准步骤

1. **建骨架**：`module/<新模块>/` 下放四件套（`control.php` / `model.php` / `config.php` / `view/main.html.php`）+ `lang/zh-cn.php` + `index.html`，照抄任一内置模块（如 `module/bug`）的写法；
2. **写模型**：`$this->dao->select(...)->from(TABLE_XXX)` 链式查询；字段以目标版本的 `zt_` 表结构为准；
3. **写控制器**：`main()` 渲染视图，`export()` 等动作方法；入参做校验（日期格式、ID 正整数）；
4. **接菜单**：`extension/custom/common/ext/lang/<locale>/menu.php` 里注册 `$lang->my->menu-><mod>` 与 `menuOrder`（**不要直接改 vendor 的 menu.php**）；
5. **部署**：同步到 `<应用根>/module/<新模块>/`，浏览器访问 `/zentao/<新模块>-main.html` 验证；`tmp/model` 缓存自动重建；
6. **回归与备份**：验证权限、数据、导出；发布打 tag 与备份点对应，保证可回滚。

## 七、总结

这次探索沉淀的三个要点：

1. **以源码为准，别信过时教程**：`module/<mod>/ext` 在 18.5 已失效，二开扩展请放 `extension/custom/<module>/ext/`；
2. **理解加载顺序才能控制覆盖**：control 先到先得、model 合并后者覆盖、钩子注入方法体——按需选择"覆写 or 钩子"；
3. **只读侦察先行**：一个下午读完 `framework/base/` 的三个核心类 + config 加载链，后续所有二开决策都有据可依，且不污染 vendor、不丢自定义。

如果你的团队也在做禅道二开，建议把这份"目录与机制地图"沉淀进项目文档，作为新同学的第一份阅读材料。
