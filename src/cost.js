/**
 * Per-turn cost accounting for dsh-composer-balance.
 *
 * The session log carries one provider usage sample per assistant settlement
 * (`assistant/message` → `data.usage`, or a stream `usage` chunk on an
 * `assistant/attempt`). Each sample is priced with the tariff in force at that
 * event's own timestamp, so a session that spans the provider's peak windows is
 * charged correctly instead of at whatever tariff happens to be live when the
 * chip is rendered.
 *
 * Everything here is pure: the session projection in `index.js` folds with
 * `foldCost`, and the offline replay test uses the same function.
 */

/** Off-peak list prices, CNY per million tokens (DeepSeek 2026). */
export const BASE_PRICES = {
  'deepseek-flash': { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  'deepseek-v4-pro': { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
}

/** Price used when the model is unknown. */
export const FALLBACK_PRICE = BASE_PRICES['deepseek-flash']

const SHANGHAI_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/**
 * @param at - epoch milliseconds of the event being priced.
 * @returns true inside the provider's peak windows (Mon–Fri 09–12, 14–18 CST).
 */
export function isPeakAt(at) {
  const parts = SHANGHAI_CLOCK.formatToParts(new Date(at))
  const read = (type) => parts.find((part) => part.type === type)?.value ?? ''
  const weekday = read('weekday')
  if (weekday === 'Sat' || weekday === 'Sun') return false
  const minutes = (Number(read('hour')) % 24) * 60 + Number(read('minute'))
  return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60)
}

/**
 * @param model - model id the request used.
 * @param peak - whether the peak tariff applies.
 * @param overrides - `modelPrices` from the plugin config.
 * @param fallback - `defaultPrice` from the plugin config.
 * @returns `{cacheHit, cacheMiss, output}` for this model and tariff.
 */
export function priceFor(model, peak, overrides = {}, fallback) {
  const base = overrides?.[model] ?? BASE_PRICES[model] ?? fallback ?? FALLBACK_PRICE
  const factor = peak ? 2 : 1
  return {
    cacheHit: base.cacheHit * factor,
    cacheMiss: base.cacheMiss * factor,
    output: base.output * factor,
  }
}

/**
 * @param usage - provider usage sample (`inputTokens`, `outputTokens`, …).
 * @param price - unit price from {@link priceFor}.
 * @returns the cost of this one settlement, in the balance currency.
 */
export function usageCost(usage, price) {
  const read = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
  const miss = read(usage?.inputTokens) + read(usage?.cacheWriteTokens)
  return (
    miss * read(price.cacheMiss) +
    read(usage?.cacheReadTokens) * read(price.cacheHit) +
    read(usage?.outputTokens) * read(price.output)
  ) / 1e6
}

/**
 * Read the usage sample an assistant event carries, mirroring the host's own
 * aggregation: a durable `assistant/message` carries `data.usage`; an
 * `assistant/attempt` may carry a `usage` chunk at the end of its stream.
 * @param event - one committed session event.
 * @returns the usage sample, or undefined.
 */
export function usageOf(event) {
  const data = event?.data ?? {}
  if (event?.type === 'assistant/message' && data.usage !== undefined) return data.usage
  if (event?.type !== 'assistant/message' && event?.type !== 'assistant/attempt') return undefined
  const stream = Array.isArray(data.stream) ? data.stream : []
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const chunk = stream[index]?.chunk
    if (chunk?.type === 'usage' && chunk.usage !== undefined) return chunk.usage
    if (chunk?.usage !== undefined) return chunk.usage
  }
  return undefined
}

/** Initial fold state. */
export function initCostState() {
  return { model: '', total: 0, turns: 0, last: null }
}

/**
 * One fold step: track the routed model, then price each settlement once
 * (a later sample for the same turn/step replaces the earlier one).
 * @param state - previous state.
 * @param event - one committed session event.
 * @param options - `{modelPrices, defaultPrice}`.
 * @returns the next state; the same reference when nothing changed.
 */
export function foldCost(state, event, options = {}) {
  if (event?.type === 'request/header') {
    const model = event?.data?.header?.config?.model
    if (typeof model === 'string' && model !== '' && model !== state.model) {
      return { ...state, model }
    }
    return state
  }
  if (event?.type === 'llm/retry-started') {
    return state.last !== null && state.last.turn === event?.data?.turn && state.last.step === event?.data?.step
      ? { ...state, last: null }
      : state
  }
  const usage = usageOf(event)
  if (usage === undefined) return state
  const turn = Number(event?.data?.turn ?? 0)
  const step = Number(event?.data?.step ?? 0)
  const at = Number(event?.time ?? Date.now())
  const price = priceFor(state.model, isPeakAt(at), options.modelPrices, options.defaultPrice)
  const cost = usageCost(usage, price)
  const previous = state.last !== null && state.last.turn === turn && state.last.step === step
    ? state.last.cost
    : 0
  if (previous === cost) return state
  return {
    model: state.model,
    total: state.total - previous + cost,
    turns: previous === 0 ? state.turns + 1 : state.turns,
    last: { turn, step, cost },
  }
}
