package com.lucida.core

import java.net.URLEncoder
import java.util.TimeZone

/** A guide as `GET /v1/guides` serves it (the same definitions the browser SDK renders). */
data class MobileGuide(
    val id: String, val name: String, val kind: String, val steps: List<GuideStep>, val conditions: Obj, val preview: Boolean = false, val heldOut: Boolean = false,
    /** Resolved appearance (the gateway merges the project theme in): tokens, dark.tokens, theme_mode, font_family. */
    val appearance: Obj? = null,
    /** A workflow queued this guide for this person (gateway): it goes first and skips sampling. */
    val queued: Boolean = false,
)

/**
 * [nativeId]: the anchor view's tag (a String) or resource entry name (tooltip, hotspot and tour steps; web selectors
 * are ignored). [waitMs]: how long to wait for that view (default 3000, max 15000) before showing the step unanchored.
 */
data class GuideStep(
    val id: String, val title: String?, val body: String?, val buttons: List<GuideButton>?,
    val nativeId: String? = null, val placement: String? = null, val waitMs: Long? = null,
)

/** Where an anchored step points. [hotspot]: a pulsing dot on the view opens the step when tapped. */
data class GuideAnchor(val nativeId: String, val placement: String?, val waitMs: Long, val hotspot: Boolean)

/**
 * Optional port extension: a presenter that can point a step at a native view (adapter: AlertGuidePresenter). When the
 * view does not appear within [GuideAnchor.waitMs] it calls [onMissing] and shows the step unanchored.
 */
interface AnchoredGuidePresenter : GuidePresenter {
    fun presentAnchored(guide: MobileGuide, step: Int, buttons: List<GuideButton>, anchor: GuideAnchor, onMissing: () -> Unit, onAction: (GuideButton?) -> Unit)
}

/** action: next | back | dismiss | link | event (start_tour behaves like next on mobile). */
data class GuideButton(val label: String, val action: String, val url: String? = null, val event: String? = null)

/**
 * Port: draws one guide step natively, callable from any thread (the adapter hops to the main thread).
 * [onAction] gets the tapped button, or null when the person closed the step without one (a dismissal).
 */
interface GuidePresenter {
    fun present(guide: MobileGuide, step: Int, buttons: List<GuideButton>, onAction: (GuideButton?) -> Unit)
    fun open(url: String)
}

/** Off by default: no `/v1/guides` request until the app opts in. */
class GuidesConfig(@Volatile var enabled: Boolean = false, @Volatile var presenter: GuidePresenter? = null)

/**
 * In-app guides on mobile (LC-ENG-15). Kinds modal, banner, announcement, slideout, carousel (Back / Next), tour
 * (steps in order), and tooltip / hotspot when the presenter anchors ([AnchoredGuidePresenter], N-DAP-10: the step's
 * native_id names the view; a missing view emits $guide_target_missing and the step shows unanchored). Web step
 * selectors are ignored. Targeting: url (screen name; url_match exact/contains/regex), flag_key,
 * sample_pct, devices (mobile or tablet), seen_guides / not_seen_guides, schedule (window plus weekday / hour
 * recurrence), frequency, and A/B ab_group / holdout_pct (G241: the gateway picks the variant and holdout for
 * this distinct id and decides recurrence in the zone sent as `tz`). A guide using any other targeting key is
 * skipped. Without frequency a guide shows once per device, a repeatable one at most once per screen visit; one
 * at a time; preview guides are quiet, once per launch. Shows are synced to the guide-state store so a cap
 * counts every device. Events: $guide_shown, $guide_step, $guide_completed, $guide_dismissed, $guide_holdout.
 */
class GuidesService(
    private val core: Core,
    private val config: GuidesConfig,
    private val random: () -> Double = { Math.random() },
    private val now: () -> Long = System::currentTimeMillis,
    /** Runs the guide-state sync off the caller's thread; tests run it inline. */
    private val background: (() -> Unit) -> Unit = { Thread(it).start() },
    private val flag: (String) -> Boolean,
) {
    private val lock = Any()
    private var guides: List<MobileGuide> = emptyList()
    private val seen: MutableSet<String> = HashSet()
    private val previewed = HashSet<String>()
    private var showing = false
    private var screen: String? = null
    private val views = HashMap<String, List<Long>>()
    private val held = HashSet<String>()
    private val shownHere = HashSet<String>()

    init {
        core.storage.get(SEEN)?.let { raw -> runCatching { (Json.decode(raw) as List<*>).forEach { (it as? String)?.let(seen::add) } } }
        core.storage.get(HELD_KEY)?.let { raw -> runCatching { (Json.decode(raw) as List<*>).forEach { (it as? String)?.let(held::add) } } }
        core.storage.get(GuideRules.VIEWS)?.let { raw ->
            runCatching { (Json.decode(raw) as Map<*, *>).forEach { (k, v) -> views[k.toString()] = (v as List<*>).mapNotNull { (it as? Number)?.toLong() } } }
        }
    }

    /** Fetches the project's live guides (needs analytics consent), then re-evaluates the current screen. Blocks. */
    fun reload() {
        if (!config.enabled || !core.consent.has("analytics")) return
        val q = "api_key=${enc(core.cfg.apiKey)}&distinct_id=${enc(core.distinctId)}&tz=${enc(TimeZone.getDefault().id)}"
        val r = core.cfg.http.send("GET", "${core.host}/v1/guides?$q")
        if (r.status !in 200..299) return
        val list = (runCatching { Json.decodeObj(r.body) }.getOrNull()?.get("guides") as? List<*>) ?: emptyList<Any?>()
        val parsed = list.mapNotNull { runCatching { parse(it as Obj) }.getOrNull() }
        val fresh = synchronized(lock) { parsed.filter { it.heldOut && held.add(it.id) } }
        if (fresh.isNotEmpty()) core.storage.set(HELD_KEY, Json.encode(synchronized(lock) { held.sorted() }))
        for (g in fresh) {
            val grp = (g.conditions["ab_group"] as? String).orEmpty()
            core.capture("\$guide_holdout", props(g, if (grp.isEmpty()) emptyMap() else mapOf("\$guide_group" to grp)))
        }
        val at = synchronized(lock) {
            guides = parsed
            screen
        }
        if (at != null) show(at)
    }

    /** The app moved to [name]: show the first eligible guide, if none is on screen. */
    fun show(name: String) {
        val g = synchronized(lock) {
            if (screen != name) shownHere.clear()
            screen = name
            if (showing) return
            // workflow-queued guides go first
            val pick = (guides.filter { it.queued } + guides.filter { !it.queued }).firstOrNull { eligible(it, name) } ?: return
            showing = true
            shownHere.add(pick.id)
            if (pick.preview) previewed.add(pick.id)
            pick
        }
        val p = config.presenter
        if (p == null) {
            synchronized(lock) { showing = false }
            return
        }
        if (!g.preview) {
            markSeen(g.id)
            recordView(g.id)
            core.capture("\$guide_shown", props(g))
        }
        present(p, g, 0)
    }

    private fun eligible(g: MobileGuide, name: String): Boolean {
        if (g.kind !in KINDS || g.steps.isEmpty()) return false
        // tooltip / hotspot exist only next to a view: they need an anchor and a presenter that can draw one
        if ((g.kind == "tooltip" || g.kind == "hotspot") && (g.steps[0].nativeId.isNullOrEmpty() || config.presenter !is AnchoredGuidePresenter)) return false
        if (g.preview) return g.id !in previewed
        val c = g.conditions
        // null, "" and [] are the editor's "not set"
        val used = c.filterValues { !(it == null || it == "" || (it is List<*> && it.isEmpty())) }.keys
        if (g.heldOut || g.id in shownHere || !HANDLED.containsAll(used)) return false
        val freq = c["frequency"] as? Map<*, *>
        if (freq != null) {
            if (!GuideRules.frequencyOk(freq, views[g.id] ?: emptyList(), now())) return false
        } else if (g.id in seen) {
            return false
        }
        if (!GuideRules.scheduleOk(c["schedule"] as? Map<*, *>, now())) return false
        val url = c["url"] as? String
        if (!url.isNullOrEmpty() && !matches(name, url, c["url_match"] as? String ?: "contains")) return false
        val fk = c["flag_key"] as? String
        if (!fk.isNullOrEmpty() && !flag(fk)) return false
        if (excluded(name, (c["exclude_url_patterns"] as? List<*>)?.filterIsInstance<String>() ?: emptyList())) return false
        val pct = c["sample_pct"] as? Number
        if (!g.queued && pct != null && random() * 100 >= pct.toDouble()) return false
        val devices = c["devices"] as? List<*>
        if (devices != null && devices.isNotEmpty() && devices.none { it == "mobile" || it == "tablet" }) return false
        val need = c["seen_guides"] as? List<*>
        if (need != null && !need.all { ((it as? String) ?: "") in seen }) return false
        val not = c["not_seen_guides"] as? List<*>
        if (not != null && not.any { ((it as? String) ?: "") in seen }) return false
        return true
    }

    private fun present(p: GuidePresenter, g: MobileGuide, i: Int) {
        val a = anchor(g, i)
        if (a != null && p is AnchoredGuidePresenter) {
            val stepId = g.steps[i].id
            val onMissing = {
                if (!g.preview) core.capture("\$guide_target_missing", props(g, mapOf("guide_id" to g.id, "step_id" to stepId, "\$guide_step_id" to stepId, "selector" to a.nativeId)))
            }
            return p.presentAnchored(g, i, buttons(g, i), a, onMissing) { handle(p, g, i, it) }
        }
        p.present(g, i, buttons(g, i)) { handle(p, g, i, it) }
    }

    private fun handle(p: GuidePresenter, g: MobileGuide, i: Int, b: GuideButton?) {
        val quiet = g.preview
        val stepProps: Obj = mapOf("\$guide_step_id" to g.steps[i].id, "\$guide_step_index" to i)
        if (b == null || b.action == "dismiss") {
            if (!quiet) core.capture("\$guide_dismissed", props(g, stepProps))
            return finish()
        }
        val action = b.action
        if (action == "back") return present(p, g, maxOf(i - 1, 0))
        if (action == "link") b.url?.takeIf { it.startsWith("https://") }?.let(p::open)
        if (action == "event" && !quiet && !b.event.isNullOrEmpty()) core.capture(b.event, mapOf("\$guide_id" to g.id))
        if (!quiet) core.capture("\$guide_step", props(g, stepProps))
        if (i + 1 < g.steps.size && action != "link") return present(p, g, i + 1)
        if (!quiet) core.capture("\$guide_completed", props(g))
        finish()
    }

    private fun finish() {
        val at = synchronized(lock) {
            showing = false
            screen
        }
        if (at != null) show(at) // the next eligible guide, if any
    }

    private fun markSeen(id: String) {
        val list = synchronized(lock) {
            seen.add(id)
            seen.sorted()
        }
        core.storage.set(SEEN, Json.encode(list))
    }

    private fun recordView(id: String) {
        val all = synchronized(lock) {
            views[id] = ((views[id] ?: emptyList()) + now()).takeLast(GuideRules.MAX_VIEWS)
            HashMap(views)
        }
        core.storage.set(GuideRules.VIEWS, Json.encode(all))
        background { syncViews(all) }
    }

    /**
     * Read-modify-write of the person's guide state (`POST /v1/guide-state`, analytics consent only): this
     * device's views are merged in and every other key the browser SDK wrote is kept. Blocks.
     */
    fun syncViews(local: Map<String, List<Long>>) {
        if (!core.consent.has("analytics")) return
        val url = "${core.host}/v1/guide-state"
        val base: Obj = mapOf("api_key" to core.cfg.apiKey, "distinct_id" to core.distinctId)
        val json = mapOf("Content-Type" to "application/json")
        val r = runCatching { core.cfg.http.send("POST", url, Json.encode(base), json) }.getOrNull() ?: return
        if (r.status !in 200..299) return
        @Suppress("UNCHECKED_CAST")
        val state = (runCatching { Json.decodeObj(r.body) }.getOrNull()?.get("state") as? Obj) ?: emptyMap()
        runCatching { core.cfg.http.send("POST", url, Json.encode(base + ("state" to GuideRules.merged(state, local))), json) }
    }

    private fun props(g: MobileGuide, extra: Obj = emptyMap()): Obj = extra + mapOf("\$guide_id" to g.id, "\$guide_kind" to g.kind)

    @Suppress("UNCHECKED_CAST")
    private fun parse(o: Obj) = MobileGuide(
        id = o["id"] as String,
        name = o["name"] as String,
        kind = o["kind"] as String,
        steps = (o["steps"] as List<Obj>).map { s ->
            GuideStep(
                s["id"] as String, s["title"] as? String, s["body"] as? String,
                (s["buttons"] as? List<Obj>)?.map { GuideButton(it["label"] as String, it["action"] as String, it["url"] as? String, it["event"] as? String) },
                nativeId = s["native_id"] as? String, placement = s["placement"] as? String, waitMs = (s["wait_ms"] as? Number)?.toLong(),
            )
        },
        conditions = o["conditions"] as? Obj ?: emptyMap(),
        preview = o["preview"] == true,
        heldOut = o["held_out"] == true,
        appearance = o["appearance"] as? Obj,
        queued = o["queued"] == true,
    )

    companion object {
        private const val SEEN = "lc_guide_seen"
        private const val HELD_KEY = GuideRules.HELD
        val KINDS = setOf("modal", "banner", "announcement", "slideout", "tour", "carousel", "tooltip", "hotspot")
        /** Kinds whose steps may point at a native view. */
        val ANCHORABLE = setOf("tooltip", "hotspot", "tour")

        /** The anchor of step [i], when its guide kind anchors and the step names a view. */
        fun anchor(g: MobileGuide, i: Int): GuideAnchor? {
            val s = g.steps[i]
            val id = s.nativeId
            if (g.kind !in ANCHORABLE || id.isNullOrEmpty()) return null
            return GuideAnchor(id, s.placement, (s.waitMs ?: 3000L).coerceIn(0L, 15_000L), g.kind == "hotspot")
        }
        val HANDLED = setOf(
            "url", "url_match", "flag_key", "sample_pct", "devices", "seen_guides", "not_seen_guides", "delay_seconds", "goal",
            "schedule", "frequency", "ab_group", "ab_weight", "holdout_pct", "holdout_scope", "exclude_url_patterns",
        )

        /** Project-wide exclusions matched against the screen name: `*` globs, the same patterns the web matches against URLs. */
        fun excluded(screen: String, patterns: List<String>): Boolean = patterns.any { p ->
            p.isNotEmpty() && Regex(p.split("*").joinToString(".*") { Regex.escape(it) }).matches(screen)
        }

        private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

        fun matches(screen: String, pattern: String, how: String): Boolean = when (how) {
            "exact" -> screen == pattern
            "regex" -> runCatching { Regex(pattern).containsMatchIn(screen) }.getOrDefault(false)
            else -> screen.contains(pattern)
        }

        fun buttons(g: MobileGuide, i: Int): List<GuideButton> {
            g.steps[i].buttons?.takeIf { it.isNotEmpty() }?.let { return it }
            if (g.kind == "banner" || g.kind == "announcement") return listOf(GuideButton("Dismiss", "dismiss"))
            if (g.kind == "carousel") {
                val last = i == g.steps.size - 1
                return (if (i > 0) listOf(GuideButton("Back", "back")) else emptyList()) + listOf(GuideButton(if (last) "Done" else "Next", "next"), GuideButton("Dismiss", "dismiss"))
            }
            return listOf(GuideButton(if (i == g.steps.size - 1) "Done" else "Next", "next"), GuideButton("Dismiss", "dismiss"))
        }
    }
}
