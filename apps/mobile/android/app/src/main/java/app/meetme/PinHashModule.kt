package app.meetme

import android.util.Base64
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.util.concurrent.Executors
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * App lock PIN hashing (PBKDF2-HMAC-SHA256) in native code. The same hash in JavaScript takes several
 * seconds on a phone, which made the lock screen feel stuck; natively it takes a few milliseconds.
 */
class PinHashModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val worker = Executors.newSingleThreadExecutor()

  override fun getName() = "PinHash"

  @ReactMethod
  fun pbkdf2(pin: String, saltB64: String, iterations: Double, promise: Promise) {
    worker.execute {
      try {
        val salt = Base64.decode(saltB64, Base64.NO_WRAP)
        val spec = PBEKeySpec(pin.toCharArray(), salt, iterations.toInt(), 256)
        val key = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        spec.clearPassword()
        promise.resolve(Base64.encodeToString(key, Base64.NO_WRAP))
      } catch (e: Exception) {
        promise.reject("pbkdf2", e)
      }
    }
  }
}

class PinHashPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(PinHashModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
