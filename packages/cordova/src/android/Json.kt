package com.lucida.cordova

import com.lucida.core.Json
import com.lucida.core.Obj
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/** The Lucida core carries `Map<String, Any?>`; Cordova carries org.json. These two bridge them. */
internal fun JSONArray.obj(i: Int): Obj = if (isNull(i)) emptyMap() else Json.decodeObj(getJSONObject(i).toString())

/** A value for `PluginResult`-friendly callbacks: scalars pass through, maps and lists become org.json. */
internal fun toJs(v: Any?): Any? = when (v) {
    null -> JSONObject.NULL
    is Map<*, *> -> JSONObject(Json.encode(v))
    is List<*> -> JSONArray(Json.encode(v))
    else -> JSONTokener(Json.encode(v)).nextValue()
}
