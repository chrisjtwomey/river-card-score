package com.chrisjtwomey.rivertable;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** The table itself, in a WebView: the same pages a browser gets. */
public class TableActivity extends Activity {
  public static final String EXTRA_URL = "url";
  private static final int ASK_CAMERA = 7;
  private WebView web;
  private String startUrl;
  private PermissionRequest waitingOnCamera;

  @SuppressLint("SetJavaScriptEnabled")
  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    // A table stays on screen for a whole game, so do not let it sleep. Over
    // plain http the pages cannot hold the screen awake themselves.
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

    web = new WebView(this);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    // How a page knows it is in the app and not in a browser. The front page
    // reads this and offers its way back to the app's own screen; nothing
    // else about the pages changes.
    s.setUserAgentString(s.getUserAgentString() + " UpTheRiverApp/1");
    // A WebView with nothing painted yet is a black rectangle. Clear it, and
    // what shows until the page paints is the window behind: the felt and the
    // mark, the same picture the phone put up when the icon was tapped. The
    // pages paint their own background over it.
    web.setBackgroundColor(0x00000000);
    web.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        /* Stop hosting, at the foot of the front page, asks for this and
           nothing else does. The stopping itself is the chooser's: it already
           knows how, and it waits for the process to go before it says what is
           true now. So this screen hands the job over and steps out of the
           way. */
        if (!"uptheriver".equals(request.getUrl().getScheme())) return false;
        if ("stop".equals(request.getUrl().getHost())) {
          startActivity(new Intent(TableActivity.this, MainActivity.class)
              .putExtra(MainActivity.EXTRA_STOP, true)
              .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        }
        finish();
        return true;
      }
    });
    // A page asking for the camera -- the join page reading a QR code -- is
    // refused by default. Hand it on to Android, which asks the reader.
    web.setWebChromeClient(new WebChromeClient() {
      @Override
      public void onPermissionRequest(PermissionRequest request) {
        runOnUiThread(() -> {
          boolean wantsCamera = false;
          for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) wantsCamera = true;
          }
          if (!wantsCamera) { request.deny(); return; }
          if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{ PermissionRequest.RESOURCE_VIDEO_CAPTURE });
          } else {
            waitingOnCamera = request;
            requestPermissions(new String[]{ Manifest.permission.CAMERA }, ASK_CAMERA);
          }
        });
      }

      @Override
      public void onPermissionRequestCanceled(PermissionRequest request) {
        if (request.equals(waitingOnCamera)) waitingOnCamera = null;
      }
    });
    setContentView(web);
    padBelowTheStatusBar(web);

    open(getIntent());
  }

  /* This activity is a single instance, so a second "open this address" is
     handed to the one already on screen. Without this it would sit on the page
     it already had. */
  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    open(intent);
  }

  private void open(Intent from) {
    String url = from == null ? null : from.getStringExtra(EXTRA_URL);
    startUrl = url == null ? "http://127.0.0.1:" + NodeService.PORT + "/" : url;
    web.loadUrl(startUrl);
  }

  /**
   * From Android 15 a window is drawn edge to edge, under the status bar and
   * the gesture bar. A page that begins with a heading then sits under the
   * clock. The insets are handed to the view as padding instead. The app's
   * theme also asks the platform to lay the window out below the bars, so on
   * Android 15 these insets come back as nothing, which is right.
   */
  static void padBelowTheStatusBar(View view) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return;
    view.setOnApplyWindowInsetsListener((v, insets) -> {
      Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
      return insets;
    });
    // The window has already handed its insets out by now, so ask for them
    // again. Without this the listener is set and never called.
    view.requestApplyInsets();
  }

  @Override
  public void onRequestPermissionsResult(int code, String[] names, int[] results) {
    if (code != ASK_CAMERA) return;
    PermissionRequest req = waitingOnCamera;
    waitingOnCamera = null;
    if (req == null) return;
    boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
    if (granted) req.grant(new String[]{ PermissionRequest.RESOURCE_VIDEO_CAPTURE });
    else req.deny();
  }

  @Override
  public void onBackPressed() {
    // Back walks the pages, and from the first one it leaves for the chooser.
    // Without the second test a page that redirected once would trap it here.
    if (web.canGoBack() && !isTheFirstPage()) web.goBack(); else finish();
  }

  private boolean isTheFirstPage() {
    String now = web.getUrl();
    return now == null || now.equals(startUrl);
  }

  @Override
  protected void onDestroy() {
    if (web != null) web.destroy();
    super.onDestroy();
  }
}
