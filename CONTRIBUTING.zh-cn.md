# 向 VIR 注册表投稿

简体中文 | [English](CONTRIBUTING.md)

在这里发布一个语音包 = 加一条 JSON 条目，指向**你自己的仓库**、锁死一个 commit。全流程：

## 1. 建自己的包仓库

把包本体——`manifest.json`、音频文件、可选的 `SOURCE.txt`——放进你自己的 GitHub 仓库。布局遵循 VIR Signals 语音包格式（一个目录装 manifest 与音频）。

## 2. 复制 commit SHA

把你想发布的提交的**完整 40 位** SHA 复制下来。用户装到的就是这个提交：之后你随便 push，已发布条目纹丝不动。发新版 = 更新条目里的 SHA。

## 3. 加一条条目

把 [`template.json`](template.json) 复制为 `packs/<你的包名>.json`，填好字段。**文件名必须等于 `id`**。然后本地重建索引（纯 Node，无需安装任何东西）：

```sh
node aggregate.js
```

## 4. 提 Pull Request

每个 PR 上 CI 自动跑三连：

1. **校验**——全部条目过下述检查；
2. **聚合**——从源条目重建索引；
3. **比对**——重建结果必须与你 PR 里的 `registry.json` **逐字节一致**。

与已合并的 PR 冲突时：rebase 后重跑 `node aggregate.js` 再推。

## 5. 合并即上架

合并后条目对全体用户生效。注意 CDN 缓存窗口：按分支分发的 `registry.json` 约有 12 小时缓存（手动 purge 可以提速）；包文件按 commit SHA 引用，**永不受缓存影响**。

## 6. 撤包

删掉自己的条目文件，重跑 `node aggregate.js`，提 PR。已装用户本地不受影响。仓库已死的条目由维护者按同流程清理；市场列表遇死链标灰显示，不会卡住列表。

## 条目字段

| 字段 | 必填 | 规矩 |
|---|---|---|
| `id` | 是 | `^[a-z0-9]+(-[a-z0-9]+)*$`，全仓唯一，**等于文件名** |
| `names` | 否 | 小写 locale（`zh-cn`、`en`…）到非空显示名的映射；缺省时客户端直接显示 id |
| `categories` | 否 | 数组，值 ∈ `game` / `ui` / `voice` / `ambient` / `fun` / `other` |
| `language` | 是 | `none` 或小写 BCP-47 简码（`zh`、`en`…） |
| `version` | 是 | 三段数字，`1.9.0 < 1.10.0` |
| `repo` | 是 | **你自己的仓库**的 `owner/name` 形态 |
| `branch` | 是 | 非空；仅作展示线索——下载一律不用它 |
| `commit` | 是 | 完整 40 位十六进制 SHA；唯一下载引用 |
| `packPath` | 是 | 正斜杠相对路径，指向你仓库内的 `manifest.json`（通常是 `pack`） |
| `license` | 是 | 你的包许可 |
| `author` | 是 | 作者名 |
| `sourceLicense` | 是 | `original` / `game-asset` / `third-party-cc0` / `unknown` 四选一 |

校验只查格式——不审品味、不审好坏、不审是否重复造轮子。格式合法一律收录，出问题走摘除流程。

## CI 会拦什么，错误 key 对照

本地跑 `node validate.js`，每处违规打印 `文件: 错误key`。十二类：

| # | 坏样例类 | 错误 key |
|---|---|---|
| 1 | id 含大写、下划线、空格 | `id.format` |
| 2 | id 与已有条目重复 | `id.duplicate` |
| 3 | 文件名不等于 id | `file.stem-mismatch` |
| 4 | repo 带协议头、多段、为空 | `repo.format` |
| 5 | packPath 含 `..` 逃逸、反斜杠、绝对路径 | `packPath.escape` / `packPath.backslash` / `packPath.absolute` |
| 6 | commit 缺失或非 40 位十六进制 | `field.required:commit` / `commit.format` |
| 7 | version 非三段数字 | `version.format` |
| 8 | sourceLicense 越枚举 | `sourceLicense.enum` |
| 9 | 必填字段缺失或空串 | `field.required:<字段>` |
| 10 | names 键非法或值为空 | `names.key-locale` / `names.value-empty` |
| 11 | language 大写或非 BCP-47 | `language.format` |
| 12 | branch 为空 | `field.required:branch` |

其他可能出现的 key：`json.parse`（文件不是合法 JSON）、`entry.not-object`（顶层不是对象）、`dir.non-json`（`packs/` 下出现非 JSON 文件）、`names.type` / `categories.type`（`names` 或 `categories` 的 JSON 类型不对）、`categories.value`（分类越枚举）、`registry.missing` / `registry.schema` / `registry.mismatch`（聚合产物缺失、schema 不对、或与 `packs/` 不同步——重跑 `node aggregate.js` 即可）。

## 测试

```sh
node test/run-tests.js
```

覆盖十二类坏样例、合法反例、聚合确定性（两次运行与不同写入顺序均逐字节一致）、文件名=id 联动、空仓形态、registry 一致性。
