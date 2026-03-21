import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.liftform.analyzer',
  appName: 'Lift Coach',
  webDir: 'dist',
  server: {
    // Allow inline MediaPipe WASM loading
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1500,
      backgroundColor: '#0a0a0a',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0a0a0a',
    },
    Camera: {
      // Permissions text shown to user
      presentationStyle: 'fullscreen',
    },
  },
  ios: {
    // Allow camera access for live mode
    allowsLinkPreview: false,
    scrollEnabled: false,
    contentInset: 'automatic',
  },
};

export default config;
