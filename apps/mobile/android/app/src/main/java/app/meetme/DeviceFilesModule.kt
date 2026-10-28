package app.meetme

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.io.File

/**
 * The two ways content may leave CellMate, used only when the admin allows it (the JavaScript checks the rights):
 * copying message text, and saving a received file to the phone's Downloads folder.
 */
class DeviceFilesModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "DeviceFiles"

  private val prefs get() = reactApplicationContext.getSharedPreferences("cellmate", Context.MODE_PRIVATE)

  /** Read once when the app starts (the colours are chosen then): "system", "light" or "dark". */
  override fun getConstants(): MutableMap<String, Any> = mutableMapOf("theme" to (prefs.getString("theme", "system") ?: "system"))

  /** Light / dark choice; it takes effect when the app starts again (see restart). */
  @ReactMethod
  fun setTheme(theme: String, promise: Promise) {
    prefs.edit().putString("theme", if (theme == "light" || theme == "dark") theme else "system").apply()
    promise.resolve(null)
  }

  /** Start CellMate again (to apply the new colours). */
  @ReactMethod
  fun restart() {
    val ctx = reactApplicationContext
    val intent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    ctx.startActivity(intent)
    Runtime.getRuntime().exit(0)
  }

  @ReactMethod
  fun copyText(text: String, promise: Promise) {
    val clipboard = reactApplicationContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("CellMate", text))
    promise.resolve(null)
  }

  /** Writes the file into Downloads and resolves with where it went. */
  @ReactMethod
  fun saveToDownloads(name: String, mime: String, base64: String, promise: Promise) {
    try {
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      val safe = name.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]"), "_").take(120).ifBlank { "file" }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val values =
          ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, safe)
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/CellMate")
            put(MediaStore.Downloads.IS_PENDING, 1)
          }
        val resolver = reactApplicationContext.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: throw IllegalStateException("Could not create the file")
        resolver.openOutputStream(uri).use { out -> out?.write(bytes) ?: throw IllegalStateException("Could not write the file") }
        values.clear()
        values.put(MediaStore.Downloads.IS_PENDING, 0)
        resolver.update(uri, values, null, null)
        promise.resolve("Downloads/CellMate/$safe")
      } else {
        // Android 9 and older: the JavaScript asked for the storage permission first.
        @Suppress("DEPRECATION")
        val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "CellMate")
        dir.mkdirs()
        var file = File(dir, safe)
        var n = 1
        while (file.exists()) file = File(dir, "${n++}-$safe")
        file.writeBytes(bytes)
        promise.resolve("Downloads/CellMate/${file.name}")
      }
    } catch (e: Exception) {
      promise.reject("save_failed", e.message ?: "Could not save the file", e)
    }
  }
}

class DeviceFilesPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(DeviceFilesModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
