import { ref } from "vue";
import { requestCameraPermission } from "../host/permissions";

const LOG = "[QRScanner]";

/**
 * Reject if a promise doesn't settle in time, so a stalled camera enumeration
 * or stream start surfaces as an error instead of an await that hangs forever
 * (which previously presented as "the scanner is up but nothing happens").
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Pure TS composable wrapping html5-qrcode for camera-based QR scanning.
 * Used by both admin and attendee SPA scanner components.
 */
export function useQRScanner() {
  const isActive = ref(false);
  const error = ref<string | null>(null);

  let html5Qrcode: any = null;

  async function start(elementId: string, onScan: (data: string) => void) {
    error.value = null;
    console.log(`${LOG} start() el=${elementId} existingInstance=${html5Qrcode != null} isActive=${isActive.value}`);

    // A leftover instance (e.g. from a failed previous start) still holds the
    // camera; clear it before opening a new stream.
    if (html5Qrcode) {
      console.warn(`${LOG} start() found an existing instance, stopping it first`);
      await stop();
    }

    try {
      // Request camera permission from the host before accessing the camera
      const granted = await requestCameraPermission();
      console.log(`${LOG} camera permission granted=${granted}`);
      if (!granted) {
        error.value = "Camera permission denied by host";
        return;
      }

      const { Html5Qrcode } = await import("html5-qrcode");
      const cameras = await withTimeout(Html5Qrcode.getCameras(), 15000, "getCameras");
      console.log(`${LOG} getCameras returned ${cameras.length} camera(s): ${cameras.map((c: any) => c.label || c.id).join(", ")}`);

      html5Qrcode = new Html5Qrcode(elementId);

      const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        videoConstraints: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      };
      const successCb = (decodedText: string) => {
        console.log(`${LOG} decoded a QR (length=${decodedText.length})`);
        onScan(decodedText);
      };
      const errorCb = () => {};

      // Try back camera first
      try {
        await withTimeout(
          html5Qrcode.start({ facingMode: "environment" }, config, successCb, errorCb),
          20000,
          "camera start (environment)",
        );
        isActive.value = true;
        console.log(`${LOG} camera started (environment facingMode)`);
        return;
      } catch (e: any) {
        console.warn(`${LOG} environment start failed, trying fallback camera:`, e?.message || e);
      }

      // Fallback: try first available camera
      if (cameras.length > 0) {
        const fallbackConfig = {
          ...config,
          videoConstraints: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        };
        await withTimeout(
          html5Qrcode.start(cameras[0].id, fallbackConfig, successCb, errorCb),
          20000,
          "camera start (fallback)",
        );
        isActive.value = true;
        console.log(`${LOG} camera started (fallback camera ${cameras[0].id})`);
        return;
      }

      throw new Error("No cameras found");
    } catch (e: any) {
      error.value = e?.message || "Failed to start camera";
      isActive.value = false;
      console.error(`${LOG} start() failed: ${error.value}`, e);
    }
  }

  async function stop() {
    if (html5Qrcode && isActive.value) {
      try {
        await html5Qrcode.stop();
        html5Qrcode.clear();
      } catch {
        // Ignore stop errors
      }
    }
    html5Qrcode = null;
    isActive.value = false;
  }

  return { start, stop, isActive, error };
}
