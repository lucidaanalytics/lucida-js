package com.lucida.android

import android.content.Context
import com.lucida.core.KeyValueStore

/** [KeyValueStore] over SharedPreferences (`apply()`: async disk write, instant in-memory read). */
class SharedPrefsStore(context: Context, name: String = "lucida") : KeyValueStore {
    private val prefs = context.applicationContext.getSharedPreferences(name, Context.MODE_PRIVATE)

    override fun get(key: String): String? = prefs.getString(key, null)

    override fun set(key: String, value: String) = prefs.edit().putString(key, value).apply()

    override fun remove(key: String) = prefs.edit().remove(key).apply()
}
