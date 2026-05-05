# Changelog

## 0.0.20

- Refined mobile touch gesture arbitration so inner content scrolling, sheet dragging, and taps/focus no longer fight each other.
- Replaced fixed focus follow-up timers with viewport/detent stabilization before focused-field auto-scroll.
- Hardened keyboard inset hysteresis and added mobile QA controls plus focused regression coverage.

## 0.0.19

- Hardened iOS/PWA edge cases around focus locks, viewport meta normalization, keyboard padding, stacked drawer handoff, and dismissable scroll clamping.
- Added unique hidden switch haptic targets per drawer and expanded regression coverage.
- Refined the vanilla demo into a minimal Apple Developer-style edge-case verification page.

## 0.0.18

- Reverted visual viewport top compensation after it caused fixed host chrome to drift during input focus.

## 0.0.17

- Tried visual viewport offset compensation for page anchoring during iOS input focus.

## 0.0.16

- Replaced Despia-specific haptics with PWA-friendly iOS switch haptics and Android vibration fallback.

## 0.0.15

- Hardened page scroll locking while drawer content auto-scrolls.

## 0.0.14

- Kept the drawer expanded after keyboard input blur.

## 0.0.13

- Reset inner drawer content scroll when the drawer fully closes.

## 0.0.12

- Restored body-fixed iOS focus locking with URL-bar jump mitigation.

## 0.0.11

- Tested an overflow-only page lock for keyboard focus.

## 0.0.10

- Improved non-keyboard inputs, inner content auto-scroll smoothness, and redesigned the vanilla demo.

## 0.0.9

- Added multi-drawer stacking and documented targeting drawers by selector.

## 0.0.8

- Polished the production demo and form coverage.

## 0.0.7

- Improved text input focus reliability and keyboard dismissal behavior.

## 0.0.6

- Added GitHub Pages demo deployment.

## 0.0.5

- Added WebView-friendly iOS input focus guards.

## 0.0.4

- Stabilized CSS-native scroll snap behavior and package publishing.

## 0.0.3

- Fixed programmatic detent changes and desktop wheel rough edges.

## 0.0.2

- Scoped keyboard scroll prevention to open drawers and focused text inputs.

## 0.0.1

- Initial package release with native CSS scroll-snap detents, framework wrappers, and vanilla demo.
