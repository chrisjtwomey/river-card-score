package com.chrisjtwomey.rivertable;

import android.annotation.SuppressLint;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import android.app.Activity;

/** The table itself, in a WebView: the same pages a browser gets. */
public class TableActivity extends Activity {
  public static final String EXTRA_URL = "url";
  private WebView web;

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
    web.setWebViewClient(new WebViewClient());
    web.setWebChromeClient(new WebChromeClient());
    setContentView(web);
    padBelowTheStatusBar(web);

    String url = getIntent().getStringExtra(EXTRA_URL);
    web.loadUrl(url == null ? "http://127.0.0.1:" + NodeService.PORT + "/" : url);
  }

  /**
   * From Android 15 a window is drawn edge to edge, under the status bar and
   * the gesture bar. A page that begins with a heading then sits under the
   * clock. The insets are handed to the view as padding instead.
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
  public void onBackPressed() {
    if (web.canGoBack()) web.goBack(); else super.onBackPressed();
  }

  @Override
  protected void onDestroy() {
    if (web != null) web.destroy();
    super.onDestroy();
  }
}
