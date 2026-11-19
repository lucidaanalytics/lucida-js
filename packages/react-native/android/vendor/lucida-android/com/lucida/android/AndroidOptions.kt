package com.lucida.android

import com.lucida.core.AutocaptureConfig
import com.lucida.core.BeforeSend
import com.lucida.core.Bootstrap
import com.lucida.core.FlagOptions
import com.lucida.core.PersonProfiles
import com.lucida.core.QueueCipher

enum class DataMode { ANY, WIFI }

/** Everything beyond the required init arguments. Defaults match the previous behaviour. */
data class AndroidOptions(
    val beforeSend: List<BeforeSend> = emptyList(),
    val personProfiles: PersonProfiles = PersonProfiles.ALWAYS,
    val disableGeoip: Boolean = false,
    val disabled: Boolean = false,
    val debug: Boolean = false,
    val bootstrap: Bootstrap? = null,
    val flags: FlagOptions = FlagOptions(),
    val autocapture: AutocaptureConfig = AutocaptureConfig(),
    /** Capture `$deep_link_opened` for the launching intent's data URI. */
    val captureDeepLinks: Boolean = true,
    /** Send Play Install Referrer data (utm/click ids) on the first-open `$app_installed`; needs the installreferrer library in the app. */
    val installAttribution: Boolean = true,
    val reuseAnonymousId: Boolean = false,
    val anonymousIdProvider: (() -> String)? = null,
    val queueCipher: QueueCipher? = null,
    val tracingHeaders: List<String> = emptyList(),
    val flushAt: Int = 20,
    val flushIntervalMs: Long = 5000,
    val maxQueueSize: Int = 1000,
    val maxBatchSize: Int = 100,
    val maxRetries: Int = 5,
    val retryDelayMs: Long = 1000,
    val requestTimeoutMs: Int = 15_000,
    /** WIFI: flush only on Wi-Fi/Ethernet; events wait in the queue otherwise. */
    val dataMode: DataMode = DataMode.ANY,
    val sessionIdleMs: Long = 30 * 60_000,
    val sessionMaxMs: Long = 24 * 3_600_000,
)
