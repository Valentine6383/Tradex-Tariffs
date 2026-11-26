package ru.k2monitor

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * Держит связь с принтером в фоне и показывает плашку в шторке/на экране блокировки,
 * как плеер у музыки: прогресс, время, слой, кнопки «Пауза» и «Открыть».
 */
class PrinterService : Service() {

    companion object {
        const val CH_IDLE = "idle"
        const val CH_PRINT = "print"
        const val CH_DONE = "done"
        const val NID = 1
        const val NID_DONE = 2
        const val ACT_RECONNECT = "reconnect"
        const val ACT_PAUSE = "pause"
        const val ACT_RESUME = "resume"
        const val PREFS = "k2"

        fun start(ctx: Context, action: String? = null) {
            val i = Intent(ctx, PrinterService::class.java)
            if (action != null) i.action = action
            ctx.startForegroundService(i)
        }
    }

    private val main = Handler(Looper.getMainLooper())
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()
    private var ws: WebSocket? = null
    private var ip = ""
    private var connected = false
    private var lastMsg = 0L
    private val state = JSONObject()
    private var thumb: Bitmap? = null
    private var thumbKey = ""
    private var wasActive = false
    private var gen = 0

    private val heartbeat = object : Runnable {
        override fun run() {
            send(JSONObject().put("ModeCode", "heart_beat").put("msg", System.currentTimeMillis().toString()))
            if (connected && System.currentTimeMillis() - lastMsg > 30000) connect()
            if (!connected && ws == null && ip.isNotEmpty()) connect()
            main.postDelayed(this, 10000)
        }
    }
    private val refresh = Runnable { updateNotification() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_IDLE, "Связь с принтером", NotificationManager.IMPORTANCE_MIN))
        nm.createNotificationChannel(NotificationChannel(CH_PRINT, "Идёт печать", NotificationManager.IMPORTANCE_LOW).apply {
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        })
        nm.createNotificationChannel(NotificationChannel(CH_DONE, "Печать завершена", NotificationManager.IMPORTANCE_HIGH))
        val n = buildNotification()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NID, n)
        }
        main.postDelayed(heartbeat, 10000)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACT_PAUSE -> set(JSONObject().put("pause", 1))
            ACT_RESUME -> set(JSONObject().put("pause", 0))
        }
        val newIp = getSharedPreferences(PREFS, MODE_PRIVATE).getString("ip", "") ?: ""
        if (newIp != ip || intent?.action == ACT_RECONNECT || (ws == null && newIp.isNotEmpty())) {
            ip = newIp
            connect()
        }
        updateNotification()
        return START_STICKY
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        gen++
        ws?.cancel()
        super.onDestroy()
    }

    private fun connect() {
        gen++
        val myGen = gen
        ws?.cancel()
        ws = null
        connected = false
        if (ip.isEmpty()) { updateNotification(); return }
        val req = Request.Builder().url("ws://$ip:9999").build()
        ws = client.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                main.post {
                    if (myGen != gen) return@post
                    connected = true
                    lastMsg = System.currentTimeMillis()
                    webSocket.send(JSONObject().put("method", "get")
                        .put("params", JSONObject().put("ReqPrinterPara", 1)).toString())
                    updateNotification()
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                main.post {
                    if (myGen != gen) return@post
                    lastMsg = System.currentTimeMillis()
                    val o = try { JSONObject(text) } catch (e: Exception) { return@post }
                    if (o.optString("ModeCode") == "heart_beat") {
                        webSocket.send(JSONObject().put("ModeCode", "heart_beat").put("msg", "ok").toString())
                        return@post
                    }
                    val keys = o.keys()
                    while (keys.hasNext()) { val k = keys.next(); state.put(k, o.get(k)) }
                    scheduleRefresh()
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = lost()
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = lost()

            private fun lost() {
                main.post {
                    if (myGen != gen) return@post
                    connected = false
                    ws = null
                    updateNotification()
                    main.postDelayed({ if (myGen == gen && ws == null) connect() }, 5000)
                }
            }
        })
    }

    private fun send(o: JSONObject) { ws?.send(o.toString()) }
    private fun set(params: JSONObject) = send(JSONObject().put("method", "set").put("params", params))

    private fun scheduleRefresh() {
        main.removeCallbacks(refresh)
        main.postDelayed(refresh, 700)
    }

    private fun num(key: String): Double? {
        if (!state.has(key)) return null
        return state.optString(key).toDoubleOrNull()
    }

    private fun stateCode(): Int = num("state")?.toInt() ?: -1

    private fun isActive(): Boolean {
        val st = stateCode()
        if (st == 1 || st == 5) return true
        val p = num("printProgress") ?: 0.0
        return state.optString("printFileName").isNotEmpty() && p > 0 && p < 100 && st !in listOf(2, 3, 4)
    }

    private fun fileName(): String =
        state.optString("printFileName").substringAfterLast('/').substringAfterLast('\\')
            .replace(Regex("\\.(gcode|gco|g)$", RegexOption.IGNORE_CASE), "")

    private fun fmt(sec: Double?): String {
        if (sec == null || sec < 0) return "—"
        val s = sec.toLong()
        val h = s / 3600
        val m = (s % 3600) / 60
        return if (h > 0) "${h} ч ${m} мин" else "${m} мин"
    }

    private fun openApp(): PendingIntent = PendingIntent.getActivity(
        this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    private fun action(act: String, req: Int): PendingIntent = PendingIntent.getService(
        this, req, Intent(this, PrinterService::class.java).setAction(act),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    private fun loadThumb() {
        val key = "$ip|${state.optString("printFileName")}"
        if (key == thumbKey) return
        thumbKey = key
        thumb = null
        val url = "http://$ip/downloads/original/current_print_image.png?t=${System.currentTimeMillis()}"
        Thread {
            try {
                client.newCall(Request.Builder().url(url).build()).execute().use { r ->
                    if (r.isSuccessful) {
                        val bmp = r.body?.byteStream()?.let { BitmapFactory.decodeStream(it) }
                        main.post { if (thumbKey == key) { thumb = bmp; updateNotification() } }
                    }
                }
            } catch (_: Exception) {}
        }.start()
    }

    private fun buildNotification(): Notification {
        val active = connected && isActive()
        val b = Notification.Builder(this, if (active) CH_PRINT else CH_IDLE)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentIntent(openApp())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_PROGRESS)

        if (!active) {
            b.setContentTitle("K2 Монитор")
            b.setContentText(
                when {
                    ip.isEmpty() -> "Укажи принтер в приложении"
                    connected -> "Принтер на связи · печати нет"
                    else -> "Нет связи с принтером ($ip)"
                }
            )
            return b.build()
        }

        val pct = (num("printProgress") ?: 0.0).toInt().coerceIn(0, 100)
        val left = num("printLeftTime")
        val paused = stateCode() == 5
        val layer = num("layer")?.toInt()
        val total = (num("TotalLayer") ?: num("totalLayer"))?.toInt()
        val parts = mutableListOf<String>()
        parts.add(if (paused) "⏸ Пауза" else "$pct%")
        if (left != null) {
            parts.add("осталось ${fmt(left)}")
            val eta = SimpleDateFormat("HH:mm", Locale("ru")).format(Date(System.currentTimeMillis() + (left * 1000).toLong()))
            parts.add("до $eta")
        }
        if (layer != null) parts.add("слой $layer${if (total != null && total > 0) "/$total" else ""}")
        val temps = listOfNotNull(
            num("nozzleTemp")?.let { "сопло ${it.toInt()}°" },
            (num("bedTemp0") ?: num("bedTemp"))?.let { "стол ${it.toInt()}°" }
        ).joinToString(" · ")

        b.setContentTitle(fileName().ifEmpty { "Печать" })
            .setContentText(parts.joinToString(" · "))
            .setSubText(temps.ifEmpty { null })
            .setProgress(100, pct, false)
            .setStyle(Notification.BigTextStyle().bigText(parts.joinToString(" · ") + if (temps.isNotEmpty()) "\n$temps" else ""))
        thumb?.let { b.setLargeIcon(it) }
        if (paused) {
            b.addAction(Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_play), "Продолжить", action(ACT_RESUME, 2)).build())
        } else {
            b.addAction(Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_pause), "Пауза", action(ACT_PAUSE, 1)).build())
        }
        b.addAction(Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_stat), "Открыть", openApp()).build())
        return b.build()
    }

    private fun updateNotification() {
        val active = connected && isActive()
        if (active) loadThumb()
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NID, buildNotification())
        if (wasActive && !active && connected) {
            val st = stateCode()
            val title = when (st) { 2 -> "Печать готова ✓"; 3 -> "Ошибка печати"; 4 -> "Печать остановлена"; else -> "Печать закончилась" }
            nm.notify(NID_DONE, Notification.Builder(this, CH_DONE)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(title)
                .setContentText(fileName())
                .setContentIntent(openApp())
                .setAutoCancel(true)
                .build())
        }
        if (active) nm.cancel(NID_DONE)
        wasActive = active
    }
}
