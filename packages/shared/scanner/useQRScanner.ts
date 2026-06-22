import { ref } from "vue";
import { requestCameraPermission } from "../host/permissions";

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
    try {
      // Request camera permission from the host before accessing the camera
      const granted = await requestCameraPermission();
      if (!granted) {
        error.value = "Camera permission denied by host";
        return;
      }

      const { Html5Qrcode } = await import("html5-qrcode");
      const cameras = await Html5Qrcode.getCameras();

      html5Qrcode = new Html5Qrcode(elementId);

      const config = {
        fps: 10,
        // Size the scan box to the actual viewfinder so it stays centered. A
        // fixed box drifts off-centre when the video is taller or shorter than
        // the box.
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
          const size = Math.max(150, Math.floor(minEdge * 0.7));
          return { width: size, height: size };
        },
        videoConstraints: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      };
      const successCb = (decodedText: string) => {
        onScan(decodedText);
      };
      const errorCb = () => {};

      // Try back camera first
      try {
        await html5Qrcode.start(
          { facingMode: "environment" },
          config,
          successCb,
          errorCb,
        );
        isActive.value = true;
        return;
      } catch {
        // Fall through to fallback
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
        await html5Qrcode.start(
          cameras[0].id,
          fallbackConfig,
          successCb,
          errorCb,
        );
        isActive.value = true;
        return;
      }

      throw new Error("No cameras found");
    } catch (e: any) {
      error.value = e?.message || "Failed to start camera";
      isActive.value = false;
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
