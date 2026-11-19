package com.lucida.core

import java.security.SecureRandom

private val rng = SecureRandom()

/** UUIDv7: 48-bit ms timestamp, version 7, random remainder. */
fun uuidv7(nowMs: Long): String {
    val b = ByteArray(16).also(rng::nextBytes)
    for (i in 0 until 6) b[i] = (nowMs shr (8 * (5 - i))).toByte()
    b[6] = (0x70 or (b[6].toInt() and 0x0f)).toByte()
    b[8] = (0x80 or (b[8].toInt() and 0x3f)).toByte()
    val h = b.joinToString("") { "%02x".format(it) }
    return "${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}"
}
