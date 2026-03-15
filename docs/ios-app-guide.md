# iOS App Build & Distribution Guide

## Prerequisites

- macOS with Xcode 15+ installed
- Apple Developer account (free for device testing, $99/year for App Store)
- Node.js 18+ and npm
- CocoaPods (`sudo gem install cocoapods`) — only if using Cordova plugins

## Project Structure

```
frontend/
├── capacitor.config.ts    # Capacitor configuration
├── ios/                   # Native iOS project
│   └── App/
│       ├── App.xcodeproj  # Xcode project file
│       └── App/
│           ├── AppDelegate.swift
│           ├── Info.plist          # Permissions & app metadata
│           ├── Assets.xcassets/    # App icon & splash screen
│           ├── Base.lproj/        # Storyboards
│           └── public/            # Built web assets (auto-synced)
├── src/
│   └── native.ts          # Native platform bridge (haptics, status bar, etc.)
└── package.json           # iOS scripts: ios:build, ios:open, ios:run
```

## Quick Start

```bash
cd frontend

# Build web app and sync to iOS
npm run ios:build

# Open in Xcode
npm run ios:open

# Or build + sync + run on connected device/simulator
npm run ios:run
```

## Step-by-Step: First Build

### 1. Install dependencies

```bash
cd frontend
npm install
```

### 2. Build the web app

```bash
npm run build
```

This compiles TypeScript, bundles with Vite, and outputs to `dist/`.

### 3. Sync to iOS

```bash
npx cap sync ios
```

This copies `dist/` into `ios/App/App/public/` and updates native plugins.

### 4. Open in Xcode

```bash
npx cap open ios
```

### 5. Configure signing

In Xcode:
1. Select the **App** target in the project navigator
2. Go to **Signing & Capabilities** tab
3. Select your **Team** (Apple Developer account)
4. Xcode will auto-generate a provisioning profile

### 6. Select a device and run

- Choose your connected iPhone or a simulator from the device menu
- Press **Cmd+R** or click the Play button
- The app will build, install, and launch

## Development Workflow

After making code changes:

```bash
# Quick sync (no rebuild — use if only HTML/CSS/JS changed)
npx cap sync ios

# Full rebuild + sync
npm run ios:build

# Then in Xcode: Cmd+R to run
```

For live reload during development:

```bash
# Start Vite dev server
npm run dev

# In capacitor.config.ts, temporarily add:
# server: { url: 'http://YOUR_LOCAL_IP:5173' }

# Then sync and run
npx cap sync ios
```

Remember to remove the `server.url` before building for production.

## App Store Submission

### 1. Prepare for release

```bash
# Build production web app
npm run build

# Sync to iOS
npx cap sync ios
```

### 2. Set version numbers

In Xcode, select the App target:
- **Version** (CFBundleShortVersionString): e.g., `1.0.0`
- **Build** (CFBundleVersion): e.g., `1`

### 3. Create an archive

1. In Xcode, select **Any iOS Device** as the build target
2. **Product → Archive**
3. Wait for the build to complete

### 4. Upload to App Store Connect

1. In the Organizer window (Window → Organizer), select your archive
2. Click **Distribute App**
3. Choose **App Store Connect**
4. Follow the wizard (automatic signing recommended)

### 5. App Store Connect setup

At [appstoreconnect.apple.com](https://appstoreconnect.apple.com):

1. Create a new app with bundle ID `com.liftform.analyzer`
2. Fill in:
   - **App Name**: Lift Form Analyzer
   - **Subtitle**: AI-Powered Exercise Form Coach
   - **Category**: Health & Fitness
   - **Description**: (see below)
   - **Keywords**: squat form, deadlift, bench press, form check, exercise analysis, powerlifting, workout tracker
   - **Screenshots**: Required for each device size (6.7", 6.5", 5.5")
   - **Privacy Policy URL**: Required
3. Select your uploaded build
4. Submit for review

### Suggested App Description

```
Lift Form Analyzer uses AI to analyze your exercise form in real-time.
Record a video or use live camera mode — get instant feedback on depth,
knee tracking, trunk position, symmetry, tempo, and lockout.

EXERCISES SUPPORTED
• Squat (6 variants: high bar, low bar, front, goblet, overhead, bodyweight)
• Deadlift (conventional, sumo, Romanian)
• Bench Press (flat, close grip, wide grip)
• Overhead Press (strict, push press, behind the neck)
• Barbell Row (Pendlay, bent-over, Yates)
• Lunge (forward, reverse, walking, Bulgarian)

FEATURES
• Real-time webcam analysis with coaching cues
• Per-rep scoring across 6 dimensions
• Competition mode with IPF/USAPL depth standards
• 1RM estimation, DOTS scoring, meet attempt planning
• Session history with trend charts
• Goal setting with achievement tracking
• Periodized programming recommendations
• Guided warmup timer
• Video snapshot comparison (before/after)
• Per-rep clip export and social sharing
• Light and dark themes

PRIVACY FIRST
All video analysis happens on your device. Your videos are never uploaded
to any server. No account required for core features.
```

## Permissions

The app requests these permissions (configured in `Info.plist`):

| Permission | Usage Description | When Requested |
|-----------|------------------|----------------|
| Camera | Real-time form analysis in live mode | When user starts live mode |
| Photo Library | Selecting recorded exercise videos | When user taps upload |
| Microphone | Audio coaching cues during live analysis | When user enables audio |

## Native Features

The `native.ts` module provides:

- **Platform detection**: `isNative`, `isIOS` flags
- **Status bar**: Dark style, overlays web view
- **Splash screen**: Auto-hide after 1.5s with 300ms fade
- **Haptics**: Native haptic feedback on rep completion, goal achievement
  - `hapticImpact('light' | 'medium' | 'heavy')`
  - `hapticNotification('success' | 'warning' | 'error')`
- **CSS classes**: `native-app` and `ios-app` added to `<body>` for styling

## Capacitor Plugins Installed

| Plugin | Version | Purpose |
|--------|---------|---------|
| @capacitor/core | 8.2.0 | Core runtime |
| @capacitor/ios | 8.2.0 | iOS platform |
| @capacitor/camera | 8.0.2 | Native camera access |
| @capacitor/haptics | 8.0.1 | Haptic feedback |
| @capacitor/splash-screen | 8.0.1 | Launch screen control |
| @capacitor/status-bar | 8.0.1 | Status bar styling |

## Troubleshooting

### "No matching provisioning profile"
→ In Xcode, go to Signing & Capabilities and enable **Automatically manage signing**

### Web assets not updating after code change
→ Run `npx cap sync ios` to re-copy `dist/` to the iOS project

### Camera not working in simulator
→ The iOS Simulator does not support camera. Use a physical device for live mode testing.

### MediaPipe model not loading
→ Ensure `dist/mediapipe/` contains the WASM files. Run `npm run build` (the `prebuild` script copies them).

### App crashes on launch
→ Check Xcode console for errors. Common cause: missing `dist/` directory. Run `npm run ios:build`.

### White screen after launch
→ The web assets may not be synced. Run `npx cap sync ios` and rebuild in Xcode.
