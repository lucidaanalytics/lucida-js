package com.lucida.core

/**
 * Privacy passes applied to a walked tree before it is encoded or turned into a screenshot mask plan: P-M17 masked
 * screens (every mask switch on, unmask markers ignored) and P-M46 text patterns. Remote config adds to the local
 * lists, so it can only tighten.
 */
object ReplayMasking {
    /** Patterns that fail to compile are dropped, never fatal. No built-in patterns: the server masks emails/cards/phones again. */
    fun compile(patterns: List<String>): List<Regex> = patterns.filter { it.isNotEmpty() }.distinct().mapNotNull { runCatching { Regex(it) }.getOrNull() }

    /** Every character inside a match of any pattern becomes `*` (whitespace kept), like [Wireframe.stars]. */
    fun maskPatterns(text: String, patterns: List<Regex>): String {
        if (patterns.isEmpty() || text.isEmpty()) return text
        val hit = BooleanArray(text.length)
        patterns.forEach { re -> re.findAll(text).forEach { m -> for (i in m.range) hit[i] = true } }
        if (hit.none { it }) return text
        return String(CharArray(text.length) { i -> if (hit[i] && !text[i].isWhitespace()) '*' else text[i] })
    }

    fun matches(text: String, patterns: List<Regex>) = patterns.any { it.containsMatchIn(text) }

    /**
     * [maskScreen] masks every text, input value and image of the tree. Patterns star matches in wireframe text (masked
     * text is starred anyway, so applying them to all text is equivalent); with [screenshot] a matching node is blocked,
     * so its pixels are painted over last, after unmask regions are restored.
     */
    fun apply(root: ViewNode, maskScreen: Boolean, patterns: List<Regex>, screenshot: Boolean): ViewNode {
        if (!maskScreen && patterns.isEmpty()) return root
        fun walk(n: ViewNode): ViewNode {
            var out = if (maskScreen) n.copy(maskText = true, maskInput = true, maskImage = true) else n
            val t = n.text
            if (!t.isNullOrEmpty() && patterns.isNotEmpty()) {
                out = if (!screenshot) out.copy(text = maskPatterns(t, patterns)) else if (matches(t, patterns)) out.copy(block = true) else out
            }
            return out.copy(children = n.children.map(::walk))
        }
        return walk(root)
    }

    /** On a masked screen marker unmask regions stop counting; mask regions always do. */
    fun regions(regions: List<MarkerRegion>, maskScreen: Boolean) = if (maskScreen) regions.filter { it.role == MarkerRole.MASK } else regions
}
