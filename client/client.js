// dsh-composer-balance — browser half.
//
// One chip in the composer dock, next to the host's own context meter:
//
//   ¥ 14.55 │ 0.02
//
// Clicking it opens a 264px card laid out with the host's panel tokens:
// balance (with top-up / granted split), the current session's spend, and a
// footer with the last update time plus refresh and settings buttons.
//
// All numbers come from the host route `/api/composer-balance`; the session's
// token counts come from the host's own `tokenUsage` projection.
window.__ModuleLoader__.load({
	id: "dsh-composer-balance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const h = react.createElement;
		const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = react;

		/** Locale namespace owned by this plugin. */
		const NS = "composerBalance";
		/** Host route the chip polls. */
		const ROUTE = "/api/composer-balance";
		/** Card width — the same box the host's context card uses. */
		const CARD_WIDTH = 264;
		/** Storage key for the local display settings. */
		const SETTINGS_KEY = "dsh-composer-balance/settings";
		/** Defaults for the local display settings. */
		const DEFAULTS = { pollSec: 30, warning: 10, danger: 5 };

		// ---- styles ----------------------------------------------------------
		const CSS_ID = "dsh-composer-balance/styles.css";
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-composer-balance";
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = [
				// the entry renders after the host's context meter
				".dcb_root{order:1;position:relative;display:flex;align-items:center;flex:none;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}",
				// trigger: same geometry as the host chip beside it
				".dcb_chip{border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:inherit;line-height:inherit;font-variant-numeric:tabular-nums;white-space:nowrap;cursor:pointer;background:0 0;border:none;flex:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex}",
				".dcb_chip:hover,.dcb_chip[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
				".dcb_chip:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}",
				".dcb_icon{display:block;flex:none;margin-right:2px}",
				".dcb_amount{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}",
				".dcb_tag{color:var(--dsw-alias-label-tertiary)}",
				".dcb_chip .dcb_amount_warning{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-warning-primary,#f59e0b))}",
				".dcb_chip .dcb_amount_danger{color:var(--dsw-alias-state-error-primary,#ef4444)}",
				".dcb_sep{color:var(--dsw-alias-separator-primary)}",
				// card: the host panel recipe
				".dcb_card{position:absolute;bottom:calc(100% + 8px);right:0;z-index:1100;box-sizing:border-box;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px;padding:12px;white-space:normal;text-align:left}",
				".dcb_row{display:flex;align-items:baseline;justify-content:space-between;gap:16px}",
				".dcb_label{color:var(--dsw-alias-label-tertiary)}",
				".dcb_value{color:var(--dsw-alias-label-primary);font-weight:500;font-variant-numeric:tabular-nums}",
				".dcb_sub{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:18px}",
				".dcb_meta{display:flex;flex-wrap:wrap;column-gap:4px;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:18px}",
				".dcb_meta>span{white-space:nowrap}",
				".dcb_meta_dot{color:var(--dsw-alias-separator-primary)}",
				".dcb_rule{height:1px;background:var(--dsw-alias-separator-primary);margin:10px -12px}",
				".dcb_foot{display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:18px}",
				".dcb_actions{display:inline-flex;align-items:center;gap:8px}",
				".dcb_btn{width:18px;height:18px;box-sizing:border-box;border-radius:50%;border:1px solid var(--dsw-alias-border-l3);background:0 0;color:var(--dsw-alias-label-tertiary);display:inline-flex;align-items:center;justify-content:center;padding:0;font:inherit;font-size:10px;line-height:1;cursor:pointer}",
				".dcb_btn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
				".dcb_btn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}",
				// settings dialog
				".dcb_scrim{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.28)}",
				".dcb_dialog{box-sizing:border-box;width:300px;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px;padding:16px}",
				".dcb_dialog_title{margin:0 0 12px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}",
				".dcb_field{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}",
				".dcb_field input{width:88px;box-sizing:border-box;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.32));background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary);font:inherit;padding:2px 8px;text-align:right}",
				".dcb_dialog_foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:14px}",
				".dcb_dialog_btn{border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.32));background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;padding:3px 12px;cursor:pointer}",
				".dcb_dialog_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
				".dcb_dialog_btn_primary{border-color:transparent;background:var(--dsw-alias-brand-primary,var(--dsw-alias-state-business-primary,#3b82f6));color:#fff}",
			].join("");
			document.head.appendChild(tag);
		}

		// ---- dictionaries ----------------------------------------------------
		const zh = {
			"chip.label": "账户余额与当前对话花费，点击展开",
			"chip.balance": "账户余额",
			"chip.session": "当前对话",
			"chip.refresh": "立即刷新余额",
			"card.balance": "账户余额",
			"card.session": "当前对话",
			"card.empty": "本会话暂未产生消耗",
			"card.noCost": "暂无法估算",
			"card.updated": "{time} 更新",
			"card.updatedNever": "尚未获取余额",
			"settings.title": "余额插件设置",
			"settings.poll": "自动刷新（秒）",
			"settings.warning": "预警线",
			"settings.danger": "告急线",
			"settings.save": "保存",
			"settings.cancel": "取消",
			"settings.reset": "恢复默认",
			"settings.hint": "颜色阈值仅影响图标；余额来自 DeepSeek 官方接口。",
			"status.noKey": "未配置 API Key",
			"status.error": "余额读取失败",
			"status.timeout": "余额接口超时",
		};
		const en = {
			"chip.label": "Account balance and current-session spend, click to expand",
			"chip.balance": "balance",
			"chip.session": "chat",
			"chip.refresh": "Refresh balance now",
			"card.balance": "Account balance",
			"card.session": "Current session",
			"card.empty": "Nothing spent in this session yet",
			"card.noCost": "not estimable",
			"card.updated": "updated {time}",
			"card.updatedNever": "no reading yet",
			"settings.title": "Balance chip settings",
			"settings.poll": "Auto refresh (s)",
			"settings.warning": "Warning at",
			"settings.danger": "Critical at",
			"settings.save": "Save",
			"settings.cancel": "Cancel",
			"settings.reset": "Reset",
			"settings.hint": "Thresholds only colour the icon; the balance comes from DeepSeek's own endpoint.",
			"status.noKey": "No API key configured",
			"status.error": "Balance unavailable",
			"status.timeout": "Balance endpoint timed out",
		};

		// ---- local display settings -----------------------------------------
		/** @returns {{pollSec:number, warning:number, danger:number}} */
		function readSettings() {
			try {
				const raw = window.localStorage.getItem(SETTINGS_KEY);
				if (raw === null) return { ...DEFAULTS };
				const parsed = JSON.parse(raw);
				const pick = (value, fallback) => (Number.isFinite(value) ? value : fallback);
				return {
					pollSec: Math.min(600, Math.max(5, pick(parsed?.pollSec, DEFAULTS.pollSec))),
					warning: Math.max(0, pick(parsed?.warning, DEFAULTS.warning)),
					danger: Math.max(0, pick(parsed?.danger, DEFAULTS.danger)),
				};
			} catch {
				return { ...DEFAULTS };
			}
		}

		/** @param settings - the values to persist. */
		function writeSettings(settings) {
			try {
				window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
			} catch {
				/* private mode: keep the in-memory copy only */
			}
		}

		// ---- per-session spend ledger ----------------------------------------
		/** Key prefix for one session's ledger. */
		const LEDGER_PREFIX = "dsh-composer-balance/session/";

		/**
		 * @param sessionId - the session the entry is bound to.
		 * @returns `{last, spent, peak}` — last balance seen, spend accumulated from
		 * drops, and the highest figure ever shown for this session.
		 */
		function readLedger(sessionId) {
			try {
				const raw = window.localStorage.getItem(LEDGER_PREFIX + sessionId);
				if (raw === null) return { last: null, spent: 0, peak: 0 };
				const parsed = JSON.parse(raw);
				return {
					last: Number.isFinite(parsed?.last) ? parsed.last : null,
					spent: Number.isFinite(parsed?.spent) ? parsed.spent : 0,
					peak: Number.isFinite(parsed?.peak) ? parsed.peak : 0,
				};
			} catch {
				return { last: null, spent: 0, peak: 0 };
			}
		}

		/**
		 * @param sessionId - the session the entry is bound to.
		 * @param ledger - the ledger to persist.
		 */
		function writeLedger(sessionId, ledger) {
			try {
				window.localStorage.setItem(LEDGER_PREFIX + sessionId, JSON.stringify(ledger));
			} catch {
				/* private mode: keep the in-memory copy */
			}
		}

		/**
		 * Fold one balance reading into the ledger: a drop is spend, a rise is a
		 * top-up that only moves the baseline.
		 * @param ledger - previous ledger.
		 * @param total - balance just read.
		 * @returns the updated ledger.
		 */
		function advanceLedger(ledger, total) {
			if (!Number.isFinite(total)) return ledger;
			let spent = ledger.spent;
			if (ledger.last !== null) {
				const delta = ledger.last - total;
				if (delta > 0) spent += delta;
			}
			return { last: total, spent, peak: Math.max(ledger.peak, spent) };
		}

		// ---- balance store ---------------------------------------------------
		/** Session the chip is currently bound to; echoed on every request. */
		let activeSession = "";
		const listeners = new Set();
		let snapshot = { status: "loading", fetchedAt: 0 };
		let timer = null;
		let inFlight = null;

		/** @param next - the snapshot to publish. */
		function publish(next) {
			snapshot = next;
			for (const listener of listeners) listener();
		}

		/**
		 * Read the host route once.
		 * @param force - true to ask the host for a fresh provider read.
		 */
		function load(force) {
			if (inFlight !== null) return inFlight;
			const query = [];
			if (activeSession !== "") query.push("session=" + encodeURIComponent(activeSession));
			if (force) query.push("force=1");
			const url = ROUTE + (query.length === 0 ? "" : "?" + query.join("&"));
			inFlight = fetch(url, { cache: "no-store" })
				.then((response) => response.json())
				.then((body) => publish({ status: body.status ?? (body.ok ? "ok" : "error"), ...body, fetchedAt: body.fetchedAt ?? Date.now() }))
				.catch(() => publish({ status: "error", fetchedAt: Date.now(), error: "network" }))
				.finally(() => {
					inFlight = null;
				});
			return inFlight;
		}

		/** (Re)start the poll timer with the current interval. */
		function schedule() {
			if (timer !== null) clearTimeout(timer);
			timer = setTimeout(() => {
				if (typeof document !== "undefined" && document.hidden) {
					schedule();
					return;
				}
				// every tick asks for a fresh provider read: the host caps the rate with
				// its own cooldown, and the chip must not lag behind the account balance
				load(true).then(schedule, schedule);
			}, readSettings().pollSec * 1000);
		}

		const store = {
			subscribe(listener) {
				listeners.add(listener);
				if (listeners.size === 1) {
					load(false).then(schedule, schedule);
				}
				return () => {
					listeners.delete(listener);
					if (listeners.size === 0 && timer !== null) {
						clearTimeout(timer);
						timer = null;
					}
				};
			},
			getSnapshot() {
				return snapshot;
			},
			getServerSnapshot() {
				return snapshot;
			},
			refresh() {
				return load(true).then(schedule, schedule);
			},
			setSession(sessionId) {
				if (sessionId === activeSession) return;
				activeSession = sessionId;
				void load(false);
			},
		};

		// ---- formatting ------------------------------------------------------
		const CURRENCY_SYMBOL = { CNY: "¥", USD: "$" };

		/**
		 * @param value - amount in the balance currency.
		 * @param currency - ISO code reported by the provider.
		 * @returns the display string, e.g. `¥14.55`.
		 */
		function amountText(value, currency, withSymbol) {
			const symbol = withSymbol ? (CURRENCY_SYMBOL[currency] ?? "") : "";
			const amount = Number(value);
			if (!Number.isFinite(amount)) return symbol + "—";
			const magnitude = Math.abs(amount);
			const digits = magnitude >= 1 ? 2 : magnitude >= 0.01 ? 3 : 4;
			return symbol + amount.toFixed(digits);
		}

		/** Amount together with its currency symbol (card values). */
		function money(value, currency) {
			return amountText(value, currency, true);
		}

		/** Amount without a symbol: the chip's ¥ icon already states the unit. */
		function plain(value, currency) {
			return amountText(value, currency, false);
		}

		/**
		 * @param value - token count.
		 * @returns the compact form used in the card, e.g. `35.2K`.
		 */
		function tokens(value) {
			const amount = Number(value)
			if (!Number.isFinite(amount) || amount <= 0) return "0"
			if (amount >= 1e6) return (amount / 1e6).toFixed(1) + "M"
			if (amount >= 1e3) return (amount / 1e3).toFixed(1) + "K"
			return String(Math.round(amount))
		}

		/**
		 * @param timestamp - epoch milliseconds.
		 * @returns `HH:MM` for today, otherwise `MM-DD`.
		 */
		function clock(timestamp) {
			if (!Number.isFinite(timestamp) || timestamp <= 0) return "—"
			const date = new Date(timestamp)
			const now = new Date()
			const sameDay = date.toDateString() === now.toDateString()
			const pad = (value) => String(value).padStart(2, "0")
			return sameDay
				? pad(date.getHours()) + ":" + pad(date.getMinutes())
				: pad(date.getMonth() + 1) + "-" + pad(date.getDate())
		}

		/**
		 * Price one session's tokens with the host-supplied unit price.
		 * @param usage - the `tokenUsage` projection value.
		 * @param price - `{cacheHit, cacheMiss, output}` per million tokens.
		 * @returns the amount, or undefined when it cannot be estimated.
		 */
		function priceUsage(usage, price) {
			if (usage === undefined || usage === null || price === undefined || price === null) return undefined
			const read = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
			const missTokens = read(usage.uncachedInputTokens) + read(usage.cacheWriteTokens)
			const cost = (missTokens * read(price.cacheMiss)
				+ read(usage.cacheReadTokens) * read(price.cacheHit)
				+ read(usage.outputTokens) * read(price.output)) / 1e6
			return Number.isFinite(cost) ? cost : undefined
		}

		// ---- icons -----------------------------------------------------------
		/** Yen glyph drawn the way the host draws its own 14px icons. */
		function YenIcon() {
			return h("svg", {
				viewBox: "0 0 24 24",
				width: 14,
				height: 14,
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 2,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": true,
				className: "dcb_icon",
			}, h("path", { d: "M12 9.5V21M12 9.5 6 3M12 9.5 18 3M6 11h12M6 15h12" }))
		}

		/** Refresh glyph, same stroke language. */
		function RefreshIcon() {
			return h("svg", {
				viewBox: "0 0 24 24",
				width: 12,
				height: 12,
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 2.2,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": true,
			}, h("path", { d: "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" }))
		}

		/** Settings glyph, same stroke language. */
		function GearIcon() {
			return h("svg", {
				viewBox: "0 0 24 24",
				width: 12,
				height: 12,
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 2.2,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": true,
			}, [
				h("circle", { cx: 12, cy: 12, r: 3, key: "c" }),
				h("path", { d: "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z", key: "g" }),
			])
		}

		// ---- settings dialog -------------------------------------------------
		/**
		 * Small modal for the three display knobs.
		 * @param props - `{t, onClose}`.
		 */
		function SettingsDialog({ t, onClose }) {
			const [draft, setDraft] = useState(readSettings)
			const field = (label, key, step) => h("label", { className: "dcb_field", key }, [
				h("span", { key: "l" }, label),
				h("input", {
					key: "i",
					type: "number",
					min: 0,
					step,
					value: draft[key],
					onChange: (event) => {
						const next = Number(event.target.value)
						setDraft({ ...draft, [key]: Number.isFinite(next) ? next : 0 })
					},
				}),
			])
			return h("div", {
				className: "dcb_scrim",
				onPointerDown: (event) => {
					if (event.target === event.currentTarget) onClose()
				},
			}, h("div", { className: "dcb_dialog", role: "dialog", "aria-label": t("settings.title") }, [
				h("p", { className: "dcb_dialog_title", key: "title" }, t("settings.title")),
				field(t("settings.poll"), "pollSec", 5),
				field(t("settings.warning"), "warning", 1),
				field(t("settings.danger"), "danger", 1),
				h("p", { className: "dcb_sub", key: "hint" }, t("settings.hint")),
				h("div", { className: "dcb_dialog_foot", key: "foot" }, [
					h("button", {
						key: "reset",
						type: "button",
						className: "dcb_dialog_btn",
						onClick: () => setDraft({ ...DEFAULTS }),
					}, t("settings.reset")),
					h("button", {
						key: "cancel",
						type: "button",
						className: "dcb_dialog_btn",
						onClick: onClose,
					}, t("settings.cancel")),
					h("button", {
						key: "save",
						type: "button",
						className: "dcb_dialog_btn dcb_dialog_btn_primary",
						onClick: () => {
							writeSettings(draft)
							onClose()
						},
					}, t("settings.save")),
				]),
			]))
		}

		// ---- the chip --------------------------------------------------------
		/**
		 * Composer entry: the balance chip plus its card.
		 * @param props - `{t, useProjection?}` from the slot.
		 */
		function BalanceChip(props) {
			const t = props.t
			const useProjection = typeof props.useProjection === "function" ? props.useProjection : () => undefined
			const usage = useProjection("tokenUsage");
			const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
			const [open, setOpen] = useState(false);
			const [settingsOpen, setSettingsOpen] = useState(false);
			const [display, setDisplay] = useState(readSettings);
			const sessionId = typeof props.sessionId === "string" && props.sessionId !== "" ? props.sessionId : "default";
			const [ledger, setLedger] = useState(() => readLedger(sessionId));
			const root = useRef(null);

			// every successful reading moves the ledger; a top-up only moves the baseline
			useEffect(() => {
				store.setSession(sessionId);
			}, [sessionId]);

			useEffect(() => {
				if (state.status !== "ok" || !Number.isFinite(state.total)) return;
				setLedger((previous) => {
					const next = advanceLedger(previous, state.total);
					if (next.last === previous.last && next.spent === previous.spent) return previous;
					writeLedger(sessionId, next);
					return next;
				});
			}, [sessionId, state.status, state.total, state.fetchedAt]);

			// settings drive the colour thresholds and the poll cadence
			useEffect(() => {
				const onStorage = (event) => {
					if (event.key === SETTINGS_KEY) {
						setDisplay(readSettings());
						schedule();
					}
				};
				window.addEventListener("storage", onStorage);
				return () => window.removeEventListener("storage", onStorage);
			}, []);

			// outside click + Escape dismiss the card
			useEffect(() => {
				if (!open) return undefined;
				const onPointerDown = (event) => {
					if (root.current !== null && !root.current.contains(event.target)) setOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("pointerdown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [open]);

			const total = state.total;
			const currency = state.currency ?? "CNY";
			const level = !Number.isFinite(total)
				? "danger"
				: total <= display.danger
					? "danger"
					: total <= display.warning
						? "warning"
						: "success";
			// 当前会话：优先用宿主按轮计价的投影（每轮按发生时刻的档位），
			// 拿不到时退回整段 token 估算；两者都不低于余额账本峰值，保证不回退。
			const perTurn = useProjection("composerBalanceCost");
			const hostCost = state.cost !== undefined && state.cost !== null && Number.isFinite(state.cost.total)
				? state.cost.total
				: undefined;
			const projected = perTurn !== null && perTurn !== undefined && Number.isFinite(perTurn.total)
				? perTurn.total
				: undefined;
			const perTurnCost = hostCost ?? projected;
			const tokenCost = priceUsage(usage, state.price);
			// per-turn replay is authoritative: it is never overruled by the old
			// whole-session estimate, and it clears any peak that estimate left behind
			const authoritative = perTurnCost !== undefined ? Math.max(perTurnCost, ledger.spent) : undefined;
			const estimate = authoritative ?? tokenCost;
			const balanceCost = ledger.spent;
			const composite = authoritative !== undefined ? authoritative : Math.max(tokenCost ?? 0, ledger.peak);

			useEffect(() => {
				if (authoritative !== undefined) {
					if (ledger.peak === authoritative) return;
					const next = { ...ledger, peak: authoritative };
					writeLedger(sessionId, next);
					setLedger(next);
					return;
				}
				if (!Number.isFinite(composite) || composite <= ledger.peak) return;
				const next = { ...ledger, peak: composite };
				writeLedger(sessionId, next);
				setLedger(next);
			}, [authoritative, composite, ledger, sessionId]);

			const spent = state.status === "ok" && composite > 0 ? composite : undefined;

			const openCard = useCallback(() => {
				setOpen((value) => {
					if (!value) void store.refresh();
					return !value;
				});
			}, []);

			const readout = state.status === "ok"
				? t("card.updated", { time: clock(state.fetchedAt) })
				: state.status === "no-key"
					? t("status.noKey")
					: state.status === "loading"
						? t("card.updatedNever")
						: t("status.error");

			const hasTokens = usage !== undefined
				&& (usage.uncachedInputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) + (usage.outputTokens ?? 0) > 0;
			const inputTokens = hasTokens
				? (usage.uncachedInputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
				: 0;
			const hitRate = hasTokens && inputTokens > 0
				? ((usage.cacheReadTokens ?? 0) / inputTokens * 100).toFixed(1)
				: "0.0";

			/**
			 * Build one wrapped meta line: every segment stays unbreakable, only the
			 * gaps between segments may wrap.
			 * @param key - React key for the row.
			 * @param parts - segments, joined by a thin separator dot.
			 */
			const metaLine = (key, parts) => h("div", { className: "dcb_meta", key },
				parts.flatMap((part, index) => index === 0
					? [h("span", { key: "p0" }, part)]
					: [
						h("span", { className: "dcb_meta_dot", "aria-hidden": true, key: "d" + index }, "·"),
						h("span", { key: "p" + index }, part),
					]))

			const chip = h("span", {
				className: "dcb_chip",
				key: "chip",
				role: "button",
				tabIndex: 0,
				"aria-haspopup": "dialog",
				"aria-expanded": open,
				"aria-label": t("chip.label"),
				onClick: openCard,
				onKeyDown: (event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault()
						openCard()
					}
				},
			}, [
				h(YenIcon, { key: "icon" }),
				h("span", { className: "dcb_tag", key: "bal_tag" }, t("chip.balance")),
				h("span", { className: "dcb_amount" + (level === "success" ? "" : " dcb_amount_" + level), key: "bal" }, state.status === "ok" ? plain(total, currency) : "—"),
				h("span", { className: "dcb_sep", key: "sep", "aria-hidden": true }, "│"),
				h("span", { className: "dcb_tag", key: "cost_tag" }, t("chip.session")),
				h("span", { className: "dcb_amount", key: "cost" }, spent === undefined ? "—" : plain(spent, currency)),
			])

			const card = open ? h("div", {
				className: "dcb_card",
				style: { width: CARD_WIDTH },
				role: "dialog",
				"aria-label": t("card.balance"),
				key: "card",
			}, [
				h("div", { className: "dcb_row", key: "bal" }, [
					h("span", { className: "dcb_label", key: "l" }, t("card.balance")),
					h("span", { className: "dcb_value", key: "v" }, state.status === "ok" ? money(total, currency) : "—"),
				]),
				state.status === "ok"
					? metaLine("bal-sub", ["充值 " + money(state.toppedUp, currency), "赠送 " + money(state.granted, currency)])
					: h("div", { className: "dcb_sub", key: "bal-sub" }, readout),
				h("div", { className: "dcb_rule", key: "rule-1" }),
				h("div", { className: "dcb_row", key: "session" }, [
					h("span", { className: "dcb_label", key: "l" }, t("card.session")),
					h("span", { className: "dcb_value", key: "v" }, spent === undefined ? "—" : money(spent, currency)),
				]),
				(balanceCost > 0 || estimate !== undefined)
					? metaLine("session-cost", [
						...(balanceCost > 0 ? ["余额变动 " + money(balanceCost, currency)] : []),
						...(estimate !== undefined
							? [(perTurnCost !== undefined ? "按轮计价 " : "按 token ") + money(estimate, currency)]
							: []),
					])
					: null,
				hasTokens
					? metaLine("session-sub", [
						"输入 " + tokens(inputTokens),
						"输出 " + tokens(usage.outputTokens ?? 0),
						"命中 " + hitRate + "%",
						perTurnCost !== undefined ? "按轮计价" : state.isPeak === true ? "高峰计价" : "空闲计价",
					])
					: h("div", { className: "dcb_sub", key: "session-sub" }, t("card.empty")),
				h("div", { className: "dcb_rule", key: "rule-2" }),
				h("div", { className: "dcb_foot", key: "foot" }, [
					h("span", { key: "time" }, readout),
					h("span", { className: "dcb_actions", key: "actions" }, [
						h("button", {
							key: "refresh",
							type: "button",
							className: "dcb_btn",
							title: t("chip.refresh"),
							"aria-label": t("chip.refresh"),
							onClick: () => void store.refresh(),
						}, h(RefreshIcon, null)),
						h("button", {
							key: "settings",
							type: "button",
							className: "dcb_btn",
							title: t("settings.title"),
							"aria-label": t("settings.title"),
							onClick: () => setSettingsOpen(true),
						}, h(GearIcon, null)),
					]),
				]),
			]) : null

			return h("div", { className: "dcb_root", ref: root }, [
				chip,
				card,
				settingsOpen ? h(SettingsDialog, {
					key: "settings",
					t,
					onClose: () => {
						setSettingsOpen(false)
						setDisplay(readSettings())
					},
				}) : null,
			])
		}

		// ---- plugin ----------------------------------------------------------
		const inject = ["slots", "locale"];

		/**
		 * Register the chip once the conversation declares the composer dock.
		 * @param ctx - the browser plugin context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-composer-balance: dictionaries")
			ctx.slots.inject("conversation.composer.dock", () => {
				const dispose = ctx.slots.register({
					name: "conversation.composer.dock",
					id: "dsh-composer-balance",
					order: 1,
					locale: NS,
				}, BalanceChip)
				return () => dispose()
			})
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
