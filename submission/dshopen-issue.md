# 开放插件市场收录申请（可直接粘贴到 dsh-plugin-index 的 plugin-add issue）

> 仓库：https://github.com/polang233/dsh-plugin-index
> 新建 issue 时选模板「插件收录 / Add a plugin」

## 插件地址 / Plugin link

```
dsh-composer-balance
```

（源码仓库：https://github.com/weiw0923/dsh-composer-balance）

## 简短说明 / Summary

极简余额 chip：在输入框下方的统计条里显示 DeepSeek 账户余额与当前会话花费，悬停/点击展开的卡片与 DSH 自带面板同风格（同一套 `--dsw-*` 设计变量、同样的开合与 Esc 关闭行为）。宿主持有 API Key 并缓存余额，浏览器不接触密钥。

A minimal balance chip for the composer dock: account balance and current-session spend, with a card rendered in the host's own visual language (same design tokens, same click/Esc behaviour). The host holds the API key and caches the reading; the browser never sees it.

## 补充信息 / Additional details

- 版本：`0.2.0`，MIT 许可，公开源码（GitHub）。
- 兼容：DSH `>=0.2.0-rc.1`，已在 `0.2.1-rc.2` 上实测（余额读取、按轮计价、卡片开合、设置保存）。
- 当前会话的花费**按轮计价**：每个 provider usage 样本按它自己时间戳的档位（高峰/空闲）计算，跨峰谷不失真；另有一行“余额变动”作为实际扣费参考。
- 依赖：仅 `@deepseek-ai/schemastery` / `@deepseek-ai/cordis` / `@deepseek-ai/dsh-host-webserver`（peer，随宿主提供），另无第三方运行时依赖。
- 数据来源：DeepSeek 官方 `/user/balance` 与宿主自带的 `tokenUsage` 会话投影；单价按官方刊例价（元/百万 token，含高峰/空闲两档）。
- 需要：已配置 `DEEPSEEK_API_KEY`（凭证引用可在 `cordis.patch.yml` 中改）。
- Logo：仓库内 `assets/logo.svg`（512×512，描边 ¥）。
- 截图（实拍，非 mock）：

  <img src="https://raw.githubusercontent.com/weiw0923/dsh-composer-balance/main/docs/chip.png" width="240" alt="chip">
  <img src="https://raw.githubusercontent.com/weiw0923/dsh-composer-balance/main/docs/card.png" width="268" alt="card">

## 备注

目前没有官方市场，本包只依赖宿主公开的插件席位与投影，不修改任何内置插件。
