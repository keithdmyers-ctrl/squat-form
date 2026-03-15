/**
 * Native platform integration via Capacitor.
 * Guards all native API calls behind platform detection.
 * On web, all functions are no-ops or use web fallbacks.
 */

import { Capacitor } from '@capacitor/core';

/** Whether we're running as a native iOS/Android app. */
export const isNative = Capacitor.isNativePlatform();

/** Whether we're running on iOS specifically. */
export const isIOS = Capacitor.getPlatform() === 'ios';

/**
 * Configure the status bar for the native app.
 * Dark content on dark background, overlays web view.
 */
export async function configureStatusBar(): Promise<void> {
  if (!isNative) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch {
    // StatusBar plugin not available
  }
}

/**
 * Hide the splash screen after the app is ready.
 */
export async function hideSplash(): Promise<void> {
  if (!isNative) return;
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide({ fadeOutDuration: 300 });
  } catch {
    // SplashScreen plugin not available
  }
}

/**
 * Trigger haptic feedback (impact style).
 * Falls back to navigator.vibrate on web.
 */
export async function hapticImpact(style: 'light' | 'medium' | 'heavy' = 'medium'): Promise<void> {
  if (isNative) {
    try {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      const styleMap = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
      await Haptics.impact({ style: styleMap[style] });
      return;
    } catch {
      // Haptics plugin not available
    }
  }
  // Web fallback
  if (navigator.vibrate) {
    const durations = { light: 10, medium: 25, heavy: 50 };
    navigator.vibrate(durations[style]);
  }
}

/**
 * Trigger haptic notification feedback.
 */
export async function hapticNotification(type: 'success' | 'warning' | 'error' = 'success'): Promise<void> {
  if (isNative) {
    try {
      const { Haptics, NotificationType } = await import('@capacitor/haptics');
      const typeMap = { success: NotificationType.Success, warning: NotificationType.Warning, error: NotificationType.Error };
      await Haptics.notification({ type: typeMap[type] });
      return;
    } catch {
      // Haptics plugin not available
    }
  }
  // Web fallback
  if (navigator.vibrate) {
    const patterns = { success: [15, 50, 15], warning: [25, 50, 25, 50, 25], error: [50, 100, 50] };
    navigator.vibrate(patterns[type]);
  }
}

/**
 * Initialize native platform features.
 * Call once at app startup.
 */
export async function initNativePlatform(): Promise<void> {
  if (!isNative) return;

  await configureStatusBar();

  // Add native class to body for CSS targeting
  document.body.classList.add('native-app');
  if (isIOS) document.body.classList.add('ios-app');

  // Hide splash after a short delay to ensure content is rendered
  setTimeout(() => hideSplash(), 500);
}
