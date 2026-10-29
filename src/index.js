/**
 * dsh-composer-balance — host half.
 *
 * Registers one read-only route, `GET /api/composer-balance`, that answers with
 * the account balance reported by DeepSeek's `/user/balance` endpoint plus the
 * unit price of the model the agent is currently on. The browser never talks to
 * the provider directly: it only reads this cached snapshot.
 *
 * The route is guarded by the host's connection admission: every request must
 * pass `connection.admit()` (the same Host/Origin fence and browser/API
 * authentication the host's own routes use), so only an admitted browser or
 * API peer can read the balance or trigger a provider read. When the
 * connection service is missing or admission itself fails, the route refuses
 * the request instead of serving it — fail closed, never fail open. It never
 * returns the API key.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { foldCost, initCostState } from './cost.js'

export const name = 'dsh-composer-balance'

/** The web server is the only hard dependency; credentials are read optionally. */
export const inject = ['webServer']

/**
 * Defaults, also used when the schema module cannot be resolved (a checkout
 * installed as a `link:` dependency has no node_modules of its own). Keeping the
 * defaults here means the plugin never depends on the schema being loadable.
 */
const DEFAULTS = {
  apiKeyRef: 'DEEPSEEK_API_KEY',
  baseUrl: 'https://api.deepseek.com',
  refreshIntervalMs: 120000,
  warningThreshold: 10,
  dangerThreshold: 5,
  defaultPrice: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  modelPrices: {},
}

/**
 * Off-peak list prices in CNY per million tokens (DeepSeek, 2026).
 * Peak hours are billed at twice these, and the provider defines peak as
 * Monday–Friday 09:00–12:00 and 14:00–18:00 Asia/Shanghai; weekends and public
 * holidays are off-peak all day. Public holidays are not modelled here.
 */
const BASE_PRICES = {
  'deepseek-flash': { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  'deepseek-v4-pro': { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
}

/** Shanghai clock, used only to pick the tariff. */
const SHANGHAI_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/**
 * @param now - instant to classify.
 * @returns true inside the provider's peak windows.
 */
function isPeakHour(now = new Date()) {
  const parts = SHANGHAI_CLOCK.formatToParts(now)
  const read = (type) => parts.find((part) => part.type === type)?.value ?? ''
  const weekday = read('weekday')
  if (weekday === 'Sat' || weekday === 'Sun') return false
  const minutes = (Number(read('hour')) % 24) * 60 + Number(read('minute'))
  return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60)
}

/**
 * Pick the unit price for one model at one instant.
 * @param model - model id reported by the agent.
 * @param settings - resolved plugin config.
 * @param peak - whether the peak tariff applies.
 * @returns `{cacheHit, cacheMiss, output}` per million tokens.
 */
function unitPrice(model, settings, peak) {
  const base = settings.modelPrices?.[model]
    ?? BASE_PRICES[model]
    ?? settings.defaultPrice
    ?? BASE_PRICES['deepseek-flash']
  const factor = peak ? 2 : 1
  return {
    cacheHit: base.cacheHit * factor,
    cacheMiss: base.cacheMiss * factor,
    output: base.output * factor,
  }
}

/** The schema module, when it resolves — it does for a package installed from npm. */
let z = null
try {
  const loaded = await import('@deepseek-ai/schemastery')
  z = loaded.default ?? loaded
} catch {
  /* linked checkout: the schema stays unavailable and apply() falls back to DEFAULTS */
}

/** Schema module for the cost projection — same optional-import story as above. */
let zod = null
try {
  const loaded = await import('zod')
  zod = loaded.z ?? loaded.default?.z ?? loaded.default ?? null
} catch {
  /* linked checkout without a node_modules of its own */
}

/** Unit price for one model, in the balance currency, per million tokens. */
const Price = z === null ? null : z.object({
  cacheHit: z.number().min(0).default(0.02),
  cacheMiss: z.number().min(0).default(1),
  output: z.number().min(0).default(4),
})

export const Config = Price === null ? undefined : z.object({
  /** Credential reference holding the DeepSeek API key. */
  apiKeyRef: z.string().default('DEEPSEEK_API_KEY'),
  /** Provider base URL; `/user/balance` is appended. */
  baseUrl: z.string().default('https://api.deepseek.com'),
  /** How long one balance reading stays fresh. */
  refreshIntervalMs: z.natural().min(1000).default(120000),
  /** Balance at or below which the chip turns amber. */
  warningThreshold: z.number().min(0).default(10),
  /** Balance at or below which the chip turns red. */
  dangerThreshold: z.number().min(0).default(5),
  /** Fallback price for models missing from `modelPrices`. */
  defaultPrice: Price.default({ cacheHit: 0.02, cacheMiss: 1, output: 4 }),
  /** Per-model overrides, keyed by the model id the agent reports. */
  modelPrices: z.dict(Price).default({}),
})

/** One-entry cache for the replayed session cost. */
const replayCache = { key: '', total: 0, turns: 0 }

/**
 * Locate one session's durable log.
 * @param sessionId - session folder name, e.g. `session-6db6…`.
 * @returns the absolute path, or undefined when no project holds it.
 */
function findSessionLog(sessionId) {
  const root = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
  let projects
  try {
    projects = readdirSync(root)
  } catch {
    return undefined
  }
  for (const project of projects) {
    const candidate = join(root, project, sessionId, 'session.v4.jsonl.zstd')
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      /* not this project */
    }
  }
  return undefined
}

/**
 * Per-turn cost of one session, replayed from its durable log and priced at each
 * settlement's own timestamp. Cheap enough to call on every poll: the replay is
 * cached until the log's size or mtime moves.
 * @param sessionId - session folder name.
 * @returns `{total, turns}`, or undefined when the log is missing or unreadable.
 */
function sessionCost(sessionId) {
  const file = findSessionLog(sessionId)
  if (file === undefined) return undefined
  let stat
  try {
    stat = statSync(file)
  } catch {
    return undefined
  }
  const key = sessionId + ':' + stat.size + ':' + stat.mtimeMs
  if (replayCache.key === key) return { total: replayCache.total, turns: replayCache.turns }
  let text
  try {
    text = zstdDecompressSync(readFileSync(file)).toString('utf8')
  } catch {
    // a frame still being appended: answer with the previous replay when we have one
    return replayCache.key.startsWith(sessionId + ':')
      ? { total: replayCache.total, turns: replayCache.turns }
      : undefined
  }
  let state = initCostState()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    let event
    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }
    state = foldCost(state, event)
  }
  replayCache.key = key
  replayCache.total = state.total
  replayCache.turns = state.turns
  return { total: state.total, turns: state.turns }
}

/** Route the browser polls. */
const ROUTE = '/api/composer-balance'
/** Minimum spacing between two forced provider reads. */
const FORCE_COOLDOWN_MS = 2000
/** Upper bound on one provider round trip. */
const FETCH_TIMEOUT_MS = 8000

/**
 * Send one JSON body with no-store caching.
 * @param res - the Node response to write.
 * @param status - HTTP status code.
 * @param body - JSON-serialisable payload.
 */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/**
 * Read the balance entries out of a `/user/balance` body.
 * @param body - the parsed provider response.
 * @param preferred - currency to prefer when several are reported.
 * @returns the flattened reading, or undefined when the body is unusable.
 */
function readBalance(body, preferred) {
  const infos = Array.isArray(body?.balance_infos) ? body.balance_infos : []
  if (infos.length === 0) return undefined
  const pick = infos.find((info) => info?.currency === preferred) ?? infos[0]
  const amount = (value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return {
    currency: typeof pick?.currency === 'string' && pick.currency !== '' ? pick.currency : 'CNY',
    total: amount(pick?.total_balance),
    granted: amount(pick?.granted_balance),
    toppedUp: amount(pick?.topped_up_balance),
  }
}

/**
 * Resolve the API key through the credential store, then the environment.
 * @param ctx - plugin context.
 * @param ref - credential reference to resolve.
 * @returns the key, or undefined when none is configured.
 */
async function resolveKey(ctx, ref) {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    try {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined && typeof hit.value === 'string' && hit.value !== '') return hit.value
    } catch {
      /* fall through to the environment */
    }
  }
  const fromEnv = process.env[ref]
  return typeof fromEnv === 'string' && fromEnv !== '' ? fromEnv : undefined
}

/**
 * Ask the agent service which model is selected right now.
 * @param ctx - plugin context.
 * @returns the model id, or an empty string when the service is unavailable.
 */
function currentModel(ctx) {
  try {
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
    return typeof selection?.model === 'string' ? selection.model : ''
  } catch {
    return ''
  }
}

export function apply(ctx, config) {
  /** Set once the per-turn cost projection is registered; echoed by the route. */
  let projectionReady = false
  const merged = { ...DEFAULTS, ...(config ?? {}) }
  const settings = {
    ...merged,
    defaultPrice: { ...DEFAULTS.defaultPrice, ...(merged.defaultPrice ?? {}) },
    modelPrices: { ...DEFAULTS.modelPrices, ...(merged.modelPrices ?? {}) },
  }
  const state = {
    /** @type {{ status: string, fetchedAt: number, data?: object, error?: string }} */
    snapshot: { status: 'idle', fetchedAt: 0 },
    /** @type {Promise<void>|null} */
    pending: null,
    /** Last session id the browser named, for diagnostics. */
    lastSession: '',
  }

  /**
   * Read the provider once and fold the outcome into `state.snapshot`.
   * @param force - true to ignore the freshness window.
   */
  const readOnce = async (force) => {
    // one read at a time: a second caller joins the read already in flight
    if (state.pending !== null) return state.pending
    const fresh = state.snapshot.status === 'ok'
      && Date.now() - state.snapshot.fetchedAt < settings.refreshIntervalMs
    if (!force && fresh) return
    if (!force && Date.now() - state.snapshot.fetchedAt < FORCE_COOLDOWN_MS) return
    state.pending = (async () => {
    try {
      const key = await resolveKey(ctx, settings.apiKeyRef)
      if (key === undefined) {
        state.snapshot = { status: 'no-key', fetchedAt: Date.now() }
        return
      }
      const url = settings.baseUrl.replace(/\/+$/, '') + '/user/balance'
      const response = await fetch(url, {
        headers: { authorization: 'Bearer ' + key, accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!response.ok) {
        state.snapshot = { status: 'error', fetchedAt: Date.now(), error: 'HTTP ' + response.status }
        return
      }
      const reading = readBalance(await response.json(), 'CNY')
      if (reading === undefined) {
        state.snapshot = { status: 'error', fetchedAt: Date.now(), error: 'unreadable payload' }
        return
      }
      state.snapshot = { status: 'ok', fetchedAt: Date.now(), data: reading }
    } catch (error) {
      const message = error?.name === 'TimeoutError' ? 'timeout' : String(error?.message ?? error)
      state.snapshot = { status: 'error', fetchedAt: Date.now(), error: message }
    } finally {
      state.pending = null
    }
    })()
    return state.pending
  }

  /** Assemble the body the browser reads; never includes the key. */
  const payload = () => {
    const model = currentModel(ctx)
    const peak = isPeakHour()
    const price = unitPrice(model, settings, peak)
    const snapshot = state.snapshot
    return {
      ok: snapshot.status === 'ok',
      status: snapshot.status,
      fetchedAt: snapshot.fetchedAt,
      ...(snapshot.error === undefined ? {} : { error: snapshot.error }),
      ...(snapshot.data ?? {}),
      model,
      price,
      isPeak: peak,
      projection: projectionReady,
      lastSession: state.lastSession,
      basePrice: unitPrice(model, settings, false),
      warning: settings.warningThreshold,
      danger: settings.dangerThreshold,
      refreshIntervalMs: settings.refreshIntervalMs,
    }
  }

  // Per-turn cost: one session projection, priced at each settlement's own time.
  if (zod !== null && zod.object !== undefined && typeof zod.object === 'function') {
    const stateSchema = zod.object({
      model: zod.string(),
      total: zod.number().nonnegative(),
      turns: zod.number().int().nonnegative(),
      last: zod.object({
        turn: zod.number().int().nonnegative(),
        step: zod.number().int().nonnegative(),
        cost: zod.number().nonnegative(),
      }).strict().nullable(),
    }).strict()
    const viewSchema = zod.object({
      total: zod.number().nonnegative(),
      turns: zod.number().int().nonnegative(),
    }).strict()
    ctx.inject(['sessionProjections'], (sub) => {
      sub.effect(() => sub.sessionProjections.register({
        key: 'composerBalanceCost',
        stateVersion: 1,
        stateSchema,
        init: () => initCostState(),
        apply: (state, event) => foldCost(state, event, settings),
        wire: { viewSchema, view: (state) => ({ total: state.total, turns: state.turns }) },
      }) && (projectionReady = true), 'dsh-composer-balance: cost projection')
    })
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' })
        res.end()
        return
      }
      // Connection admission: identity (browser session or API peer) plus the
      // host's Origin/Host fence, exactly as the host's own routes require.
      // The forced refresh below shares this gate: an unadmitted caller can
      // neither read the balance nor spend the host's key on a provider read.
      // Missing or failing admission refuses the request (fail closed).
      const connection = ctx.get('connection')
      let rejection
      if (connection === undefined || typeof connection.admit !== 'function') {
        rejection = 503
      } else {
        try {
          const admission = connection.admit(req)
          if (admission === undefined || 'rejection' in admission) {
            rejection = admission?.rejection ?? 401
          }
        } catch {
          rejection = 503
        }
      }
      if (rejection !== undefined) {
        sendJson(res, rejection, {
          ok: false,
          status: rejection === 403 ? 'forbidden' : rejection === 503 ? 'unavailable' : 'unauthorized',
          error: rejection === 403 ? 'untrusted origin' : rejection === 503 ? 'connection service unavailable' : 'unauthenticated',
        })
        return
      }
      const url = req.url ?? ''
      const force = /[?&]force=1(?:&|$)/.test(url)
      await readOnce(force)
      const body = payload()
      // the browser names its session, so the answer can carry that session's
      // per-turn cost replayed from its own log (see sessionCost above)
      const asked = /[?&]session=([^&]+)/.exec(url)
      if (asked !== null) {
        state.lastSession = decodeURIComponent(asked[1])
        const replayed = sessionCost(decodeURIComponent(asked[1]))
        if (replayed !== undefined) body.cost = replayed
      }
      sendJson(res, 200, body)
    },
  }), 'dsh-composer-balance: route')

  // warm the cache once the app is up, then keep it fresh on the same cadence
  ctx.effect(() => {
    void readOnce(false)
    const timer = setInterval(() => void readOnce(false), Math.max(1000, settings.refreshIntervalMs))
    return () => clearInterval(timer)
  }, 'dsh-composer-balance: refresh loop')
}
