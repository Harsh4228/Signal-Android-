package app.meetme

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager

/**
 * The incoming call screen of the phone itself (like WhatsApp): a full-screen notification over the lock
 * screen, with Answer and Decline buttons, ringtone and vibration. JavaScript shows / removes it; the
 * button pressed comes back as a "CallNotificationAction" event ("answer" / "decline").
 */
object CallNotifications {
  // A channel's sound can't be changed once created, so incoming calls get their own ringing channel.
  private const val CHANNEL = "incoming_calls"
  private const val ID = 4201
  const val ACTION_ANSWER = "app.meetme.CALL_ANSWER"
  const val ACTION_DECLINE = "app.meetme.CALL_DECLINE"
  const val ACTION_SHOW = "app.meetme.CALL_SHOW"

  /** A button pressed before JavaScript was listening (the app was started by "Answer"). */
  @Volatile var pendingAction: String? = null

  fun deliver(action: String) {
    val module = CallNotificationModule.instance
    if (module != null && module.isActive()) module.emit(action) else pendingAction = action
  }

  fun show(ctx: Context, caller: String, video: Boolean) {
    ensureChannel(ctx)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    fun openApp(action: String, code: Int) =
      PendingIntent.getActivity(
        ctx,
        code,
        Intent(ctx, MainActivity::class.java).setAction(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        flags,
      )
    val answer = openApp(ACTION_ANSWER, 1)
    val fullScreen = openApp(ACTION_SHOW, 2)
    val decline = PendingIntent.getBroadcast(ctx, 3, Intent(ctx, CallActionReceiver::class.java).setAction(ACTION_DECLINE), flags)
    val person = Person.Builder().setName(caller).setImportant(true).build()
    val notification =
      NotificationCompat.Builder(ctx, CHANNEL)
        .setSmallIcon(R.drawable.ic_stat_call)
        .setContentTitle(caller)
        .setContentText(if (video) "Incoming video call" else "Incoming voice call")
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setOngoing(true)
        .setAutoCancel(false)
        .setOnlyAlertOnce(true)
        .setTimeoutAfter(45_000)
        .setContentIntent(fullScreen)
        .setFullScreenIntent(fullScreen, true)
        .setStyle(NotificationCompat.CallStyle.forIncomingCall(person, decline, answer))
        .build()
    // Keep ringing until it is answered, declined or the caller gives up.
    notification.flags = notification.flags or Notification.FLAG_INSISTENT
    try {
      NotificationManagerCompat.from(ctx).notify(ID, notification)
    } catch (e: SecurityException) {
      // Notifications are switched off for CellMate: the call still shows when the app is opened.
    }
  }

  fun cancel(ctx: Context) = NotificationManagerCompat.from(ctx).cancel(ID)

  private fun ensureChannel(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = ctx.getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL) != null) return
    val channel =
      NotificationChannel(CHANNEL, "Incoming calls", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "Rings for incoming voice and video calls"
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 800, 1200)
        setSound(
          RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
        )
      }
    manager.createNotificationChannel(channel)
  }
}

/** "Decline" on the notification: no need to open the app. */
class CallActionReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    CallNotifications.cancel(ctx)
    if (intent.action == CallNotifications.ACTION_DECLINE) CallNotifications.deliver("decline")
  }
}

class CallNotificationModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  init {
    instance = this
  }

  override fun getName() = "CallNotification"

  @ReactMethod
  fun show(caller: String, video: Boolean) = CallNotifications.show(reactApplicationContext, caller, video)

  @ReactMethod
  fun cancel() = CallNotifications.cancel(reactApplicationContext)

  @ReactMethod
  fun takePendingAction(promise: Promise) {
    promise.resolve(CallNotifications.pendingAction)
    CallNotifications.pendingAction = null
  }

  /** The call is over: the app no longer shows over the lock screen. */
  @ReactMethod
  fun endCallMode() {
    val activity = reactApplicationContext.currentActivity as? MainActivity ?: return
    UiThreadUtil.runOnUiThread { activity.showOverLockScreen(false) }
  }

  // Required by NativeEventEmitter.
  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Double) {}

  fun isActive() = reactApplicationContext.hasActiveReactInstance()

  fun emit(action: String) {
    reactApplicationContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("CallNotificationAction", action)
  }

  companion object {
    @Volatile var instance: CallNotificationModule? = null
  }
}

class CallNotificationPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(CallNotificationModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
