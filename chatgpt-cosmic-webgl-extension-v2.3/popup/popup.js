(() => {
  "use strict";

  const STORAGE_KEY = "chatgptStlSettings";
  const DEFAULTS = {
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
  };

  const INPUT_IDS = [
    "enabled", "followModel", "motion", "intensity", "readability",
    "brightness", "planetSize", "particleStrength", "glowStrength",
    "orbitDensity", "particleSpeed", "planetX", "planetY",
    "transitionDuration", "quality"
  ];
  const elements = Object.fromEntries(INPUT_IDS.map((id) => [id, document.getElementById(id)]));
  const reset = document.getElementById("reset");
  let state = { ...DEFAULTS };
  let saveTimer = 0;

  const output = (id) => document.getElementById(`${id}Value`);

  function positionLabel(value, negative, positive) {
    if (value === 0) return "居中";
    return `${value < 0 ? negative : positive} ${Math.abs(value)}%`;
  }

  function render() {
    for (const key of ["enabled", "followModel", "motion"]) {
      elements[key].checked = Boolean(state[key]);
    }
    for (const key of [
      "intensity", "readability", "brightness", "planetSize", "particleStrength",
      "glowStrength", "orbitDensity", "particleSpeed", "planetX", "planetY",
      "transitionDuration"
    ]) {
      elements[key].value = String(state[key]);
    }
    elements.quality.value = state.quality;

    for (const key of [
      "intensity", "readability", "brightness", "planetSize", "particleStrength",
      "glowStrength", "orbitDensity", "particleSpeed"
    ]) {
      output(key).value = `${state[key]}%`;
    }
    output("planetX").value = positionLabel(state.planetX, "左", "右");
    output("planetY").value = positionLabel(state.planetY, "下", "上");
    output("transitionDuration").value = `${(state.transitionDuration / 1000).toFixed(1)}s`;

    const radio = document.querySelector(`input[name="theme"][value="${state.fixedTheme}"]`);
    if (radio) radio.checked = true;
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => chrome.storage.local.set({ [STORAGE_KEY]: state }), 30);
  }

  for (const key of ["enabled", "followModel", "motion"]) {
    elements[key].addEventListener("change", () => {
      state[key] = elements[key].checked;
      save();
    });
  }

  for (const key of [
    "intensity", "readability", "brightness", "planetSize", "particleStrength",
    "glowStrength", "orbitDensity", "particleSpeed", "planetX", "planetY",
    "transitionDuration"
  ]) {
    elements[key].addEventListener("input", () => {
      state[key] = Number(elements[key].value);
      render();
      save();
    });
  }

  elements.quality.addEventListener("change", () => {
    state.quality = elements.quality.value;
    save();
  });

  document.querySelectorAll('input[name="theme"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      state.fixedTheme = radio.value;
      save();
    });
  });

  reset.addEventListener("click", () => {
    state = { ...DEFAULTS };
    render();
    chrome.storage.local.set({ [STORAGE_KEY]: state });
  });

  chrome.storage.local.get(STORAGE_KEY, (result) => {
    const stored = result[STORAGE_KEY] || {};
    state = { ...DEFAULTS, ...stored };
    if ((Number(stored.settingsVersion) || 0) < 23) {
      state.brightness = Math.min(Number(state.brightness) || DEFAULTS.brightness, 98);
      state.particleStrength = Math.min(Number(state.particleStrength) || DEFAULTS.particleStrength, 96);
      state.glowStrength = Math.min(Number(state.glowStrength) || DEFAULTS.glowStrength, 108);
      state.orbitDensity = Math.min(Number(state.orbitDensity) || DEFAULTS.orbitDensity, 86);
      state.intensity = Math.min(Number(state.intensity) || DEFAULTS.intensity, 74);
      state.settingsVersion = 23;
      chrome.storage.local.set({ [STORAGE_KEY]: state });
    }
    render();
  });
})();
