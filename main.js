/**
 * DeskFlow — single bundle entry point.
 *
 * Side-effect imports in the EXACT order the old <script defer> tags had in
 * index.html (deferred scripts execute in document order regardless of
 * head/body position, so this linear order reproduces prior behavior).
 * Each imported file is a self-contained IIFE that exposes itself via
 * `window.X` when other scripts need it — none rely on implicit globals —
 * so wrapping them as ESM side-effect imports is safe without touching
 * their internals. `lp-theme.js` is intentionally NOT here: it must stay a
 * separate, synchronous, unbundled <script> to apply the theme before first
 * paint (see index.html).
 *
 * CSS is NOT imported here — see main.css and the <link rel="stylesheet">
 * in index.html. Importing CSS from this file would make Vite inject it
 * via a <style> tag at runtime in dev, after this deferred module script
 * runs — a visible flash of unstyled content on every reload that a real
 * blocking <link> doesn't have.
 */
import './lp-input-zoom.js';
import './lp-platform-urls.js';
import './lp-nav-icons.js';
import './lp-analytics.js';
import './lp-cookie-consent.js';
import './lp-guest-reset.js';
import './lp-login.js';
import './lp-login-nudge.js';
import './lp-about-content.js';
import './lp-about.js';
import './lp-help-content.js';
import './lp-help.js';
import './lp-settings.js';
import './lp-fluentflow-settings.js';
import './lp-dev-tools.js';
import './lp-onboarding.js';
import './lp-placement-test.js';
import './lp-completion-settings.js';
import './app.js';
