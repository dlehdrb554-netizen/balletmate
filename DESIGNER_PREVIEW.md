# Balletmate designer live preview

This is a development-only preview workflow. It does not replace the production/release APK.

## One-time setup

1. Run the GitHub Actions workflow **Designer live preview APK** (or wait for it to run after a change to app/package files).
2. Download the `balletmate-designer-preview` artifact and install the APK on the designer's Android device.
3. Keep the designer preview APK installed. It is an Expo development client, not a store/release build.

## Live preview session

On the developer machine, from the repository root:

```sh
npm install
npm run preview:designer
```

Expo starts a tunnel and prints a QR code / development URL. The designer opens the installed Balletmate development client and connects to that development server using the QR code or URL. Keep the developer machine and Metro process running during the session.

For a same-Wi-Fi local session, use:

```sh
npm run preview:lan
```

When a developer saves a React Native source file, Fast Refresh updates the connected device without rebuilding or reinstalling the APK. A native dependency, app config, permission, or native Android project change still requires a new development APK.

## How Figma changes reach the app

Figma is the design source, not a live code editor. Editing a Figma frame does **not** automatically change React Native code. The agreed workflow is:

1. Designer updates the Figma component/frame and shares the Figma link plus the changed component or frame.
2. Developer translates the change into the app's shared React Native components/styles (prefer design tokens for color, typography, spacing, radius, and shadows).
3. Save the code change. Fast Refresh updates the designer's connected device.
4. Designer checks the real app and gives the next round of feedback.

This avoids manually exporting and pasting every screen. Only changed design specifications/components need to be handed over. Do not put production credentials or service-role keys in the preview build; use only the app's public Supabase client configuration and test accounts.

## Limitations

- The development server must remain running and reachable for live updates.
- Tunnel mode requires an internet connection; LAN mode requires the same local network.
- The preview APK is for design/QA only. Do not distribute it as the production app.
- Figma-to-code is not automatic or bidirectional. The Figma design must be implemented in React Native before the app changes.
