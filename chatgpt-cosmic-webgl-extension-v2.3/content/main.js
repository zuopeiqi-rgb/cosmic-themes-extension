(() => {
  "use strict";

  const ROOT_ID = "stl-cosmic-root";
  const STORAGE_KEY = "chatgptStlSettings";
  const DEFAULTS = Object.freeze({
    enabled: true,
    followModel: true,
    fixedTheme: "sol",
    motion: true,
    intensity: 74,
    readability: 76,
    brightness: 98,
    planetSize: 108,
    particleStrength: 96,
    glowStrength: 108,
    orbitDensity: 86,
    particleSpeed: 100,
    planetX: 0,
    planetY: 0,
    transitionDuration: 3400,
    quality: "auto",
    settingsVersion: 23
  });

  const MODEL_THEME_RULES = Object.freeze([
    { theme: "sol", patterns: [/\bsol\b/i, /gpt\s*[- ]?5(?:\.6)?\s*sol/i, /5\.6\s*sol/i, /太阳/i] },
    { theme: "terra", patterns: [/\bterra\b/i, /gpt\s*[- ]?5(?:\.6)?\s*terra/i, /5\.6\s*terra/i, /地球/i] },
    { theme: "luna", patterns: [/\bluna\b/i, /gpt\s*[- ]?5(?:\.6)?\s*luna/i, /5\.6\s*luna/i, /月球/i] }
  ]);

  let settings = { ...DEFAULTS };
  let root = null;
  let renderer = null;
  let observer = null;
  let detectTimer = 0;
  let firstThemeApplied = false;
  let lastAppliedTheme = "";

  function normalizeSettings(value) {
    const next = { ...DEFAULTS, ...(value || {}) };
    next.enabled = Boolean(next.enabled);
    next.followModel = Boolean(next.followModel);
    next.motion = Boolean(next.motion);
    next.fixedTheme = ["sol", "terra", "luna"].includes(next.fixedTheme) ? next.fixedTheme : DEFAULTS.fixedTheme;
    next.intensity = Math.max(25, Math.min(100, Number(next.intensity) || DEFAULTS.intensity));
    next.readability = Math.max(45, Math.min(95, Number(next.readability) || DEFAULTS.readability));
    next.brightness = Math.max(40, Math.min(150, Number(next.brightness) || DEFAULTS.brightness));
    next.planetSize = Math.max(60, Math.min(160, Number(next.planetSize) || DEFAULTS.planetSize));
    next.particleStrength = Math.max(20, Math.min(190, Number(next.particleStrength) || DEFAULTS.particleStrength));
    next.glowStrength = Math.max(40, Math.min(220, Number(next.glowStrength) || DEFAULTS.glowStrength));
    next.orbitDensity = Math.max(35, Math.min(180, Number(next.orbitDensity) || DEFAULTS.orbitDensity));
    next.particleSpeed = Math.max(40, Math.min(180, Number(next.particleSpeed) || DEFAULTS.particleSpeed));
    next.planetX = Math.max(-100, Math.min(100, Number(next.planetX) || 0));
    next.planetY = Math.max(-100, Math.min(100, Number(next.planetY) || 0));
    next.transitionDuration = Math.max(1800, Math.min(5200, Number(next.transitionDuration) || DEFAULTS.transitionDuration));
    next.quality = ["auto", "high", "medium", "low"].includes(next.quality) ? next.quality : "auto";

    // v2.3 migration: v2.2 shipped with an intentionally intense Sol preset.
    // Keep deliberately lower custom values, but gently normalize legacy high defaults.
    const incomingVersion = Number(value?.settingsVersion) || 0;
    if (incomingVersion < 23) {
      next.brightness = Math.min(next.brightness, 98);
      next.particleStrength = Math.min(next.particleStrength, 96);
      next.glowStrength = Math.min(next.glowStrength, 108);
      next.orbitDensity = Math.min(next.orbitDensity, 86);
      next.intensity = Math.min(next.intensity, 74);
    }
    next.settingsVersion = 23;
    return next;
  }

  function readSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        if (chrome.runtime.lastError) return resolve({ ...DEFAULTS });
        const normalized = normalizeSettings(result[STORAGE_KEY]);
        const stored = result[STORAGE_KEY] || {};
        if (JSON.stringify(stored) !== JSON.stringify(normalized)) {
          chrome.storage.local.set({ [STORAGE_KEY]: normalized });
        }
        resolve(normalized);
      });
    });
  }

  function safeText(element) {
    if (!element || !(element instanceof Element)) return "";
    if (element.closest('[data-message-author-role], article, #prompt-textarea, [contenteditable="true"]')) return "";
    return [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-model"),
      element.getAttribute("data-testid"),
      element.textContent
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);
  }

  function resolveThemeFromModel(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    for (const rule of MODEL_THEME_RULES) {
      if (rule.patterns.some((pattern) => pattern.test(text))) return rule.theme;
    }
    return "";
  }

  function detectCurrentModel() {
    const selectedSelectors = [
      '[role="menuitemradio"][aria-checked="true"]',
      '[role="option"][aria-selected="true"]',
      '[role="tab"][aria-selected="true"]',
      '[data-state="checked"][role]',
      '[data-selected="true"]'
    ];
    for (const selector of selectedSelectors) {
      for (const element of document.querySelectorAll(selector)) {
        const text = safeText(element);
        if (resolveThemeFromModel(text)) return text;
      }
    }

    const candidates = document.querySelectorAll([
      'header button[aria-haspopup="menu"]',
      'header button[aria-haspopup="listbox"]',
      'main button[aria-haspopup="menu"]',
      'button[aria-label*="model" i]',
      'button[aria-label*="模型"]',
      '[data-testid*="model" i]',
      '[role="button"][aria-haspopup="menu"]',
      '[role="button"][aria-haspopup="listbox"]'
    ].join(","));
    for (const candidate of candidates) {
      const text = safeText(candidate);
      if (resolveThemeFromModel(text)) return text;
    }
    return "";
  }

  function createRoot() {
    if (root?.isConnected) return root;
    const existing = document.getElementById(ROOT_ID);
    if (existing) {
      root = existing;
      return root;
    }
    if (!document.body) return null;

    root = document.createElement("div");
    root.id = ROOT_ID;
    root.setAttribute("aria-hidden", "true");
    root.innerHTML = `
      <canvas id="stl-cosmic-canvas"></canvas>
      <div class="stl-cosmic-haze"></div>
      <div class="stl-cosmic-scrim"></div>
      <div class="stl-cosmic-vignette"></div>
      <div class="stl-cosmic-grain"></div>
    `;
    document.body.prepend(root);

    try {
      renderer = new globalThis.STLCosmicRenderer(root.querySelector("canvas"));
    } catch (error) {
      console.warn("[Sol Terra Luna] WebGL renderer unavailable; using static fallback.", error);
      document.documentElement.dataset.stlWebgl = "false";
      root.classList.add("stl-webgl-fallback");
    }
    return root;
  }

  function applyVisualSettings() {
    const html = document.documentElement;
    const intensity = settings.intensity / 100;
    const readability = settings.readability / 100;
    const brightness = settings.brightness / 100;
    const planetSize = settings.planetSize / 100;
    const particleStrength = settings.particleStrength / 100;
    const glowStrength = settings.glowStrength / 100;
    const orbitDensity = settings.orbitDensity / 100;
    const particleSpeed = settings.particleSpeed / 100;

    html.dataset.stlEnabled = String(settings.enabled);
    html.dataset.stlMotion = String(settings.enabled && settings.motion);
    html.style.setProperty("--stl-canvas-opacity", String(0.42 + intensity * 0.56));
    html.style.setProperty("--stl-readability", String(readability));
    html.style.setProperty("--stl-scrim-center", String(0.42 + readability * 0.33));
    html.style.setProperty("--stl-scrim-mid", String(0.32 + readability * 0.28));
    html.style.setProperty("--stl-scrim-side", String(0.30 + readability * 0.25));
    html.style.setProperty("--stl-haze-opacity", String(0.22 + intensity * 0.28));
    html.style.setProperty("--stl-scene-brightness", String(brightness.toFixed(3)));

    createRoot();
    if (renderer) {
      renderer.setEnabled(settings.enabled);
      renderer.setMotion(settings.motion && !matchMedia("(prefers-reduced-motion: reduce)").matches);
      renderer.setIntensity(intensity);
      renderer.setBrightness(brightness);
      renderer.setPlanetSize(planetSize);
      renderer.setParticleStrength(particleStrength);
      renderer.setGlowStrength(glowStrength);
      renderer.setOrbitDensity(orbitDensity);
      renderer.setParticleSpeed(particleSpeed);
      renderer.setPlanetPosition(settings.planetX / 100, settings.planetY / 100);
      renderer.setTransitionDuration(settings.transitionDuration);
      renderer.setQuality(settings.quality);
    }
  }

  function chooseTheme() {
    if (!settings.enabled) return settings.fixedTheme;
    if (!settings.followModel) return settings.fixedTheme;
    const modelText = detectCurrentModel();
    return resolveThemeFromModel(modelText) || settings.fixedTheme;
  }

  function applyTheme(theme) {
    const normalized = ["sol", "terra", "luna"].includes(theme) ? theme : settings.fixedTheme;
    document.documentElement.dataset.stlTheme = normalized;
    if (renderer && normalized !== lastAppliedTheme) {
      renderer.setTheme(normalized, !firstThemeApplied);
    }
    lastAppliedTheme = normalized;
    firstThemeApplied = true;
  }

  function refreshTheme() {
    applyVisualSettings();
    applyTheme(chooseTheme());
  }

  function scheduleDetection(delay = 160) {
    clearTimeout(detectTimer);
    detectTimer = setTimeout(() => applyTheme(chooseTheme()), delay);
  }

  function relevantElement(element) {
    if (!(element instanceof Element)) return false;
    if (element.closest('[data-message-author-role], article, #prompt-textarea, [contenteditable="true"]')) return false;
    return Boolean(element.matches([
      '[role="menuitemradio"]',
      '[role="option"]',
      '[role="tab"]',
      '[aria-haspopup="menu"]',
      '[aria-haspopup="listbox"]',
      '[data-testid*="model" i]',
      '[aria-label*="model" i]',
      '[aria-label*="模型"]'
    ].join(",")) || element.closest([
      '[role="menuitemradio"]',
      '[role="option"]',
      '[aria-haspopup="menu"]',
      '[aria-haspopup="listbox"]',
      '[data-testid*="model" i]'
    ].join(",")));
  }

  function startObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        if (relevantElement(target)) return scheduleDetection();
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (relevantElement(node) || node.querySelector?.('[role="menuitemradio"],[role="option"],[data-testid*="model" i]')) {
            return scheduleDetection();
          }
        }
      }
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-label", "aria-selected", "aria-checked", "data-state", "data-model"]
    });
  }

  async function init() {
    settings = await readSettings();
    const boot = () => {
      if (!document.body) return requestAnimationFrame(boot);
      refreshTheme();
      startObserver();
      setTimeout(scheduleDetection, 700);
      setTimeout(scheduleDetection, 1800);
    };
    boot();

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[STORAGE_KEY]) return;
      settings = normalizeSettings(changes[STORAGE_KEY].newValue);
      refreshTheme();
    });

    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionPreference = () => applyVisualSettings();
    if (media.addEventListener) media.addEventListener("change", onMotionPreference);
    else media.addListener(onMotionPreference);
  }

  init().catch((error) => console.error("[Sol Terra Luna] initialization failed", error));
})();
