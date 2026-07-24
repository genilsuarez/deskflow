/**
 * Learn Platform — animate stat numbers and progress bars on cloud reveal.
 * Copied to each vanilla app; FluentFlow has a parallel hook.
 */

const DEFAULT_DURATION = 650;
const BAR_DURATION_MS = 700;

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
  );
}

export function animateValue({ from = 0, to, duration = DEFAULT_DURATION, onUpdate, onComplete } = {}) {
  const start = Number(from) || 0;
  const target = Number(to) || 0;
  if (prefersReducedMotion() || start === target) {
    onUpdate?.(target);
    onComplete?.();
    return () => {};
  }

  const t0 = performance.now();
  let frame = 0;
  const step = (now) => {
    const progress = Math.min(1, (now - t0) / duration);
    onUpdate?.(Math.round(start + (target - start) * easeOutCubic(progress)));
    if (progress < 1) frame = requestAnimationFrame(step);
    else onComplete?.();
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

export function animateText(element, from, to, formatter = (value) => String(value)) {
  if (!element) return () => {};
  return animateValue({
    from,
    to,
    onUpdate: (value) => {
      element.textContent = formatter(value);
    },
  });
}

export function animateWidth(element, toPct, { fromPct = 0, duration = BAR_DURATION_MS } = {}) {
  if (!element) return () => {};
  const to = Math.max(0, Math.min(100, Number(toPct) || 0));
  const from = Math.max(0, Math.min(100, Number(fromPct) || 0));
  if (prefersReducedMotion() || from === to) {
    element.style.width = `${to}%`;
    return () => {};
  }

  element.classList.add('lp-stat-fill--animate');
  element.style.width = `${from}%`;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      element.style.width = `${to}%`;
    });
  });
  return () => {};
}

export function animateCssVar(element, varName, to, { from = 0, duration = BAR_DURATION_MS } = {}) {
  if (!element) return () => {};
  const target = Math.max(0, Math.min(100, Number(to) || 0));
  const start = Math.max(0, Math.min(100, Number(from) || 0));
  if (prefersReducedMotion() || start === target) {
    element.style.setProperty(varName, String(target));
    return () => {};
  }

  element.classList.add('lp-stat-ring--animate');
  element.style.setProperty(varName, String(start));
  return animateValue({
    from: start,
    to: target,
    duration,
    onUpdate: (value) => element.style.setProperty(varName, String(value)),
  });
}
