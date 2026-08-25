package com.chrisjtwomey.rivertable;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;

import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

/**
 * The chooser. One phone hosts the table -- it runs the server and plays on it.
 * Every other phone only needs a browser, so "Join" is a convenience: it opens
 * the host's address in this app instead.
 */
public class MainActivity extends AppCompatActivity {
  private static final String LOCAL = "http://127.0.0.1:" + NodeService.PORT + "/";
  private TextView status;

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);

    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setGravity(Gravity.CENTER);
    root.setPadding(48, 48, 48, 48);

    TextView title = new TextView(this);
    title.setText("Up the River, Down the River");
    title.setTextSize(24);
    title.setGravity(Gravity.CENTER);
    root.addView(title);

    Button host = new Button(this);
    host.setText("Host a table and play");
    host.setOnClickListener(v -> host());
    root.addView(host, wide());

    Button join = new Button(this);
    join.setText("Join a table");
    join.setOnClickListener(v -> askForAddress());
    root.addView(join, wide());

    status = new TextView(this);
    status.setGravity(Gravity.CENTER);
    root.addView(status);

    setContentView(root);
    askForPermissions();
  }

  private LinearLayout.LayoutParams wide() {
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    p.topMargin = 32;
    return p;
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
      if (checkSelfPermission(p) != android.content.pm.PackageManager.PERMISSION_GRANTED) missing.add(p);
    }
    if (!missing.isEmpty()) {
      ActivityCompat.requestPermissions(this, missing.toArray(new String[0]), 1);
    }
  }

  @Override
  public void onRequestPermissionsResult(int code, @NonNull String[] names, @NonNull int[] results) {
    super.onRequestPermissionsResult(code, names, results);
    for (int i = 0; i < names.length; i++) {
      boolean granted = results[i] == android.content.pm.PackageManager.PERMISSION_GRANTED;
      if (!granted && names[i].endsWith("LOCAL_NETWORK")) {
        status.setText("Without the local network permission the other phones cannot reach this table. "
            + "Settings > Apps > River Table > Permissions.");
      }
    }
  }

  /** Starts the server, waits for it to answer, then opens the landing page. */
  private void host() {
    Intent svc = new Intent(this, NodeService.class);
    if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc); else startService(svc);
    status.setText("Starting the table…");
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
          status.setText("");
          open(LOCAL);
        } else if (triesLeft > 0) {
          new Handler(Looper.getMainLooper()).postDelayed(() -> waitForServer(triesLeft - 1), 500);
        } else {
          status.setText("The table server did not start. Check the log with: adb logcat -s RiverTable-node");
        }
      });
    }).start();
  }

  private void askForAddress() {
    SharedPreferences prefs = getSharedPreferences("rivertable", MODE_PRIVATE);
    EditText field = new EditText(this);
    field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
    field.setHint("192.168.1.5:" + NodeService.PORT);
    field.setText(prefs.getString("lastHost", ""));
    new AlertDialog.Builder(this)
        .setTitle("The host's address")
        .setMessage("Type the address the host phone shows. Scanning its QR code with the camera works too, "
            + "and opens the table in the browser.")
        .setView(field)
        .setPositiveButton("Join", (d, w) -> {
          String typed = field.getText().toString().trim();
          if (typed.isEmpty()) return;
          if (!typed.contains(":")) typed = typed + ":" + NodeService.PORT;
          if (!typed.startsWith("http")) typed = "http://" + typed;
          prefs.edit().putString("lastHost", field.getText().toString().trim()).apply();
          open(typed.endsWith("/") ? typed : typed + "/");
        })
        .setNegativeButton("Cancel", null)
        .show();
  }

  private void open(String url) {
    startActivity(new Intent(this, TableActivity.class).putExtra(TableActivity.EXTRA_URL, url));
  }
}
