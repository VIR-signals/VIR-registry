# VIR 注册表（registry）

简体中文 | [English](README.md)

VIR Signals 编辑器扩展的社区语音包索引仓。

## 这个仓库是什么

- `packs/` 下一个 JSON 文件描述一个语音包，**文件名就是包 id**。
- `registry.json` 是发给所有客户端的聚合索引，由 `aggregate.js` 生成，**永远不手改**。
- **本仓永不存任何音频。** 条目只指向包作者自己的仓库、锁死在不可变 commit 上。用户选中哪个包，就只从那一个作者仓下载——永远不会被迫全量下载。
- 就算这个索引仓死了，直装入口（输入作者仓地址）照样能装。

## 用户看这里

你不需要直接使用本仓。安装 VIR Signals 扩展后运行 **VIR: 选择语音包**，面板里列出的包就来自这份索引；选中一条即从对应作者仓下载该包。

## 作者看这里

发布一个包 = 往这里加一个 JSON 文件。完整投稿流程、条目字段说明、CI 会拦的十二类坏条目，见 [CONTRIBUTING.zh-cn.md](CONTRIBUTING.zh-cn.md)。

## 目录结构

| 路径 | 作用 |
|---|---|
| `packs/` | 源条目区，一包一文件，文件名 = 包 id |
| `registry.json` | 聚合生成物，`{"schema":1,"packs":[...]}` |
| `validate.js` | 条目校验器（零依赖） |
| `aggregate.js` | 确定性聚合器，产出 `registry.json` |
| `test/run-tests.js` | 测试卷 |
| `template.json` | 新条目的复制起点 |
| `.github/workflows/registry.yml` | Pull Request 上的 CI 三连 |

## 命令

三条命令都是纯 Node 零依赖，不需要 `npm install`。

```sh
node validate.js          # 校验全部条目 + registry.json 一致性
node aggregate.js         # 从 packs/ 重建 registry.json
node test/run-tests.js    # 跑测试卷，报告落 reports/
```
