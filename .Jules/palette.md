## 2025-05-14 - Standardizing Mobile YouTube Desktop Experience
**Learning:** Users transitioning from desktop to mobile web versions of services often expect consistent keyboard shortcuts. Adding standard shortcuts (like J, K, L for YouTube) significantly reduces cognitive load and improves accessibility for keyboard power users.
**Action:** Always check if a platform has established "industry standard" shortcuts when implementing keyboard support for custom UI elements.

## 2025-05-14 - Accessibility for Temporary HUD Elements
**Learning:** HUD elements (Heads-Up Displays) that appear briefly in response to user actions are often missed by screen readers. Using `aria-live="polite"` and `aria-atomic="true"` ensures these changes are announced without interrupting the primary experience.
**Action:** For any transient visual feedback (like volume changes or seeking indicators), implement ARIA live regions to maintain an equitable experience for non-visual users.
