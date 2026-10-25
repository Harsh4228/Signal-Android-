package app.meetme

import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(PinHashPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    createNotificationChannels()
    loadReactNative(this)
  }

  /**
   * Channels for the content-free wake-up pushes ("New message" / "Incoming call"). The push itself
   * names the channel; the text never includes the sender or the message.
   */
  private fun createNotificationChannels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java) ?: return

    val messages = NotificationChannel("messages", "Messages", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "New message alerts (no content shown)"
      lockscreenVisibility = Notification.VISIBILITY_PRIVATE
    }

    val calls = NotificationChannel("calls", "Calls", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Incoming call alerts"
      lockscreenVisibility = Notification.VISIBILITY_PRIVATE
      enableVibration(true)
      setSound(
        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build(),
      )
    }

    manager.createNotificationChannels(listOf(messages, calls))
  }
}
