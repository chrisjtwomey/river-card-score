package com.chrisjtwomey.rivertable;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

/**
 * The chooser. One phone hosts the table -- it runs the server and plays on it.
 * Every other phone only needs a browser, so "Join" is a convenience: it opens
 * the host's address in this app instead.
 *
 * The page is chooser.html in the assets, and it wears the game's own
 * stylesheet, so the app looks like the table it opens. It asks for things by
 * following a rivertable: link, which never leaves the WebView.
 */
public class MainActivity extends Activity {
  private static final String LOCAL = "http://127.0.0.1:" + NodeService.PORT + "/";
  private static final String PAGE = "file:///android_asset/chooser.html";
  private WebView web;

  @SuppressLint("SetJavaScriptEnabled")
  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);

    web = new WebView(this);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setAllowFileAccess(true);              // the stylesheet sits beside the page
    web.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        return handle(request.getUrl());
      }
    });
    setContentView(web);
    TableActivity.padBelowTheStatusBar(web);

    showChooser();
    askForPermissions();
  }

  /** Reloads the page, telling it whether a table of ours is already running. */
  private void showChooser() {
    web.loadUrl(PAGE + (NodeService.isRunning() ? "?table=1" : ""));
  }

  @Override
  protected void onResume() {
    super.onResume();
    // Coming back from the table, or from the notification, the page must say
    // what is true now: a table may have been started or stopped since.
    if (web != null) showChooser();
  }

  private boolean handle(Uri link) {
    if (!"rivertable".equals(link.getScheme())) return false;
    switch (link.getHost() == null ? "" : link.getHost()) {
      case "host":   host();                                    return true;
      case "resume": open(LOCAL);                               return true;
      case "stop":   stopTable();                               return true;
      case "join":   join(link.getQueryParameter("addr"));      return true;
      default:                                                  return true;
    }
  }

  /** Starts the server, waits for it to answer, then opens the landing page. */
  private void host() {
    Intent svc = new Intent(this, NodeService.class);
    if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc); else startService(svc);
    waitForServer(60);
  }

  private void waitForServer(int triesLeft) {
    new Thread(() -> {
      boolean up = false;
      try {
        HttpURLConnection c = (HttpURLConnection) new URL(LOCAL + "net.json").openConnection();
        c.setConnectTimeout(500);
        c.setReadTimeout(500);
        up = c.getResponseCode() == 200;
        c.disconnect();
      } catch (Exception ignored) { }
      boolean ready = up;
      new Handler(Looper.getMainLooper()).post(() -> {
        if (ready) {
          say("", false);
          open(LOCAL);
        } else if (triesLeft > 0) {
          new Handler(Looper.getMainLooper()).postDelayed(() -> waitForServer(triesLeft - 1), 500);
        } else {
          say("The table server did not start. adb logcat -s RiverTable-node says why.", true);
        }
      });
    }).start();
  }

  private void join(String typed) {
    if (typed == null || typed.trim().isEmpty()) return;
    String url = typed.trim();
    if (!url.contains(":")) url = url + ":" + NodeService.PORT;
    if (!url.startsWith("http")) url = "http://" + url;
    open(url.endsWith("/") ? url : url + "/");
  }

  private void stopTable() {
    startService(new Intent(this, NodeService.class).setAction(NodeService.ACTION_STOP));
  }

  private void open(String url) {
    startActivity(new Intent(this, TableActivity.class).putExtra(TableActivity.EXTRA_URL, url));
  }

  private void say(String text, boolean bad) {
    web.evaluateJavascript("window.appSay && appSay(" + quote(text) + "," + bad + ")", null);
  }

  private static String quote(String s) {
    return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
  }

  /**
   * Android 16 and later keep an app off the local network until it is allowed.
   * Without this the phones can reach nothing, and the server looks broken.
   * The notification permission is for the service's own notification.
   */
  private void askForPermissions() {
    List<String> want = new ArrayList<>();
    if (Build.VERSION.SDK_INT >= 33) {
      want.add(Manifest.permission.POST_NOTIFICATIONS);
      want.add("android.permission.NEARBY_WIFI_DEVICES");
    }
    if (Build.VERSION.SDK_INT >= 36) want.add("android.permission.ACCESS_LOCAL_NETWORK");
    List<String> missing = new ArrayList<>();
    for (String p : want) {
      if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
    }
    if (!missing.isEmpty()) requestPermissions(missing.toArray(new String[0]), 1);
  }

  @Override
  public void onRequestPermissionsResult(int code, String[] names, int[] results) {
    super.onRequestPermissionsResult(code, names, results);
    for (int i = 0; i < names.length; i++) {
      boolean granted = results[i] == PackageManager.PERMISSION_GRANTED;
      if (!granted && (names[i].endsWith("LOCAL_NETWORK") || names[i].endsWith("NEARBY_WIFI_DEVICES"))) {
        say("Without the local network permission the other phones cannot reach this table. "
            + "Settings > Apps > River Table > Permissions.", true);
      }
    }
  }

  @Override
  protected void onDestroy() {
    if (web != null) web.destroy();
    super.onDestroy();
  }
}
