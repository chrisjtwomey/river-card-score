package com.chrisjtwomey.rivertable;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
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
    web.setWebViewClient(new WebViewClient() {
      @Override
      public void onPageFinished(WebView view, String url) {
        addTheWayBack(view);
      }

      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        // The back arrow on the page asks for this, and nothing else does.
        if ("rivertable".equals(request.getUrl().getScheme())) { finish(); return true; }
        return false;
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

    String url = getIntent().getStringExtra(EXTRA_URL);
    startUrl = url == null ? "http://127.0.0.1:" + NodeService.PORT + "/" : url;
    web.loadUrl(startUrl);
  }

  /**
   * A tap on Host or Join by mistake must not be a dead end. The system back
   * gesture leaves this screen, and this puts the same thing on the page, in
   * the top bar beside the full-screen and theme buttons: the app's own back
   * arrow, wearing the page's own button style. Nothing floats over the game.
   *
   * The server keeps running either way, and the chooser then offers to go
   * back to the table or to stop it.
   */
  private void addTheWayBack(WebView view) {
    view.evaluateJavascript(
        "(function(){"
        + "if(document.getElementById('app-back'))return;"
        + "var bar=document.querySelector('.topbar-actions');if(!bar)return;"
        + "var b=document.createElement('button');"
        + "b.id='app-back';b.type='button';b.className='btn ghost';"
        + "b.textContent='\\u2039';b.title='Back to the app';"
        // A third button in the bar would wrap the title, so this one is
        // narrower than the two beside it.
        + "b.style.cssText='padding-left:9px;padding-right:9px;font-size:20px;line-height:1';"
        + "b.setAttribute('aria-label','Back to the app');"
        + "b.onclick=function(){location.href='rivertable://home'};"
        + "bar.insertBefore(b,bar.firstChild);"
        // The long title fits on one line beside two buttons, not three.
        + "var h=document.querySelector('.brand h1');if(h)h.style.fontSize='15px';"
        + "})()", null);
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
