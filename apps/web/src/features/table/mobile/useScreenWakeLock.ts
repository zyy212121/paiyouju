import { useEffect, useRef } from "react";

export function useScreenWakeLock(active: boolean): void {
  const sentinel = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    let disposed = false;
    const release = async () => {
      const current = sentinel.current;
      sentinel.current = null;
      if (current && !current.released) await current.release().catch(() => undefined);
    };
    const request = async () => {
      if (!active || disposed || document.visibilityState !== "visible" || sentinel.current) return;
      if (!("wakeLock" in navigator)) return;
      try {
        const acquired = await navigator.wakeLock.request("screen");
        if (disposed || !active) {
          await acquired.release().catch(() => undefined);
          return;
        }
        sentinel.current = acquired;
        acquired.addEventListener("release", () => {
          if (sentinel.current === acquired) sentinel.current = null;
        }, { once: true });
      } catch {
        // Unsupported contexts and browser/OS power policies must remain non-fatal.
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void request();
      else void release();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void request();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void release();
    };
  }, [active]);
}
