package com.chrisjtwomey.rivertable;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;

/**
 * The camera, for a page that asks for it: reading a table's QR code, on the
 * chooser and at a table alike. A WebView refuses by default, so the request
 * is handed on to Android, which asks the reader; the activity hands the
 * answer back through onResult.
 *
 * One of these, not one per screen: both WebViews want the same thing, and a
 * second copy of it would be a second set of rules about who may see through
 * the camera.
 */
public class CameraForWeb extends WebChromeClient {
  /** The code the activity gets its answer back under. */
  public static final int ASK = 7;

  private final Activity host;
  private PermissionRequest waiting;

  public CameraForWeb(Activity host) { this.host = host; }

  @Override
  public void onPermissionRequest(PermissionRequest request) {
    host.runOnUiThread(() -> {
      boolean wantsCamera = false;
      for (String r : request.getResources()) {
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) wantsCamera = true;
      }
      if (!wantsCamera) { request.deny(); return; }
      if (host.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
        request.grant(new String[]{ PermissionRequest.RESOURCE_VIDEO_CAPTURE });
      } else {
        waiting = request;
        host.requestPermissions(new String[]{ Manifest.permission.CAMERA }, ASK);
      }
    });
  }

  @Override
  public void onPermissionRequestCanceled(PermissionRequest request) {
    if (request.equals(waiting)) waiting = null;
  }

  /** What the reader said. Anything but our own question is not ours. */
  public void onResult(int code, int[] results) {
    if (code != ASK) return;
    PermissionRequest req = waiting;
    waiting = null;
    if (req == null) return;
    boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
    if (granted) req.grant(new String[]{ PermissionRequest.RESOURCE_VIDEO_CAPTURE });
    else req.deny();
  }
}
