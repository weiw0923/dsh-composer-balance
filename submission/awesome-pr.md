# awesome-dsh-plugin 收录 PR（草稿）

> 目的：dshmarket 只允许安装这个精选列表里的来源，收录后才能在其中搜索/一键安装。
> 提交前先看该仓库的 CONTRIBUTING，按它的排序/字段格式加一行（不同版本字段名可能略有差异）。

## PR 标题

```
Add dsh-composer-balance
```

## PR 描述

```markdown
### 插件

- 名称：`dsh-composer-balance`
- 仓库：https://github.com/weiw0923/dsh-composer-balance
- npm：https://www.npmjs.com/package/dsh-composer-balance
- 许可：MIT
- 兼容：DSH >= 0.2.0-rc.1（实测 0.2.1-rc.2）

### 简介

极简余额 chip，挂在输入框下方的 composer 统计行：显示 DeepSeek 账户余额与当前会话估算花费，
点击展开 264px 卡片（余额 / 充值·赠送 / 当前会话 / 更新时间 + 刷新、设置两个图标钮）。
卡片与触发钮完全沿用宿主的设计变量与交互（`--dsw-specific-menu`、`--dsw-elevation-prominent`、
点击开合、Esc 关闭），不引入自有视觉。宿主持有 API Key、缓存余额，浏览器不接触密钥。

### 说明

- 单价取自 DeepSeek 官方刊例价，区分高峰（周一至周五 9:00–12:00、14:00–18:00，北京时间）与空闲；
- 余额来自官方 `/user/balance`，会话 token 来自宿主自带的 `tokenUsage` 投影；
- 无第三方运行时依赖，只依赖宿主提供的 peer（cordis / schemastery / host-webserver）。
```

## 列表行（示例，按仓库实际字段调整）

```markdown
| [dsh-composer-balance](https://github.com/weiw0923/dsh-composer-balance) | 输入框下方显示账户余额与当前会话花费，卡片与宿主自带面板同风格 | MIT | `dsh plugin --profile web add dsh-composer-balance` |
```
