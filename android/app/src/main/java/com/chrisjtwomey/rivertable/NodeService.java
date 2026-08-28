package com.chrisjtwomey.rivertable;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

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
  public static final String TAG = "UpTheRiver";
  public static final int PORT = 8787;
  private static final String CHANNEL = "table";
  private static final int NOTE_ID = 1;
  public static final String ACTION_STOP = "com.chrisjtwomey.rivertable.STOP";

  private static boolean nodeStarted = false;
  private PowerManager.WakeLock wakeLock;
  private final Handler tick = new Handler(Looper.getMainLooper());
  private String lastAddrs = null;
  /* How often the wake lock is reconsidered. This is a Handler and not an
     alarm, so it does not wake a sleeping phone by itself: it fires on the
     next wake, which is exactly when the answer could have changed. */
  private static final long WAKE_TICK = 5000;
  private final Runnable holdOnlyWhileInUse = new Runnable() {
    @Override public void run() {
      syncWakeLock();
      tick.postDelayed(this, WAKE_TICK);
    }
  };
  /* Android will not tell node what this phone's addresses are, so this does it
     every half minute. A phone joins a network, or starts sharing one of its
     own, long after the table is open. */
  private final Runnable keepAddrsFresh = new Runnable() {
    @Override public void run() {
      writeLanAddrs();
      tick.postDelayed(this, 30000);
    }
  };

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

    tick.removeCallbacks(keepAddrsFresh);
    tick.post(keepAddrsFresh);

    if (!nodeStarted) {
      nodeStarted = true;
      PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "UpTheRiver:node");
      // Held or not held, never counted: the tick below asks the same question
      // over and over, and a count would need every answer to be matched.
      wakeLock.setReferenceCounted(false);
      // The server has not answered yet, so nothing may be assumed idle.
      wakeLock.acquire();
      new Thread(this::runNode, "node-main").start();
    }
    tick.removeCallbacks(holdOnlyWhileInUse);
    tick.postDelayed(holdOnlyWhileInUse, WAKE_TICK);
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
    // Where the server says whether anybody is at a table. Last time's answer
    // is no answer at all: it goes before node is asked the question again.
    busyFile().delete();
    setEnv("BUSY_FILE", busyFile().getAbsolutePath());
    // Where this phone leaves its own addresses for the server to read. It is
    // written before node starts, and again whenever it changes.
    writeLanAddrs();
    setEnv("LAN_ADDRS_FILE", lanAddrsFile().getAbsolutePath());
    setEnv("NO_TLS", "1");                 // no certificate on a phone
    setEnv("HOME", getFilesDir().getAbsolutePath());
    // A debug build watches its own files and serves /live, so a page pushed
    // with tools/push-dev.sh reloads every open screen by itself. A release
    // build must not: the watch costs battery and the dev table would be open
    // to anybody on the network.
    if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
      setEnv("DEV", "1");
      Log.i(TAG, "debug build: live reload is on");
    }

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
    tick.removeCallbacks(keepAddrsFresh);
    tick.removeCallbacks(holdOnlyWhileInUse);
    if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    super.onDestroy();
  }

  /* ---- the phone stays awake for a table, not for an app that is open ---- */

  /**
   * The wake lock keeps the CPU running with the screen off, which is what a
   * table needs: the other phones must still be answered while this one is in
   * a pocket. It used to be taken when the server started and held until the
   * process died, so a table nobody had touched since last night held the
   * phone awake all night.
   *
   * The server says whether anybody is at a table, and that is what the lock
   * follows. It answers "yes" for a while after the last phone goes, so a
   * network that drops for a moment does not put the table to sleep.
   *
   * Asleep, this does not run at all -- and it does not need to. The lock is
   * already off, and the packet that brings a phone back wakes the CPU by
   * itself; this then fires on that wake and takes the lock again.
   */
  private void syncWakeLock() {
    if (wakeLock == null) return;
    boolean inUse = tableInUse();
    if (inUse && !wakeLock.isHeld()) wakeLock.acquire();
    else if (!inUse && wakeLock.isHeld()) wakeLock.release();
  }

  private File busyFile() {
    return new File(getFilesDir(), "table-busy");
  }

  /* No answer means the server has not given one yet -- it is starting, or it
     is too old to know the question. Hold the phone awake: an idle table that
     stays awake is a flat battery, but a live table that sleeps is a game
     nobody can play. */
  private boolean tableInUse() {
    try (InputStream in = new FileInputStream(busyFile())) {
      return in.read() != '0';
    } catch (IOException e) {
      return true;
    }
  }

  /* ---- the addresses, which only Java may ask for ---- */

  private File lanAddrsFile() {
    return new File(getFilesDir(), "lan-addrs.txt");
  }

  /**
   * Every address other phones could reach this one at, one per line.
   *
   * A second opinion, not the only one: node's own interface list works on the
   * Android tested, and the server also asks the routing table. But neither is
   * guaranteed -- Termux cannot read the interface list at all, a phone sharing
   * its own hotspot with no mobile data has nowhere off the link to ask about,
   * and a later Android may take getifaddrs away as it took /proc/net. Java is
   * allowed to ask, tethering included, so it asks, and the server merges
   * whatever it finds with what it knew.
   *
   * A link-local address (169.254.x.x) is what a phone gives itself when
   * nothing else worked, so it goes last: real addresses first.
   */
  private void writeLanAddrs() {
    List<String> real = new ArrayList<>(), lastResort = new ArrayList<>();
    try {
      for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
        if (ni.isLoopback() || !ni.isUp()) continue;
        for (InetAddress a : Collections.list(ni.getInetAddresses())) {
          if (!(a instanceof Inet4Address) || a.isLoopbackAddress()) continue;
          (a.isLinkLocalAddress() ? lastResort : real).add(a.getHostAddress());
        }
      }
    } catch (Exception e) {
      // Keep whatever was written last: an old address beats none at all.
      Log.w(TAG, "cannot read this phone's own addresses", e);
      return;
    }
    real.addAll(lastResort);
    StringBuilder text = new StringBuilder();
    for (String a : real) text.append(a).append('\n');
    // Nothing has moved and the file is where it was: leave it alone.
    if (text.toString().equals(lastAddrs) && lanAddrsFile().exists()) return;

    // Written beside the real file and moved onto it, so the server never reads
    // a half-written list.
    File tmp = new File(getFilesDir(), "lan-addrs.tmp");
    try (OutputStream out = new FileOutputStream(tmp)) {
      out.write(text.toString().getBytes(StandardCharsets.UTF_8));
    } catch (IOException e) {
      Log.w(TAG, "cannot write the address list", e);
      return;
    }
    if (!tmp.renameTo(lanAddrsFile())) { tmp.delete(); return; }
    lastAddrs = text.toString();
    Log.i(TAG, "this phone answers at: " + (real.isEmpty() ? "(nothing yet)" : real));
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
