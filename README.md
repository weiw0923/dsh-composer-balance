<p align="center">
  <img src="assets/logo.svg" width="88" alt="dsh-composer-balance logo">
</p>

# dsh-composer-balance

[![npm](https://img.shields.io/npm/v/dsh-composer-balance)](https://www.npmjs.com/package/dsh-composer-balance)
[![license](https://img.shields.io/npm/l/dsh-composer-balance)](LICENSE)

<!--
截图：把两张图放到 docs/ 下，然后取消注释。发布前请把余额与会话内容打码或换成假数据。

[![界面](docs/chip.png)](docs/card.png)

收录到开放插件市场后再启用这枚徽章：

[![开放插件市场](https://img.shields.io/endpoint?url=https%3A%2F%2Fdshopen.org%2Fbadge%2Fdsh-composer-balance.json)](https://dshopen.org/zh/plugins/dsh-composer-balance/)
-->

A minimal balance chip for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): one line in the composer dock showing the account
balance and what the current session has cost, in the host's own visual
language.

```
◔ 42%   ¥ 14.55 │ 0.003
```

Clicking the chip opens a small card (264px, the same box the host's context
card uses):

```
账户余额            ¥14.55
充值 ¥14.55 · 赠送 ¥0.00
───────────────────────────
当前会话            ¥0.003
输入 35.2K · 输出 800 · 命中 96.6%
───────────────────────────
12:34 更新            (↻) (⚙)
```

## What it does

- **Balance** — read from DeepSeek's `/user/balance` on the host, cached for
  `refreshIntervalMs`; the browser never holds the API key.
- **Current session spend** — priced from the host's own `tokenUsage`
  projection (input / cache-hit / cache-write / output) with the unit price of
  the model the agent is currently on.
- **One card** — balance, session, last update, refresh and settings. Nothing
  else competes for attention.
- **Native look and feel** — the chip uses the same geometry as the context
  meter beside it; the card uses `--dsw-specific-menu`, `--dsw-elevation-prominent`,
  `--dsw-radius-lg` and a 12px/20px rhythm. Click to open, `Esc` or an outside
  click to close.
- **Local settings** — warning / critical thresholds (they only colour the ¥
  icon) and the auto-refresh interval, stored in `localStorage`.

## Install

```sh
dsh plugin --profile web add dsh-composer-balance   # once published
# or from a checkout / local directory:
dsh plugin --profile web add /path/to/dsh-composer-balance
```

Then restart the harness (`sudo systemctl restart dsh-web` for a systemd
deployment) and reload the page.

If you also run another balance chip in the composer, disable one of them —
each entry renders its own chip.

## Configuration

Write overrides into your profile's `cordis.patch.yml`:

```yaml
- id: dsh-composer-balance
  config:
    apiKeyRef: DEEPSEEK_API_KEY       # credential reference holding the key
    baseUrl: https://api.deepseek.com # /user/balance is appended
    refreshIntervalMs: 120000         # how long one reading stays fresh
    warningThreshold: 10              # chip turns amber at or below this
    dangerThreshold: 5                # chip turns red at or below this
    defaultPrice: { cacheHit: 0.2, cacheMiss: 2, output: 8 }  # ¥ / 1M tokens
    modelPrices:                      # per-model overrides
      deepseek-flash: { cacheHit: 0.02, cacheMiss: 1, output: 2 }
```

`defaultPrice` / `modelPrices` ship with placeholder numbers — replace them with
the provider's current list price so the session estimate is meaningful. Tokens
are always shown; a missing price only greys out the amount.

## Notes

- The route is read-only and never returns the API key; it sits behind the same
  fence as the rest of the web app.
- The entry renders last in the composer dock (`order: 1`), so it lines up after
  the host's token/context meter.
- The bundle is written against the host's public client seats: the
  `conversation.composer.dock` slot, the `tokenUsage` projection, and locale
  dictionaries.

## Licence

MIT — see [LICENSE](LICENSE). This is an independent implementation; it shares
no code with other balance plugins.
