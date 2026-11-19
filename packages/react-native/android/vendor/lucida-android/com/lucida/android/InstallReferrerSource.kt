package com.lucida.android

import android.content.Context
import com.android.installreferrer.api.InstallReferrerClient
import com.android.installreferrer.api.InstallReferrerStateListener
import com.lucida.core.InstallSource
import com.lucida.core.installReferrerProps

/**
 * Google Play Install Referrer as an [InstallSource]. The library is `compileOnly`: when the host app does not ship
 * `com.android.installreferrer:installreferrer`, the source degrades to `$install_store` only.
 */
internal object InstallReferrerSource {
    private val STORE_ONLY = mapOf<String, Any?>("\$install_store" to "google_play")

    fun create(ctx: Context): InstallSource = { done ->
        try {
            val client = InstallReferrerClient.newBuilder(ctx).build()
            client.startConnection(object : InstallReferrerStateListener {
                override fun onInstallReferrerSetupFinished(code: Int) {
                    val props = try {
                        if (code == InstallReferrerClient.InstallReferrerResponse.OK) {
                            val r = client.installReferrer
                            installReferrerProps(r.installReferrer ?: "", r.referrerClickTimestampSeconds, r.installBeginTimestampSeconds)
                        } else STORE_ONLY
                    } catch (_: Throwable) { STORE_ONLY }
                    try { client.endConnection() } catch (_: Throwable) {}
                    done(props)
                }

                override fun onInstallReferrerServiceDisconnected() = Unit
            })
        } catch (_: Throwable) { // includes NoClassDefFoundError when the library is absent
            done(STORE_ONLY)
        }
    }
}
