import { useEffect } from "react";
import { setupBrowserPushNotifications } from "@/lib/browser-push";
import { useCurrentUser } from "@/orpc/hooks/user";

export function DesktopNotificationPermissionGate({ enabled = true }: { enabled?: boolean }) {
  const { data: currentUser } = useCurrentUser({ enabled });
  const taskDonePushEnabled = currentUser?.taskDonePushEnabled ?? false;

  useEffect(() => {
    if (!taskDonePushEnabled) {
      return;
    }

    const requestPermission = () => {
      void setupBrowserPushNotifications();
    };

    window.addEventListener("pointerdown", requestPermission, {
      capture: true,
      once: true,
    });
    window.addEventListener("keydown", requestPermission, {
      capture: true,
      once: true,
    });

    return () => {
      window.removeEventListener("pointerdown", requestPermission, true);
      window.removeEventListener("keydown", requestPermission, true);
    };
  }, [taskDonePushEnabled]);

  return null;
}
