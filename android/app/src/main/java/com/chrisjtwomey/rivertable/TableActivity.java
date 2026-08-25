package com.chrisjtwomey.rivertable;

import android.annotation.SuppressLint;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.appcompat.app.AppCompatActivity;

/** The table itself, in a WebView: the same pages a browser gets. */
public class TableActivity extends AppCompatActivity {
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

    String url = getIntent().getStringExtra(EXTRA_URL);
    web.loadUrl(url == null ? "http://127.0.0.1:" + NodeService.PORT + "/" : url);
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
