package ru.k2monitor

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.ConnectivityManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONArray
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.Socket
import java.util.Collections
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Полноэкранная панель принтера (HTML в assets) + запуск фоновой службы для шторки. */
class MainActivity : Activity() {

    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.parseColor("#17181c")
        window.navigationBarColor = Color.parseColor("#17181c")
        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#17181c"))
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        web.webViewClient = WebViewClient()
        web.addJavascriptInterface(Bridge(), "Android")
        setContentView(web)
        web.loadUrl("file:///android_asset/index.html")

        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        applyKeepScreen()
        if (prefs().getString("ip", "")!!.isNotEmpty()) PrinterService.start(this)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { moveTaskToBack(true) }

    private fun prefs() = getSharedPreferences(PrinterService.PREFS, MODE_PRIVATE)

    private fun applyKeepScreen() {
        if (prefs().getBoolean("keepScreen", false)) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    inner class Bridge {
        @JavascriptInterface fun getIp(): String = prefs().getString("ip", "") ?: ""

        @JavascriptInterface fun setIp(ip: String) {
            prefs().edit().putString("ip", ip.trim()).apply()
            runOnUiThread { PrinterService.start(this@MainActivity, PrinterService.ACT_RECONNECT) }
        }

        @JavascriptInterface fun getKeepScreen(): Boolean = prefs().getBoolean("keepScreen", false)

        @JavascriptInterface fun setKeepScreen(on: Boolean) {
            prefs().edit().putBoolean("keepScreen", on).apply()
            runOnUiThread { applyKeepScreen() }
        }

        /** Ищем принтер: стучимся в порт 9999 по всей своей подсети. Ответ уходит в window.onDiscover(). */
        @JavascriptInterface fun discover() {
            Thread {
                val found = Collections.synchronizedList(mutableListOf<String>())
                try {
                    val cm = getSystemService(ConnectivityManager::class.java)
                    val lp = cm.getLinkProperties(cm.activeNetwork)
                    val my = lp?.linkAddresses?.map { it.address }?.firstOrNull { it is Inet4Address && !it.isLoopbackAddress }
                    if (my != null) {
                        val prefix = my.hostAddress!!.substringBeforeLast('.')
                        val pool = Executors.newFixedThreadPool(48)
                        for (i in 1..254) {
                            val host = "$prefix.$i"
                            pool.execute {
                                try {
                                    Socket().use { s -> s.connect(InetSocketAddress(host, 9999), 600); found.add(host) }
                                } catch (_: Exception) {}
                            }
                        }
                        pool.shutdown()
                        pool.awaitTermination(30, TimeUnit.SECONDS)
                    }
                } catch (_: Exception) {}
                val json = JSONArray(found.sorted()).toString()
                runOnUiThread { web.evaluateJavascript("window.onDiscover && window.onDiscover($json)", null) }
            }.start()
        }
    }
}
