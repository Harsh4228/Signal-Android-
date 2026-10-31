package app.meetme

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
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
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream

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
  /**
   * A profile photo from the camera or the gallery: turned upright, the middle square, at most `max` px, as a
   * JPEG in base64 (camera pictures are far larger than the 2 MB a profile photo may be).
   */
  @ReactMethod
  fun shrinkPhoto(uri: String, max: Int, promise: Promise) {
    Thread {
      try {
        val u = Uri.parse(uri)
        fun open(): InputStream =
          if (u.scheme == null || u.scheme == "file") File(u.path ?: uri).inputStream()
          else reactApplicationContext.contentResolver.openInputStream(u) ?: throw Exception("Could not read the photo")
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        open().use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (minOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= max) sample *= 2
        val bitmap = open().use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
          ?: throw Exception("That file is not a photo")
        val degrees = try {
          when (open().use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
          }
        } catch (e: Exception) { 0f }
        val side = minOf(bitmap.width, bitmap.height)
        val scale = minOf(1f, max.toFloat() / side)
        val m = Matrix().apply { postRotate(degrees); postScale(scale, scale) }
        val out = Bitmap.createBitmap(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, m, true)
        val bytes = ByteArrayOutputStream().also { out.compress(Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
        promise.resolve(Base64.encodeToString(bytes, Base64.NO_WRAP))
      } catch (e: Exception) {
        promise.reject("photo_failed", e.message ?: "Could not read the photo", e)
      }
    }.start()
  }
}

class DeviceFilesPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(DeviceFilesModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
