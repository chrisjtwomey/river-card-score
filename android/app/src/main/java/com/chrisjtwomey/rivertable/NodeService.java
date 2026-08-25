package com.chrisjtwomey.rivertable;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Runs the table server. It is a foreground service, so the table survives the
 * screen going off and the app going to the background: Android does not stop a
 * service that shows a notification.
 *
 * The node runtime cannot be stopped and started again inside one process, so
 * this service starts it once and the process lives until the notification's
 * Stop action kills it.
 */
public class NodeService extends Service {
  public static final String TAG = "RiverTable";
  public static final int PORT = 8787;
  private static final String CHANNEL = "table";
  private static final int NOTE_ID = 1;
  public static final String ACTION_STOP = "com.chrisjtwomey.rivertable.STOP";

  private static boolean nodeStarted = false;
  private PowerManager.WakeLock wakeLock;

  /** True once the server is up in this process. The chooser asks before it
      offers to start another one: node cannot be started twice here. */
  public static boolean isRunning() { return nodeStarted; }

  static {
    System.loadLibrary("node");
    System.loadLibrary("native-lib");
  }

  private native int startNode(String[] arguments);
  private native void setEnv(String name, String value);

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent != null && ACTION_STOP.equals(intent.getAction())) {
      stopSelf();
      // The node runtime has no clean shutdown, so the process goes with it.
      android.os.Process.killProcess(android.os.Process.myPid());
      return START_NOT_STICKY;
    }

    startForeground(NOTE_ID, notification());

    if (!nodeStarted) {
      nodeStarted = true;
      PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RiverTable:node");
      wakeLock.acquire();
      new Thread(this::runNode, "node-main").start();
    }
    return START_STICKY;
  }

  private void runNode() {
    File nodeDir = new File(getFilesDir(), "nodejs-project");
    if (apkChanged() || !nodeDir.exists()) {
      deleteRecursively(nodeDir);
      copyAssetFolder(getAssets(), "nodejs-project", nodeDir.getAbsolutePath());
      saveApkTime();
    }
    // The finished games live outside nodejs-project, which is wiped whenever
    // the app is updated.
    File data = new File(getFilesDir(), "games");
    data.mkdirs();

    setEnv("PORT", String.valueOf(PORT));
    setEnv("DATA_DIR", data.getAbsolutePath());
    setEnv("NO_TLS", "1");                 // no certificate on a phone
    setEnv("HOME", getFilesDir().getAbsolutePath());

    Log.i(TAG, "starting node in " + nodeDir);
    int code = startNode(new String[]{ "node", new File(nodeDir, "server.js").getAbsolutePath() });
    Log.w(TAG, "node exited with " + code);
  }

  private Notification notification() {
    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
      NotificationChannel ch = new NotificationChannel(CHANNEL, "Table server", NotificationManager.IMPORTANCE_LOW);
      ch.setShowBadge(false);
      nm.createNotificationChannel(ch);
    }
    PendingIntent open = PendingIntent.getActivity(this, 0,
        new Intent(this, MainActivity.class),
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    Intent stopIntent = new Intent(this, NodeService.class).setAction(ACTION_STOP);
    PendingIntent stop = PendingIntent.getService(this, 1, stopIntent,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
    return b.setContentTitle("Table is open")
        .setContentText("Players join on port " + PORT)
        .setSmallIcon(android.R.drawable.ic_menu_share)
        .setOngoing(true)
        .setContentIntent(open)
        .addAction(new Notification.Action.Builder(null, "Stop", stop).build())
        .build();
  }

  @Override public IBinder onBind(Intent intent) { return null; }

  @Override
  public void onDestroy() {
    if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    super.onDestroy();
  }

  /* ---- the node project is copied out of the APK, which node cannot read ---- */

  private boolean apkChanged() {
    SharedPreferences p = getSharedPreferences("rivertable", Context.MODE_PRIVATE);
    return p.getLong("apkTime", 0) != apkTime();
  }

  private void saveApkTime() {
    getSharedPreferences("rivertable", Context.MODE_PRIVATE)
        .edit().putLong("apkTime", apkTime()).apply();
  }

  private long apkTime() {
    try {
      PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
      return info.lastUpdateTime;
    } catch (PackageManager.NameNotFoundException e) {
      return 1;
    }
  }

  private static void deleteRecursively(File file) {
    File[] kids = file.listFiles();
    if (kids != null) for (File kid : kids) deleteRecursively(kid);
    file.delete();
  }

  private static boolean copyAssetFolder(AssetManager assets, String from, String to) {
    try {
      String[] names = assets.list(from);
      if (names == null || names.length == 0) return copyAsset(assets, from, to);
      new File(to).mkdirs();
      boolean ok = true;
      for (String name : names) ok &= copyAssetFolder(assets, from + "/" + name, to + "/" + name);
      return ok;
    } catch (IOException e) {
      Log.e(TAG, "cannot copy " + from, e);
      return false;
    }
  }

  private static boolean copyAsset(AssetManager assets, String from, String to) {
    try (InputStream in = assets.open(from); OutputStream out = new FileOutputStream(to)) {
      byte[] buf = new byte[8192];
      int read;
      while ((read = in.read(buf)) != -1) out.write(buf, 0, read);
      return true;
    } catch (IOException e) {
      Log.e(TAG, "cannot copy " + from, e);
      return false;
    }
  }
}
