package com.lucida.core

import java.io.ByteArrayOutputStream
import java.math.BigInteger
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.spec.MGF1ParameterSpec
import java.security.spec.RSAPublicKeySpec
import javax.crypto.Cipher
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource

/** The project's RSA public key (P-L12): [n] / [e] base64url without padding, [pkcs1] standard base64 of the PKCS#1 DER. */
data class ExposureKey(val kid: String, val n: String, val e: String, val pkcs1: String)

/** Base64 without java.util.Base64 (API 26) or android.util.Base64 (not on the JVM): lucida-core runs on minSdk 23. */
object Base64Codec {
    private const val STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

    fun encode(b: ByteArray): String {
        val sb = StringBuilder((b.size + 2) / 3 * 4)
        var i = 0
        while (i < b.size) {
            val n = (b[i].toInt() and 0xff shl 16) or ((if (i + 1 < b.size) b[i + 1].toInt() and 0xff else 0) shl 8) or (if (i + 2 < b.size) b[i + 2].toInt() and 0xff else 0)
            sb.append(STD[n shr 18 and 63]).append(STD[n shr 12 and 63])
            sb.append(if (i + 1 < b.size) STD[n shr 6 and 63] else '=').append(if (i + 2 < b.size) STD[n and 63] else '=')
            i += 3
        }
        return sb.toString()
    }

    /** Standard or url-safe alphabet, padding optional; null on any other character. */
    fun decode(s: String): ByteArray? {
        val out = ByteArrayOutputStream(s.length * 3 / 4)
        var acc = 0
        var bits = 0
        for (c in s.trimEnd('=')) {
            val v = when (c) {
                in 'A'..'Z' -> c - 'A'
                in 'a'..'z' -> c - 'a' + 26
                in '0'..'9' -> c - '0' + 52
                '+', '-' -> 62
                '/', '_' -> 63
                else -> return null
            }
            acc = ((acc shl 6) or v) and 0xffff
            bits += 6
            if (bits >= 8) {
                bits -= 8
                out.write(acc shr bits and 0xff)
            }
        }
        return out.toByteArray()
    }
}

/**
 * P-L12 controlled exposure: a listed field's value, RSA-OAEP encrypted (SHA-256 for both the OAEP hash and MGF1, empty
 * label) with the project key, so only an audited reveal on the server can read it. Identical values are sent once per
 * session (an in-memory SHA-256 set, never persisted or sent). Encryption failure sends nothing.
 */
class SensitiveCapture {
    private val seen = HashSet<String>()
    private var seenSession: String? = null

    /** `$sensitive_capture` properties, or null when this value was already sent this session or encryption failed. */
    fun properties(field: String, value: String, screen: String, key: ExposureKey, sessionId: String): Obj? {
        val digest = sha256Hex(field + "\u0000" + value)
        synchronized(this) {
            if (seenSession != sessionId) {
                seen.clear()
                seenSession = sessionId
            }
            if (!seen.add(digest)) return null
        }
        val (plain, truncated) = truncate(value)
        val ct = encrypt(plain, key)
        if (ct == null) {
            synchronized(this) { seen.remove(digest) }
            return null
        }
        return buildMap {
            put("\$exposure_field", field)
            put("\$exposure_kid", key.kid)
            put("\$exposure_ciphertext", ct)
            put("\$screen_name", screen)
            if (truncated) put("\$exposure_truncated", true)
        }
    }

    companion object {
        const val MAX_PLAIN_BYTES = 190

        /** UTF-8 of [value], cut to at most [max] bytes on a code point boundary; true when cut. */
        fun truncate(value: String, max: Int = MAX_PLAIN_BYTES): Pair<ByteArray, Boolean> {
            val out = ByteArrayOutputStream()
            var i = 0
            while (i < value.length) {
                val cp = value.codePointAt(i)
                val b = String(Character.toChars(cp)).toByteArray(Charsets.UTF_8)
                if (out.size() + b.size > max) return out.toByteArray() to true
                out.write(b)
                i += Character.charCount(cp)
            }
            return out.toByteArray() to false
        }

        /** Standard base64 of the RSA-OAEP-SHA256 (MGF1-SHA256, not the SHA-1 default) ciphertext, or null. */
        fun encrypt(plain: ByteArray, key: ExposureKey): String? = runCatching {
            val n = Base64Codec.decode(key.n) ?: return null
            val e = Base64Codec.decode(key.e) ?: return null
            val pub = KeyFactory.getInstance("RSA").generatePublic(RSAPublicKeySpec(BigInteger(1, n), BigInteger(1, e)))
            val c = Cipher.getInstance("RSA/ECB/OAEPPadding")
            c.init(Cipher.ENCRYPT_MODE, pub, OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT))
            Base64Codec.encode(c.doFinal(plain))
        }.getOrNull()

        private fun sha256Hex(s: String) = MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
}
