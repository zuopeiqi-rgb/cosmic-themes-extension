(() => {
  "use strict";

  const TAU = Math.PI * 2;
  const THEME_INDEX = Object.freeze({ sol: 0, terra: 1, luna: 2 });

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const easeInOut = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

  const PRESETS = Object.freeze({
    sol: {
      objectPosition: [-0.88, 0.12, 0],
      cameraDistance: 3.75,
      rotationSpeed: 0.055,
      exposure: 1.0,
      starA: [1.0, 0.42, 0.08],
      starB: [1.0, 0.84, 0.46],
      backdrop: [0.012, 0.004, 0.001]
    },
    terra: {
      objectPosition: [0.72, 0.08, 0],
      cameraDistance: 3.6,
      rotationSpeed: 0.032,
      exposure: 0.92,
      starA: [0.08, 0.44, 1.0],
      starB: [0.42, 0.88, 1.0],
      backdrop: [0.001, 0.014, 0.035]
    },
    luna: {
      objectPosition: [0.82, -0.02, 0],
      cameraDistance: 3.72,
      rotationSpeed: 0.018,
      exposure: 0.82,
      starA: [0.52, 0.62, 0.82],
      starB: [0.92, 0.96, 1.0],
      backdrop: [0.004, 0.005, 0.009]
    }
  });

  const QUALITY = Object.freeze({
    high: { sphere: 16000, orbit: 4608, stars: 2300, dpr: 1.65 },
    medium: { sphere: 10500, orbit: 3072, stars: 1600, dpr: 1.3 },
    low: { sphere: 6200, orbit: 1920, stars: 900, dpr: 1.0 }
  });

  const VERTEX_STARS = `#version 300 es
    precision highp float;
    precision highp int;
    in vec3 aPosition;
    in float aSeed;
    uniform mat4 uProjection;
    uniform mat4 uView;
    uniform float uTime;
    uniform float uWarp;
    uniform float uDpr;
    uniform float uIntensity;
    uniform float uParticleSpeed;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    out vec4 vColor;
    void main() {
      vec3 p = aPosition;
      float drift = uTime * uParticleSpeed * (0.004 + aSeed * 0.002);
      p.x += sin(drift + aSeed * 31.0) * 0.055;
      p.y += cos(drift * 0.83 + aSeed * 19.0) * 0.042;
      p.z += uWarp * (0.4 + aSeed * 2.8);
      vec4 mv = uView * vec4(p, 1.0);
      gl_Position = uProjection * mv;
      float perspective = 4.0 / max(2.0, -mv.z);
      float size = (0.55 + 2.7 * pow(aSeed, 5.0)) * perspective * uDpr;
      gl_PointSize = clamp(size, 0.7 * uDpr, 4.5 * uDpr);
      float twinkle = 0.78 + 0.22 * sin(uTime * uParticleSpeed * (0.25 + aSeed * 0.8) + aSeed * 43.0);
      vec3 color = mix(uColorA, uColorB, smoothstep(0.25, 0.95, aSeed));
      float alpha = (0.09 + 0.5 * pow(aSeed, 2.3)) * twinkle * uIntensity;
      vColor = vec4(color, alpha);
    }
  `;

  const FRAGMENT_POINT = `#version 300 es
    precision highp float;
    precision highp int;
    in vec4 vColor;
    out vec4 outColor;
    void main() {
      vec2 c = gl_PointCoord - vec2(0.5);
      float d = length(c) * 2.0;
      if (d > 1.0) discard;
      float halo = smoothstep(1.0, 0.0, d);
      float core = smoothstep(0.36, 0.0, d);
      float alpha = vColor.a * (halo * 0.9 + core * 1.05);
      outColor = vec4(vColor.rgb * (0.82 + halo * 0.28 + core * 0.84), alpha);
    }
  `;

  const VERTEX_CELESTIAL = `#version 300 es
    precision highp float;
    precision highp int;
    in vec3 aPosition;
    in float aSeed;
    in float aLand;
    in float aCrater;
    uniform mat4 uProjection;
    uniform mat4 uView;
    uniform vec3 uObjectPosition;
    uniform float uObjectScale;
    uniform float uRotationY;
    uniform float uRotationX;
    uniform float uTime;
    uniform float uDpr;
    uniform int uFromTheme;
    uniform int uToTheme;
    uniform float uMorph;
    uniform float uHaloPass;
    out vec3 vNormal;
    out vec3 vWorldPosition;
    out vec3 vUnitPosition;
    out float vSeed;
    out float vLand;
    out float vCrater;
    out float vRim;

    float hash31(vec3 p) {
      return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
    }
    float noise3(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float n000 = hash31(i + vec3(0,0,0));
      float n100 = hash31(i + vec3(1,0,0));
      float n010 = hash31(i + vec3(0,1,0));
      float n110 = hash31(i + vec3(1,1,0));
      float n001 = hash31(i + vec3(0,0,1));
      float n101 = hash31(i + vec3(1,0,1));
      float n011 = hash31(i + vec3(0,1,1));
      float n111 = hash31(i + vec3(1,1,1));
      return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
                 mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
    }
    float fbm(vec3 p) {
      float value = 0.0;
      float amp = 0.52;
      for (int i = 0; i < 4; i++) {
        value += noise3(p) * amp;
        p = p * 2.03 + vec3(0.17, 0.11, 0.13);
        amp *= 0.5;
      }
      return value;
    }
    mat3 rotateY(float a) {
      float c = cos(a), s = sin(a);
      return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c);
    }
    mat3 rotateX(float a) {
      float c = cos(a), s = sin(a);
      return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c);
    }
    float pickTheme(int idx, float sol, float terra, float luna) {
      if (idx == 0) return sol;
      if (idx == 1) return terra;
      return luna;
    }

    void main() {
      vec3 p = normalize(aPosition);
      float solNoise = fbm(p * 5.2 + vec3(uTime * 0.045, -uTime * 0.022, uTime * 0.016));
      float solFine = noise3(p * 18.0 - vec3(uTime * 0.08, 0.0, 0.0));
      float solDisp = (solNoise - 0.48) * 0.105 + (solFine - 0.5) * 0.024;
      float terraNoise = fbm(p * 7.0 + vec3(0.0, uTime * 0.008, 0.0));
      float terraDisp = (terraNoise - 0.5) * 0.018 + aLand * 0.008;
      float lunaNoise = fbm(p * 9.0);
      float lunaDisp = (lunaNoise - 0.5) * 0.022 - aCrater * 0.052;
      float fromDisp = pickTheme(uFromTheme, solDisp, terraDisp, lunaDisp);
      float toDisp = pickTheme(uToTheme, solDisp, terraDisp, lunaDisp);
      float displacement = mix(fromDisp, toDisp, uMorph);
      float haloScale = mix(1.0, 1.062, uHaloPass);
      vec3 local = p * (1.0 + displacement) * uObjectScale * haloScale;
      mat3 rotation = rotateY(uRotationY) * rotateX(uRotationX);
      local = rotation * local;
      vec3 world = uObjectPosition + local;
      vec3 normal = normalize(rotation * p);
      vec4 mv = uView * vec4(world, 1.0);
      gl_Position = uProjection * mv;
      float pointBaseFrom = pickTheme(uFromTheme, 2.65, 2.05, 1.92);
      float pointBaseTo = pickTheme(uToTheme, 2.65, 2.05, 1.92);
      float pointBase = mix(pointBaseFrom, pointBaseTo, uMorph);
      float perspective = 4.4 / max(1.8, -mv.z);
      float seedSize = 0.74 + 0.62 * pow(aSeed, 2.0);
      gl_PointSize = clamp(pointBase * seedSize * perspective * uDpr * mix(1.0, 2.75, uHaloPass), 0.8 * uDpr, 10.0 * uDpr);
      vNormal = normal;
      vWorldPosition = world;
      vUnitPosition = p;
      vSeed = aSeed;
      vLand = aLand;
      vCrater = aCrater;
      vec3 viewNormal = normalize(mat3(uView) * normal);
      vRim = pow(1.0 - abs(viewNormal.z), 2.05);
    }
  `;

  const FRAGMENT_CELESTIAL = `#version 300 es
    precision highp float;
    precision highp int;
    in vec3 vNormal;
    in vec3 vWorldPosition;
    in vec3 vUnitPosition;
    in float vSeed;
    in float vLand;
    in float vCrater;
    in float vRim;
    uniform float uTime;
    uniform int uFromTheme;
    uniform int uToTheme;
    uniform float uMorph;
    uniform float uHaloPass;
    uniform float uIntensity;
    uniform vec3 uCameraPosition;
    out vec4 outColor;

    float hash31(vec3 p) {
      return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
    }
    float noise3(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float n000 = hash31(i + vec3(0,0,0));
      float n100 = hash31(i + vec3(1,0,0));
      float n010 = hash31(i + vec3(0,1,0));
      float n110 = hash31(i + vec3(1,1,0));
      float n001 = hash31(i + vec3(0,0,1));
      float n101 = hash31(i + vec3(1,0,1));
      float n011 = hash31(i + vec3(0,1,1));
      float n111 = hash31(i + vec3(1,1,1));
      return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
                 mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
    }
    float fbm(vec3 p) {
      float value = 0.0;
      float amp = 0.52;
      for (int i = 0; i < 4; i++) {
        value += noise3(p) * amp;
        p = p * 2.01 + vec3(0.19,0.11,0.07);
        amp *= 0.5;
      }
      return value;
    }

    vec4 solColor() {
      float field = fbm(vUnitPosition * 6.8 + vec3(uTime * 0.055, -uTime * 0.026, uTime * 0.02));
      float fine = noise3(vUnitPosition * 25.0 - vec3(uTime * 0.12, 0.0, 0.0));
      float hot = smoothstep(0.61, 0.95, field + fine * 0.18 + vSeed * 0.06);
      float fissure = pow(smoothstep(0.55, 0.84, fine), 2.0);
      vec3 dark = vec3(0.27, 0.035, 0.0);
      vec3 mid = vec3(1.0, 0.27, 0.0);
      vec3 gold = vec3(1.0, 0.71, 0.12);
      vec3 whiteHot = vec3(1.0, 0.94, 0.61);
      vec3 color = mix(dark, mid, smoothstep(0.25, 0.77, field));
      color = mix(color, gold, hot * 0.78 + fissure * 0.38);
      color = mix(color, whiteHot, pow(hot, 3.0) * 0.68);
      color += vec3(1.0, 0.42, 0.03) * vRim * 0.78;
      float alpha = 0.72 + field * 0.28;
      return vec4(color, alpha);
    }

    vec4 terraColor() {
      vec3 lightDir = normalize(vec3(-0.62, 0.55, 0.74));
      float daylight = clamp(dot(normalize(vNormal), lightDir) * 0.56 + 0.44, 0.0, 1.0);
      float cloud = fbm(vUnitPosition * 9.5 + vec3(uTime * 0.006, -uTime * 0.009, 0.0));
      float cloudMask = smoothstep(0.63, 0.84, cloud);
      vec3 oceanDark = vec3(0.002, 0.035, 0.11);
      vec3 oceanLight = vec3(0.01, 0.26, 0.55);
      vec3 landDark = vec3(0.015, 0.12, 0.10);
      vec3 landLight = vec3(0.17, 0.42, 0.26);
      vec3 ocean = mix(oceanDark, oceanLight, daylight);
      vec3 land = mix(landDark, landLight, daylight);
      vec3 color = mix(ocean, land, smoothstep(0.38, 0.65, vLand));
      float night = 1.0 - daylight;
      float city = step(0.955, hash31(floor(vUnitPosition * 75.0))) * smoothstep(0.48, 0.72, vLand) * night;
      color += vec3(1.0, 0.72, 0.34) * city * 1.5;
      color = mix(color, vec3(0.72, 0.9, 1.0), cloudMask * 0.42 * daylight);
      color += vec3(0.05, 0.55, 1.0) * vRim * 1.15;
      float alpha = 0.77 + daylight * 0.23;
      return vec4(color, alpha);
    }

    vec4 lunaColor() {
      vec3 lightDir = normalize(vec3(-0.58, 0.68, 0.62));
      float daylight = clamp(dot(normalize(vNormal), lightDir) * 0.62 + 0.38, 0.0, 1.0);
      float grain = fbm(vUnitPosition * 13.0) * 0.28;
      float craterShade = vCrater * (0.32 + 0.42 * (1.0 - daylight));
      float tone = clamp(0.22 + daylight * 0.72 + grain - craterShade, 0.06, 1.0);
      vec3 shadow = vec3(0.055, 0.063, 0.085);
      vec3 silver = vec3(0.72, 0.75, 0.82);
      vec3 highlight = vec3(0.94, 0.97, 1.0);
      vec3 color = mix(shadow, silver, smoothstep(0.12, 0.82, tone));
      color = mix(color, highlight, smoothstep(0.82, 1.0, tone) * 0.8);
      color += vec3(0.46, 0.61, 1.0) * vRim * 0.48;
      float alpha = 0.76 + daylight * 0.24;
      return vec4(color, alpha);
    }

    vec4 pickColor(int idx) {
      if (idx == 0) return solColor();
      if (idx == 1) return terraColor();
      return lunaColor();
    }

    void main() {
      vec2 c = gl_PointCoord - vec2(0.5);
      float d = length(c) * 2.0;
      if (d > 1.0) discard;
      float outer = smoothstep(1.0, 0.0, d);
      float core = smoothstep(0.42, 0.0, d);
      vec4 fromColor = pickColor(uFromTheme);
      vec4 toColor = pickColor(uToTheme);
      vec4 color = mix(fromColor, toColor, uMorph);
      if (uHaloPass > 0.5) {
        vec3 haloFrom = uFromTheme == 0 ? vec3(1.0,0.31,0.01) : (uFromTheme == 1 ? vec3(0.02,0.48,1.0) : vec3(0.48,0.63,1.0));
        vec3 haloTo = uToTheme == 0 ? vec3(1.0,0.31,0.01) : (uToTheme == 1 ? vec3(0.02,0.48,1.0) : vec3(0.48,0.63,1.0));
        vec3 halo = mix(haloFrom, haloTo, uMorph);
        float haloAlpha = outer * (0.035 + vRim * 0.22) * uIntensity;
        outColor = vec4(halo * (0.65 + core), haloAlpha);
        return;
      }
      float alpha = color.a * (outer * 0.66 + core * 0.62) * uIntensity;
      outColor = vec4(color.rgb * (0.72 + core * 0.62), alpha);
    }
  `;

  const VERTEX_BODY = `#version 300 es
    precision highp float;
    precision highp int;
    in vec3 aPosition;
    uniform mat4 uProjection;
    uniform mat4 uView;
    uniform vec3 uObjectPosition;
    uniform float uObjectScale;
    uniform float uRotationY;
    uniform float uRotationX;
    uniform float uTime;
    uniform int uFromTheme;
    uniform int uToTheme;
    uniform float uMorph;
    out vec3 vNormal;
    out vec3 vUnitPosition;
    out vec3 vWorldPosition;
    out float vRim;

    float hash31(vec3 p) {
      return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
    }
    float noise3(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float n000 = hash31(i + vec3(0,0,0));
      float n100 = hash31(i + vec3(1,0,0));
      float n010 = hash31(i + vec3(0,1,0));
      float n110 = hash31(i + vec3(1,1,0));
      float n001 = hash31(i + vec3(0,0,1));
      float n101 = hash31(i + vec3(1,0,1));
      float n011 = hash31(i + vec3(0,1,1));
      float n111 = hash31(i + vec3(1,1,1));
      return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
                 mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
    }
    float fbm(vec3 p) {
      float value = 0.0;
      float amp = 0.52;
      for (int i = 0; i < 5; i++) {
        value += noise3(p) * amp;
        p = p * 2.02 + vec3(0.17, 0.11, 0.13);
        amp *= 0.5;
      }
      return value;
    }
    mat3 rotateY(float a) {
      float c = cos(a), s = sin(a);
      return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c);
    }
    mat3 rotateX(float a) {
      float c = cos(a), s = sin(a);
      return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c);
    }
    float pickTheme(int idx, float sol, float terra, float luna) {
      if (idx == 0) return sol;
      if (idx == 1) return terra;
      return luna;
    }
    void main() {
      vec3 p = normalize(aPosition);
      float solDisp = (fbm(p * 5.0 + vec3(uTime * 0.042, -uTime * 0.02, uTime * 0.013)) - 0.5) * 0.064;
      float terraDisp = (fbm(p * 8.0 + vec3(0.0, uTime * 0.004, 0.0)) - 0.5) * 0.012;
      float lunaDisp = (fbm(p * 11.0) - 0.5) * 0.018;
      float displacement = mix(
        pickTheme(uFromTheme, solDisp, terraDisp, lunaDisp),
        pickTheme(uToTheme, solDisp, terraDisp, lunaDisp),
        uMorph
      );
      mat3 rotation = rotateY(uRotationY) * rotateX(uRotationX);
      vec3 local = rotation * (p * (1.0 + displacement) * uObjectScale);
      vec3 world = uObjectPosition + local;
      vec3 normal = normalize(rotation * p);
      gl_Position = uProjection * uView * vec4(world, 1.0);
      vNormal = normal;
      vUnitPosition = p;
      vWorldPosition = world;
      vec3 viewNormal = normalize(mat3(uView) * normal);
      vRim = pow(1.0 - abs(viewNormal.z), 1.85);
    }
  `;

  const FRAGMENT_BODY = `#version 300 es
    precision highp float;
    precision highp int;
    in vec3 vNormal;
    in vec3 vUnitPosition;
    in vec3 vWorldPosition;
    in float vRim;
    uniform float uTime;
    uniform int uFromTheme;
    uniform int uToTheme;
    uniform float uMorph;
    uniform float uIntensity;
    out vec4 outColor;

    float hash31(vec3 p) {
      return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
    }
    float noise3(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float n000 = hash31(i + vec3(0,0,0));
      float n100 = hash31(i + vec3(1,0,0));
      float n010 = hash31(i + vec3(0,1,0));
      float n110 = hash31(i + vec3(1,1,0));
      float n001 = hash31(i + vec3(0,0,1));
      float n101 = hash31(i + vec3(1,0,1));
      float n011 = hash31(i + vec3(0,1,1));
      float n111 = hash31(i + vec3(1,1,1));
      return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
                 mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
    }
    float fbm(vec3 p) {
      float value = 0.0;
      float amp = 0.52;
      for (int i = 0; i < 5; i++) {
        value += noise3(p) * amp;
        p = p * 2.01 + vec3(0.19,0.11,0.07);
        amp *= 0.5;
      }
      return value;
    }
    float landMask(vec3 p) {
      float lon = atan(p.z, p.x);
      float lat = asin(clamp(p.y, -1.0, 1.0));
      float v = sin(lon * 1.73 + sin(lat * 2.8) * 1.2) * 0.34
              + sin(lon * 3.8 - lat * 2.1) * 0.21
              + cos(lon * 0.75 + lat * 5.2) * 0.23
              + sin(lon * 6.1 + lat * 1.3) * 0.12
              + (noise3(p * 8.0) - 0.5) * 0.14;
      return smoothstep(-0.08, 0.28, v);
    }
    float craterMask(vec3 p) {
      float coarse = noise3(p * 8.5);
      float fine = noise3(p * 24.0);
      float pits = smoothstep(0.72, 0.93, coarse) * (0.5 + fine * 0.5);
      float rims = smoothstep(0.61, 0.75, coarse) - smoothstep(0.76, 0.88, coarse);
      return clamp(pits * 0.9 + rims * 0.35, 0.0, 1.0);
    }
    vec3 solBody() {
      float field = fbm(vUnitPosition * 5.7 + vec3(uTime * 0.05, -uTime * 0.021, uTime * 0.017));
      float fine = fbm(vUnitPosition * 18.0 - vec3(uTime * 0.085, 0.0, 0.0));
      float filaments = pow(smoothstep(0.48, 0.78, fine), 1.55);
      float hot = smoothstep(0.63, 0.92, field + fine * 0.19);
      vec3 deep = vec3(0.16, 0.012, 0.0);
      vec3 ember = vec3(0.72, 0.095, 0.0);
      vec3 orange = vec3(1.0, 0.33, 0.005);
      vec3 gold = vec3(1.0, 0.75, 0.16);
      vec3 whiteHot = vec3(1.0, 0.96, 0.66);
      vec3 color = mix(deep, ember, smoothstep(0.18, 0.62, field));
      color = mix(color, orange, smoothstep(0.45, 0.82, field));
      color = mix(color, gold, filaments * 0.72 + hot * 0.45);
      color = mix(color, whiteHot, pow(hot, 3.0) * 0.64);
      color += vec3(1.0, 0.34, 0.0) * vRim * 0.72;
      return color;
    }
    vec3 terraBody() {
      vec3 n = normalize(vNormal);
      vec3 lightDir = normalize(vec3(-0.65, 0.56, 0.74));
      float lambert = max(dot(n, lightDir), 0.0);
      float daylight = pow(lambert, 0.72);
      float land = landMask(vUnitPosition);
      float detail = fbm(vUnitPosition * 12.0);
      vec3 oceanNight = vec3(0.001, 0.012, 0.045);
      vec3 oceanDay = vec3(0.005, 0.24, 0.56);
      vec3 landNight = vec3(0.008, 0.035, 0.026);
      vec3 landDay = vec3(0.11, 0.36, 0.23);
      vec3 ocean = mix(oceanNight, oceanDay, daylight * 0.95 + 0.05);
      vec3 ground = mix(landNight, landDay, daylight * 0.9 + 0.06);
      vec3 color = mix(ocean, ground, land);
      float cloud = smoothstep(0.62, 0.82, fbm(vUnitPosition * 10.5 + vec3(uTime * 0.005, -uTime * 0.007, 0.0)));
      color = mix(color, vec3(0.68, 0.88, 1.0), cloud * daylight * 0.52);
      float night = 1.0 - daylight;
      float city = step(0.963, hash31(floor(vUnitPosition * 92.0))) * land * night;
      color += vec3(1.0, 0.68, 0.29) * city * 1.8;
      color += vec3(0.01, 0.49, 1.0) * vRim * 1.25;
      color += vec3(0.0, 0.13, 0.32) * detail * 0.18;
      return color;
    }
    vec3 lunaBody() {
      vec3 n = normalize(vNormal);
      vec3 lightDir = normalize(vec3(-0.62, 0.70, 0.63));
      float lambert = max(dot(n, lightDir), 0.0);
      float daylight = pow(lambert, 0.78);
      float terrain = fbm(vUnitPosition * 13.0);
      float crater = craterMask(vUnitPosition);
      float tone = clamp(0.08 + daylight * 0.87 + (terrain - 0.5) * 0.24 - crater * 0.31, 0.02, 1.0);
      vec3 shadow = vec3(0.025, 0.03, 0.045);
      vec3 mid = vec3(0.43, 0.46, 0.53);
      vec3 bright = vec3(0.87, 0.90, 0.96);
      vec3 color = mix(shadow, mid, smoothstep(0.08, 0.62, tone));
      color = mix(color, bright, smoothstep(0.62, 1.0, tone));
      color += vec3(0.34, 0.48, 0.82) * vRim * 0.45;
      return color;
    }
    vec3 pickColor(int idx) {
      if (idx == 0) return solBody();
      if (idx == 1) return terraBody();
      return lunaBody();
    }
    void main() {
      vec3 color = mix(pickColor(uFromTheme), pickColor(uToTheme), uMorph);
      float brightness = mix(0.92, 1.08, uIntensity);
      outColor = vec4(color * brightness, 0.985);
    }
  `;

  const VERTEX_ORBITS = `#version 300 es
    precision highp float;
    precision highp int;
    in float aT;
    in vec4 aParams;
    uniform mat4 uProjection;
    uniform mat4 uView;
    uniform vec3 uObjectPosition;
    uniform float uObjectScale;
    uniform float uRotationY;
    uniform float uTime;
    uniform float uDpr;
    uniform int uFromTheme;
    uniform int uToTheme;
    uniform float uMorph;
    uniform float uTransitionEnergy;
    uniform float uParticleStrength;
    uniform float uGlowStrength;
    uniform float uRingPass;
    uniform float uParticleSpeed;
    out vec4 vColor;

    const float TAU = 6.283185307179586;
    mat3 rotX(float a) { float c=cos(a),s=sin(a); return mat3(1,0,0, 0,c,s, 0,-s,c); }
    mat3 rotY(float a) { float c=cos(a),s=sin(a); return mat3(c,0,-s, 0,1,0, s,0,c); }
    mat3 rotZ(float a) { float c=cos(a),s=sin(a); return mat3(c,s,0, -s,c,0, 0,0,1); }
    vec3 spherePoint(float a, float b) {
      float y = a * 2.0 - 1.0;
      float r = sqrt(max(0.0, 1.0 - y * y));
      float phi = TAU * b;
      return vec3(cos(phi) * r, y, sin(phi) * r);
    }
    vec3 bezier(vec3 a, vec3 b, vec3 c, float t) {
      float q = 1.0 - t;
      return q*q*a + 2.0*q*t*b + t*t*c;
    }
    vec3 solPosition(float t, vec4 p) {
      float phase = fract(t + uTime * uParticleSpeed * (0.010 + p.w * 0.020));
      vec3 a = spherePoint(p.x, p.y);
      vec3 c = spherePoint(fract(p.x + 0.08 + p.z * 0.18), fract(p.y + 0.06 + p.x * 0.12));
      vec3 b = normalize(a + c + vec3((p.z-0.5)*0.35, (p.x-0.5)*0.28, (p.y-0.5)*0.35)) * (1.42 + p.z * 0.76 + uGlowStrength * 0.08);
      return bezier(a * 1.035, b, c * 1.035, phase);
    }
    vec3 terraPosition(float t, vec4 p) {
      float theta = TAU * fract(t + uTime * uParticleSpeed * (0.007 + p.w * 0.016));
      float r = 1.34 + p.x * 0.92 + uGlowStrength * 0.02;
      vec3 q = vec3(cos(theta) * r, sin(theta * (1.0 + p.z * 0.08)) * r * (0.06 + p.z * 0.20), sin(theta) * r);
      q = rotX((p.y - 0.5) * 2.1) * rotZ((p.z - 0.5) * 2.3) * q;
      return q;
    }
    vec3 lunaPosition(float t, vec4 p) {
      float theta = TAU * fract(t + uTime * uParticleSpeed * (0.0035 + p.w * 0.007));
      float r = 1.24 + p.x * 0.66 + uGlowStrength * 0.018;
      vec3 q = vec3(cos(theta) * r, sin(theta * 0.7) * 0.11, sin(theta) * r);
      q = rotX((p.y - 0.5) * 1.35) * rotZ((p.z - 0.5) * 1.5) * q;
      return q;
    }
    vec3 pickPosition(int idx, float t, vec4 p) {
      if (idx == 0) return solPosition(t,p);
      if (idx == 1) return terraPosition(t,p);
      return lunaPosition(t,p);
    }
    vec3 pickColor(int idx, vec4 p) {
      if (idx == 0) return mix(vec3(0.96,0.15,0.0), vec3(1.0,0.64,0.14), p.z);
      if (idx == 1) return mix(vec3(0.02,0.35,1.0), vec3(0.40,0.95,1.0), p.z);
      return mix(vec3(0.44,0.55,0.82), vec3(0.96,0.98,1.0), p.z);
    }
    float pickAlpha(int idx, vec4 p) {
      if (idx == 0) return 0.20 + p.w * 0.58;
      if (idx == 1) return 0.24 + p.w * 0.70;
      return (p.y > 0.24 ? 1.0 : 0.0) * (0.15 + p.w * 0.52);
    }

    void main() {
      vec3 fromPos = pickPosition(uFromTheme, aT, aParams);
      vec3 toPos = pickPosition(uToTheme, aT, aParams);
      vec3 local = mix(fromPos, toPos, uMorph);
      local = rotY(uRotationY * 0.34) * local;
      vec3 world = uObjectPosition + local * uObjectScale;
      vec4 mv = uView * vec4(world, 1.0);
      gl_Position = uProjection * mv;
      vec3 color = mix(pickColor(uFromTheme,aParams), pickColor(uToTheme,aParams), uMorph);
      float alpha = mix(pickAlpha(uFromTheme,aParams), pickAlpha(uToTheme,aParams), uMorph);
      float fromRefine = uFromTheme == 0 ? 0.76 : 1.0;
      float toRefine = uToTheme == 0 ? 0.76 : 1.0;
      float themeRefine = mix(fromRefine, toRefine, uMorph);
      alpha *= themeRefine;
      alpha *= 0.78 + 0.22 * sin(aT * 85.0 + uTime * uParticleSpeed * (0.5 + aParams.w));
      alpha *= (0.80 + uParticleStrength * 0.72);
      alpha *= 1.0 + uTransitionEnergy * 0.24;
      float perspective = 4.5 / max(2.0, -mv.z);
      float baseSize = (0.96 + aParams.w * 2.35) * perspective * uDpr;
      float sizeBoost = 0.90 + uParticleStrength * 0.78;
      float glowPass = step(0.5, uRingPass);
      float outerPass = step(1.5, uRingPass);
      float haloBoost = mix(1.0, 1.82 + uGlowStrength * 0.62, glowPass);
      haloBoost *= mix(1.0, 1.52 + uGlowStrength * 0.24, outerPass);
      float alphaBoost = mix(1.0, 0.38 + uGlowStrength * 0.20, glowPass);
      alphaBoost *= mix(1.0, 0.42, outerPass);
      gl_PointSize = clamp(baseSize * sizeBoost * haloBoost * mix(0.90, 1.0, themeRefine), 0.85 * uDpr, 12.0 * uDpr);
      vColor = vec4(color * mix(1.0, 1.22 + uGlowStrength * 0.16, glowPass), alpha * alphaBoost);
    }
  `;

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "Unknown shader compile error";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram(gl, vertexSource, fragmentSource) {
    const program = gl.createProgram();
    const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || "Unknown program link error";
      gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  function perspective(out, fovy, aspect, near, far) {
    const f = 1.0 / Math.tan(fovy / 2);
    out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[11] = -1;
    out[12] = 0; out[13] = 0; out[15] = 0;
    if (far != null && far !== Infinity) {
      const nf = 1 / (near - far);
      out[10] = (far + near) * nf;
      out[14] = 2 * far * near * nf;
    } else {
      out[10] = -1;
      out[14] = -2 * near;
    }
    return out;
  }

  function lookAt(out, eye, center, up) {
    let x0, x1, x2, y0, y1, y2, z0, z1, z2, len;
    z0 = eye[0] - center[0]; z1 = eye[1] - center[1]; z2 = eye[2] - center[2];
    len = Math.hypot(z0, z1, z2) || 1; z0 /= len; z1 /= len; z2 /= len;
    x0 = up[1] * z2 - up[2] * z1; x1 = up[2] * z0 - up[0] * z2; x2 = up[0] * z1 - up[1] * z0;
    len = Math.hypot(x0, x1, x2) || 1; x0 /= len; x1 /= len; x2 /= len;
    y0 = z1 * x2 - z2 * x1; y1 = z2 * x0 - z0 * x2; y2 = z0 * x1 - z1 * x0;
    out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
    out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
    out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
    out[12] = -(x0*eye[0] + x1*eye[1] + x2*eye[2]);
    out[13] = -(y0*eye[0] + y1*eye[1] + y2*eye[2]);
    out[14] = -(z0*eye[0] + z1*eye[1] + z2*eye[2]);
    out[15] = 1;
    return out;
  }

  function normalize3(v) {
    const length = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / length, v[1] / length, v[2] / length];
  }

  function angularDistance(a, b) {
    return Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1));
  }

  function seeded(index, salt = 0) {
    const x = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  function generateSphere(count) {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const land = new Float32Array(count);
    const crater = new Float32Array(count);
    const golden = Math.PI * (3 - Math.sqrt(5));
    const craterCenters = [];
    for (let i = 0; i < 34; i++) {
      const y = seeded(i, 7) * 2 - 1;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = TAU * seeded(i, 13);
      craterCenters.push({
        p: [Math.cos(phi) * r, y, Math.sin(phi) * r],
        radius: 0.035 + seeded(i, 17) * 0.115,
        depth: 0.4 + seeded(i, 23) * 0.6
      });
    }
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / Math.max(1, count - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      const seed = seeded(i, 31);
      seeds[i] = seed;
      const lon = Math.atan2(z, x);
      const lat = Math.asin(y);
      const continents =
        Math.sin(lon * 1.73 + Math.sin(lat * 2.8) * 1.2) * 0.34 +
        Math.sin(lon * 3.8 - lat * 2.1) * 0.21 +
        Math.cos(lon * 0.75 + lat * 5.2) * 0.23 +
        Math.sin(lon * 6.1 + lat * 1.3) * 0.12 +
        (seed - 0.5) * 0.1;
      land[i] = smoothstep(-0.08, 0.28, continents);
      let craterValue = 0;
      const point = [x, y, z];
      for (const c of craterCenters) {
        const distance = angularDistance(point, c.p);
        const rim = Math.exp(-Math.pow(distance / c.radius, 2.2));
        craterValue = Math.max(craterValue, rim * c.depth);
      }
      crater[i] = craterValue;
    }
    return { positions, seeds, land, crater };
  }

  function generateStars(count) {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const u = seeded(i, 43);
      const v = seeded(i, 47);
      const radius = 9 + Math.pow(seeded(i, 53), 0.55) * 27;
      const y = u * 2 - 1;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = TAU * v;
      positions[i * 3] = Math.cos(phi) * r * radius;
      positions[i * 3 + 1] = y * radius;
      positions[i * 3 + 2] = Math.sin(phi) * r * radius - 5;
      seeds[i] = seeded(i, 59);
    }
    return { positions, seeds };
  }

  function generateOrbits(count) {
    const t = new Float32Array(count);
    const params = new Float32Array(count * 4);
    const loopSize = 96;
    for (let i = 0; i < count; i++) {
      const loop = Math.floor(i / loopSize);
      const local = i % loopSize;
      t[i] = local / loopSize;
      params[i * 4] = seeded(loop, 61);
      params[i * 4 + 1] = seeded(loop, 67);
      params[i * 4 + 2] = seeded(loop, 71);
      params[i * 4 + 3] = seeded(loop, 73);
    }
    return { t, params };
  }

  function generateBodyMesh(latSegments = 84, lonSegments = 128) {
    const vertices = [];
    const indices = [];
    for (let y = 0; y <= latSegments; y++) {
      const v = y / latSegments;
      const phi = v * Math.PI;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);
      for (let x = 0; x <= lonSegments; x++) {
        const u = x / lonSegments;
        const theta = u * TAU;
        vertices.push(Math.cos(theta) * sinPhi, cosPhi, Math.sin(theta) * sinPhi);
      }
    }
    const stride = lonSegments + 1;
    for (let y = 0; y < latSegments; y++) {
      for (let x = 0; x < lonSegments; x++) {
        const a = y * stride + x;
        const b = a + stride;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return {
      positions: new Float32Array(vertices),
      indices: new Uint32Array(indices)
    };
  }

  function createBuffer(gl, data, size) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { buffer, size };
  }

  function bindAttribute(gl, program, name, descriptor) {
    const location = gl.getAttribLocation(program, name);
    if (location < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, descriptor.buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, descriptor.size, gl.FLOAT, false, 0, 0);
  }

  function uniformLocations(gl, program, names) {
    const result = {};
    for (const name of names) result[name] = gl.getUniformLocation(program, name);
    return result;
  }

  class CosmicRenderer {
    constructor(canvas, options = {}) {
      if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError("CosmicRenderer requires a canvas element");
      this.canvas = canvas;
      this.options = options;
      this.gl = canvas.getContext("webgl2", {
        alpha: true,
        antialias: false,
        depth: true,
        premultipliedAlpha: false,
        powerPreference: "high-performance",
        preserveDrawingBuffer: false
      });
      if (!this.gl) throw new Error("WebGL2 is unavailable");
      this.currentTheme = "sol";
      this.targetTheme = "sol";
      this.fromTheme = "sol";
      this.themeMorph = 1;
      this.transition = null;
      this.motion = true;
      this.enabled = true;
      this.intensity = 0.78;
      this.brightness = 1.00;
      this.planetScaleUser = 1.00;
      this.particleStrength = 1.00;
      this.glowStrength = 1.48;
      this.orbitDensity = 1.25;
      this.particleSpeed = 1.0;
      this.planetOffset = { x: 0, y: 0 };
      this.transitionDuration = 3400;
      this.pendingTheme = null;
      this.qualityMode = "auto";
      this.quality = this.detectInitialQuality();
      this.running = false;
      this.raf = 0;
      this.lastTime = performance.now();
      this.elapsed = 0;
      this.rotation = 0;
      this.mouseTarget = { x: 0, y: 0 };
      this.mouse = { x: 0, y: 0 };
      this.cameraDistance = PRESETS.sol.cameraDistance;
      this.objectPosition = [...PRESETS.sol.objectPosition];
      this.projection = new Float32Array(16);
      this.view = new Float32Array(16);
      this.cameraPosition = [0, 0, this.cameraDistance];
      this.frameSamples = [];
      this.performanceLocked = false;
      this.resizeTimer = 0;
      this.onResize = () => {
        clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => this.resize(), 100);
      };
      this.onVisibility = () => {
        if (document.hidden) this.stop();
        else if (this.enabled && this.motion) this.start();
        else this.renderOnce();
      };
      this.onPointer = (event) => {
        if (!this.motion) return;
        this.mouseTarget.x = clamp((event.clientX / Math.max(1, innerWidth) - 0.5) * 2, -1, 1);
        this.mouseTarget.y = clamp((event.clientY / Math.max(1, innerHeight) - 0.5) * 2, -1, 1);
      };
      this.initGL();
      this.resize();
      addEventListener("resize", this.onResize, { passive: true });
      addEventListener("pointermove", this.onPointer, { passive: true });
      document.addEventListener("visibilitychange", this.onVisibility, { passive: true });
      this.start();
    }

    detectInitialQuality() {
      const cores = navigator.hardwareConcurrency || 4;
      const pixels = innerWidth * innerHeight * Math.min(devicePixelRatio || 1, 2);
      if (cores >= 8 && pixels < 5_000_000 && innerWidth >= 1100) return "high";
      if (cores >= 4 && pixels < 8_000_000) return "medium";
      return "low";
    }

    initGL() {
      const gl = this.gl;
      this.programStars = createProgram(gl, VERTEX_STARS, FRAGMENT_POINT);
      this.programBody = createProgram(gl, VERTEX_BODY, FRAGMENT_BODY);
      this.programCelestial = createProgram(gl, VERTEX_CELESTIAL, FRAGMENT_CELESTIAL);
      this.programOrbits = createProgram(gl, VERTEX_ORBITS, FRAGMENT_POINT);

      const body = generateBodyMesh();
      const sphere = generateSphere(QUALITY.high.sphere);
      const stars = generateStars(QUALITY.high.stars);
      const orbits = generateOrbits(QUALITY.high.orbit);
      this.bodyData = {
        positions: createBuffer(gl, body.positions, 3),
        indices: gl.createBuffer(),
        count: body.indices.length
      };
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bodyData.indices);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, body.indices, gl.STATIC_DRAW);
      this.sphereData = {
        positions: createBuffer(gl, sphere.positions, 3),
        seeds: createBuffer(gl, sphere.seeds, 1),
        land: createBuffer(gl, sphere.land, 1),
        crater: createBuffer(gl, sphere.crater, 1)
      };
      this.starData = {
        positions: createBuffer(gl, stars.positions, 3),
        seeds: createBuffer(gl, stars.seeds, 1)
      };
      this.orbitData = {
        t: createBuffer(gl, orbits.t, 1),
        params: createBuffer(gl, orbits.params, 4)
      };

      this.uStars = uniformLocations(gl, this.programStars, ["uProjection","uView","uTime","uWarp","uDpr","uIntensity","uParticleSpeed","uColorA","uColorB"]);
      this.uBody = uniformLocations(gl, this.programBody, ["uProjection","uView","uObjectPosition","uObjectScale","uRotationY","uRotationX","uTime","uFromTheme","uToTheme","uMorph","uIntensity"]);
      this.uCelestial = uniformLocations(gl, this.programCelestial, ["uProjection","uView","uObjectPosition","uObjectScale","uRotationY","uRotationX","uTime","uDpr","uFromTheme","uToTheme","uMorph","uHaloPass","uIntensity","uCameraPosition"]);
      this.uOrbits = uniformLocations(gl, this.programOrbits, ["uProjection","uView","uObjectPosition","uObjectScale","uRotationY","uTime","uDpr","uFromTheme","uToTheme","uMorph","uTransitionEnergy","uParticleStrength","uGlowStrength","uRingPass","uParticleSpeed"]);

      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
    }

    setEnabled(enabled) {
      this.enabled = Boolean(enabled);
      this.canvas.style.display = this.enabled ? "block" : "none";
      if (!this.enabled) this.stop();
      else if (this.motion) this.start();
      else this.renderOnce();
    }

    setMotion(enabled) {
      this.motion = Boolean(enabled);
      if (this.motion && this.enabled && !document.hidden) this.start();
      else {
        this.stop();
        this.renderOnce();
      }
    }

    setIntensity(value) {
      this.intensity = clamp(Number(value) || 0.78, 0.25, 1.0);
      this.renderOnce();
    }

    setBrightness(value) {
      this.brightness = clamp(Number(value) || 1.0, 0.55, 1.55);
      const b = 0.82 + this.brightness * 0.68;
      const s = 0.96 + this.brightness * 0.16;
      this.canvas.style.filter = "brightness(" + b + ") saturate(" + s + ")";
      this.renderOnce();
    }

    setPlanetSize(value) {
      this.planetScaleUser = clamp(Number(value) || 1.0, 0.70, 1.45);
      this.renderOnce();
    }

    setParticleStrength(value) {
      this.particleStrength = clamp(Number(value) || 1.0, 0.40, 1.90);
      this.renderOnce();
    }

    setGlowStrength(value) {
      this.glowStrength = clamp(Number(value) || 1.48, 0.40, 2.20);
      this.renderOnce();
    }

    setOrbitDensity(value) {
      this.orbitDensity = clamp(Number(value) || 1.25, 0.35, 1.80);
      this.renderOnce();
    }

    setParticleSpeed(value) {
      this.particleSpeed = clamp(Number(value) || 1.0, 0.40, 1.80);
      this.renderOnce();
    }

    setPlanetPosition(x, y) {
      this.planetOffset.x = clamp(Number(x) || 0, -1, 1);
      this.planetOffset.y = clamp(Number(y) || 0, -1, 1);
      this.renderOnce();
    }

    setTransitionDuration(value) {
      this.transitionDuration = clamp(Number(value) || 3400, 1800, 5200);
    }

    setQuality(mode) {
      this.qualityMode = ["auto", "high", "medium", "low"].includes(mode) ? mode : "auto";
      this.quality = this.qualityMode === "auto" ? this.detectInitialQuality() : this.qualityMode;
      this.performanceLocked = this.qualityMode !== "auto";
      this.resize();
      this.renderOnce();
    }

    setTheme(theme, immediate = false) {
      if (!(theme in THEME_INDEX)) return;
      if (immediate || !this.motion) {
        this.currentTheme = theme;
        this.targetTheme = theme;
        this.fromTheme = theme;
        this.themeMorph = 1;
        this.transition = null;
        this.pendingTheme = null;
        this.cameraDistance = PRESETS[theme].cameraDistance;
        this.objectPosition = [...PRESETS[theme].objectPosition];
        this.renderOnce();
        return;
      }
      if (this.transition) {
        this.pendingTheme = theme === this.transition.to ? null : theme;
        return;
      }
      if (theme === this.currentTheme) return;
      this.fromTheme = this.currentTheme;
      this.targetTheme = theme;
      this.transition = {
        start: performance.now(),
        duration: this.transitionDuration,
        from: this.currentTheme,
        to: theme,
        startRotation: this.rotation
      };
      this.start();
    }

    setPointer(x, y) {
      this.mouseTarget.x = clamp(x, -1, 1);
      this.mouseTarget.y = clamp(y, -1, 1);
    }

    resize() {
      const q = QUALITY[this.quality];
      const dpr = Math.min(devicePixelRatio || 1, q.dpr);
      const width = Math.max(1, Math.floor(innerWidth * dpr));
      const height = Math.max(1, Math.floor(innerHeight * dpr));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.canvas.style.width = `${innerWidth}px`;
        this.canvas.style.height = `${innerHeight}px`;
      }
      this.dpr = dpr;
      this.gl.viewport(0, 0, width, height);
      perspective(this.projection, Math.PI / 3.15, width / height, 0.1, 80);
    }

    start() {
      if (this.running || !this.enabled || document.hidden) return;
      this.running = true;
      this.lastTime = performance.now();
      const tick = (now) => {
        if (!this.running) return;
        const dt = clamp((now - this.lastTime) / 1000, 0, 0.05);
        this.lastTime = now;
        this.update(dt, now);
        this.draw();
        this.monitorPerformance(dt);
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }

    stop() {
      this.running = false;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
    }

    renderOnce() {
      if (!this.enabled) return;
      this.update(0, performance.now());
      this.draw();
    }

    update(dt, now) {
      if (this.motion) {
        this.elapsed += dt;
        this.mouse.x = damp(this.mouse.x, this.mouseTarget.x, 3.2, dt);
        this.mouse.y = damp(this.mouse.y, this.mouseTarget.y, 3.2, dt);
      } else {
        this.mouse.x = this.mouse.y = 0;
      }

      let travel = 0;
      let morph = 1;
      let from = this.currentTheme;
      let to = this.currentTheme;
      let raw = 0;
      let queuedAfterFinish = null;

      if (this.transition) {
        raw = clamp((now - this.transition.start) / this.transition.duration, 0, 1);
        const eased = easeInOut(raw);
        travel = Math.pow(Math.sin(Math.PI * eased), 0.84);
        morph = easeInOut(clamp((raw - 0.22) / 0.56, 0, 1));
        from = this.transition.from;
        to = this.transition.to;
        if (raw >= 1) {
          this.currentTheme = this.transition.to;
          this.fromTheme = this.currentTheme;
          this.targetTheme = this.currentTheme;
          this.themeMorph = 1;
          this.transition = null;
          queuedAfterFinish = this.pendingTheme;
          this.pendingTheme = null;
          from = to = this.currentTheme;
          travel = 0;
          morph = 1;
          raw = 0;
        }
      }

      this.fromTheme = from;
      this.themeMorph = morph;
      const fromPreset = PRESETS[from];
      const toPreset = PRESETS[to];
      const positionMorph = easeInOut(clamp((raw - 0.12) / 0.76, 0, 1));
      const baseDistance = lerp(fromPreset.cameraDistance, toPreset.cameraDistance, morph);
      const themeDelta = THEME_INDEX[to] - THEME_INDEX[from];

      this.cameraDistance = baseDistance + travel * (5.15 + Math.abs(themeDelta) * 0.38);
      this.objectPosition[0] = lerp(fromPreset.objectPosition[0], toPreset.objectPosition[0], positionMorph) + this.planetOffset.x * 1.18;
      this.objectPosition[1] = lerp(fromPreset.objectPosition[1], toPreset.objectPosition[1], positionMorph) + this.planetOffset.y * 0.78;
      this.objectPosition[2] = -travel * 0.22;

      const rotationSpeed = lerp(fromPreset.rotationSpeed, toPreset.rotationSpeed, morph);
      if (this.motion) this.rotation += rotationSpeed * dt;
      this.travelEnergy = travel;
      this.objectScale = this.planetScaleUser * (1 - travel * 0.54);

      const direction = Math.sign(themeDelta) || 1;
      const cameraArc = Math.sin(Math.PI * easeInOut(raw));
      const pathX = cameraArc * 0.22 * direction;
      const pathY = cameraArc * (0.075 + Math.abs(themeDelta) * 0.018) + Math.sin(raw * Math.PI * 2) * 0.014;
      this.cameraPosition[0] = this.mouse.x * 0.05 + pathX;
      this.cameraPosition[1] = -this.mouse.y * 0.035 + pathY + Math.sin(this.elapsed * 0.12) * 0.008;
      this.cameraPosition[2] = this.cameraDistance;
      const target = [this.objectPosition[0] * 0.13 + pathX * 0.06, this.objectPosition[1] * 0.13 + pathY * 0.08, this.objectPosition[2]];
      lookAt(this.view, this.cameraPosition, target, [0, 1, 0]);

      if (queuedAfterFinish && queuedAfterFinish !== this.currentTheme) {
        this.fromTheme = this.currentTheme;
        this.targetTheme = queuedAfterFinish;
        this.transition = {
          start: now + 90,
          duration: this.transitionDuration,
          from: this.currentTheme,
          to: queuedAfterFinish,
          startRotation: this.rotation
        };
      }
    }

    monitorPerformance(dt) {
      if (this.performanceLocked || !this.motion || dt <= 0) return;
      this.frameSamples.push(dt * 1000);
      if (this.frameSamples.length < 120) return;
      const average = this.frameSamples.reduce((a, b) => a + b, 0) / this.frameSamples.length;
      this.frameSamples.length = 0;
      if (average > 29 && this.quality === "high") {
        this.quality = "medium";
        this.resize();
      } else if (average > 37 && this.quality === "medium") {
        this.quality = "low";
        this.resize();
      }
    }

    themeColors() {
      const from = PRESETS[this.fromTheme];
      const to = PRESETS[this.targetTheme];
      const t = this.themeMorph;
      const brightnessBias = 0.88 + this.brightness * 0.18;
      return {
        starA: from.starA.map((v, i) => lerp(v, to.starA[i], t) * brightnessBias),
        starB: from.starB.map((v, i) => lerp(v, to.starB[i], t) * brightnessBias),
        backdrop: from.backdrop.map((v, i) => lerp(v, to.backdrop[i], t) * (0.82 + this.brightness * 0.22))
      };
    }

    draw() {
      const gl = this.gl;
      const q = QUALITY[this.quality];
      const colors = this.themeColors();
      const solRefinement = lerp(
        this.fromTheme === "sol" ? 0.78 : 1.0,
        this.targetTheme === "sol" ? 0.78 : 1.0,
        this.themeMorph
      );
      gl.clearColor(colors.backdrop[0], colors.backdrop[1], colors.backdrop[2], 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // Deep stars.
      gl.useProgram(this.programStars);
      bindAttribute(gl, this.programStars, "aPosition", this.starData.positions);
      bindAttribute(gl, this.programStars, "aSeed", this.starData.seeds);
      gl.uniformMatrix4fv(this.uStars.uProjection, false, this.projection);
      gl.uniformMatrix4fv(this.uStars.uView, false, this.view);
      gl.uniform1f(this.uStars.uTime, this.elapsed);
      gl.uniform1f(this.uStars.uWarp, this.travelEnergy * 1.15);
      gl.uniform1f(this.uStars.uDpr, this.dpr);
      gl.uniform1f(this.uStars.uIntensity, this.intensity * (0.58 + this.particleStrength * 0.72));
      gl.uniform1f(this.uStars.uParticleSpeed, this.particleSpeed);
      gl.uniform3fv(this.uStars.uColorA, colors.starA);
      gl.uniform3fv(this.uStars.uColorB, colors.starB);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.drawArrays(gl.POINTS, 0, Math.min(QUALITY.high.stars, Math.floor(q.stars * (0.75 + this.particleStrength * 0.55))));

      // Solid procedural body beneath the particle skin.
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.useProgram(this.programBody);
      bindAttribute(gl, this.programBody, "aPosition", this.bodyData.positions);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bodyData.indices);
      gl.uniformMatrix4fv(this.uBody.uProjection, false, this.projection);
      gl.uniformMatrix4fv(this.uBody.uView, false, this.view);
      gl.uniform3fv(this.uBody.uObjectPosition, this.objectPosition);
      gl.uniform1f(this.uBody.uObjectScale, this.objectScale);
      gl.uniform1f(this.uBody.uRotationY, this.rotation);
      gl.uniform1f(this.uBody.uRotationX, -0.08 + this.mouse.y * 0.025);
      gl.uniform1f(this.uBody.uTime, this.elapsed);
      gl.uniform1i(this.uBody.uFromTheme, THEME_INDEX[this.fromTheme]);
      gl.uniform1i(this.uBody.uToTheme, THEME_INDEX[this.targetTheme]);
      gl.uniform1f(this.uBody.uMorph, this.themeMorph);
      gl.uniform1f(this.uBody.uIntensity, this.intensity * (0.94 + this.glowStrength * 0.05));
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawElements(gl.TRIANGLES, this.bodyData.count, gl.UNSIGNED_INT, 0);

      // Celestial point surface.
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.useProgram(this.programCelestial);
      bindAttribute(gl, this.programCelestial, "aPosition", this.sphereData.positions);
      bindAttribute(gl, this.programCelestial, "aSeed", this.sphereData.seeds);
      bindAttribute(gl, this.programCelestial, "aLand", this.sphereData.land);
      bindAttribute(gl, this.programCelestial, "aCrater", this.sphereData.crater);
      gl.uniformMatrix4fv(this.uCelestial.uProjection, false, this.projection);
      gl.uniformMatrix4fv(this.uCelestial.uView, false, this.view);
      gl.uniform3fv(this.uCelestial.uObjectPosition, this.objectPosition);
      gl.uniform1f(this.uCelestial.uObjectScale, this.objectScale);
      gl.uniform1f(this.uCelestial.uRotationY, this.rotation);
      gl.uniform1f(this.uCelestial.uRotationX, -0.08 + this.mouse.y * 0.025);
      gl.uniform1f(this.uCelestial.uTime, this.elapsed);
      gl.uniform1f(this.uCelestial.uDpr, this.dpr);
      gl.uniform1i(this.uCelestial.uFromTheme, THEME_INDEX[this.fromTheme]);
      gl.uniform1i(this.uCelestial.uToTheme, THEME_INDEX[this.targetTheme]);
      gl.uniform1f(this.uCelestial.uMorph, this.themeMorph);
      gl.uniform1f(this.uCelestial.uHaloPass, 0);
      gl.uniform1f(
        this.uCelestial.uIntensity,
        this.intensity * solRefinement * (0.78 + this.brightness * 0.20 + this.particleStrength * 0.08)
      );
      gl.uniform3fv(this.uCelestial.uCameraPosition, this.cameraPosition);
      const additiveSurface = this.fromTheme === "sol" || this.targetTheme === "sol";
      gl.blendFunc(gl.SRC_ALPHA, additiveSurface ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(
        gl.POINTS,
        0,
        Math.min(
          QUALITY.high.sphere,
          Math.floor(q.sphere * (0.82 + this.particleStrength * 0.18) * (0.93 + solRefinement * 0.07))
        )
      );

      // Strong glowing orbit / magnetic-field particles, depth occluded by the body.
      gl.depthMask(false);
      gl.useProgram(this.programOrbits);
      bindAttribute(gl, this.programOrbits, "aT", this.orbitData.t);
      bindAttribute(gl, this.programOrbits, "aParams", this.orbitData.params);
      gl.uniformMatrix4fv(this.uOrbits.uProjection, false, this.projection);
      gl.uniformMatrix4fv(this.uOrbits.uView, false, this.view);
      gl.uniform3fv(this.uOrbits.uObjectPosition, this.objectPosition);
      gl.uniform1f(this.uOrbits.uObjectScale, this.objectScale);
      gl.uniform1f(this.uOrbits.uRotationY, this.rotation);
      gl.uniform1f(this.uOrbits.uTime, this.elapsed);
      gl.uniform1f(this.uOrbits.uDpr, this.dpr);
      gl.uniform1i(this.uOrbits.uFromTheme, THEME_INDEX[this.fromTheme]);
      gl.uniform1i(this.uOrbits.uToTheme, THEME_INDEX[this.targetTheme]);
      gl.uniform1f(this.uOrbits.uMorph, this.themeMorph);
      gl.uniform1f(this.uOrbits.uTransitionEnergy, this.travelEnergy + this.particleStrength * 0.16);
      gl.uniform1f(this.uOrbits.uParticleStrength, this.particleStrength * solRefinement);
      gl.uniform1f(this.uOrbits.uGlowStrength, this.glowStrength * solRefinement);
      gl.uniform1f(this.uOrbits.uParticleSpeed, this.particleSpeed);
      const orbitCount = Math.min(
        QUALITY.high.orbit,
        Math.floor(q.orbit * Math.min(1, this.orbitDensity) * (0.78 + this.particleStrength * 0.32) * (0.88 + solRefinement * 0.12))
      );
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.uniform1f(this.uOrbits.uRingPass, 2);
      gl.drawArrays(gl.POINTS, 0, orbitCount);
      gl.uniform1f(this.uOrbits.uRingPass, 1);
      gl.drawArrays(gl.POINTS, 0, orbitCount);
      gl.uniform1f(this.uOrbits.uRingPass, 0);
      gl.drawArrays(gl.POINTS, 0, orbitCount);

      // Atmospheric / corona point shell.
      gl.useProgram(this.programCelestial);
      bindAttribute(gl, this.programCelestial, "aPosition", this.sphereData.positions);
      bindAttribute(gl, this.programCelestial, "aSeed", this.sphereData.seeds);
      bindAttribute(gl, this.programCelestial, "aLand", this.sphereData.land);
      bindAttribute(gl, this.programCelestial, "aCrater", this.sphereData.crater);
      gl.uniformMatrix4fv(this.uCelestial.uProjection, false, this.projection);
      gl.uniformMatrix4fv(this.uCelestial.uView, false, this.view);
      gl.uniform3fv(this.uCelestial.uObjectPosition, this.objectPosition);
      gl.uniform1f(this.uCelestial.uObjectScale, this.objectScale);
      gl.uniform1f(this.uCelestial.uRotationY, this.rotation);
      gl.uniform1f(this.uCelestial.uRotationX, -0.08 + this.mouse.y * 0.025);
      gl.uniform1f(this.uCelestial.uTime, this.elapsed);
      gl.uniform1f(this.uCelestial.uDpr, this.dpr);
      gl.uniform1i(this.uCelestial.uFromTheme, THEME_INDEX[this.fromTheme]);
      gl.uniform1i(this.uCelestial.uToTheme, THEME_INDEX[this.targetTheme]);
      gl.uniform1f(this.uCelestial.uMorph, this.themeMorph);
      gl.uniform3fv(this.uCelestial.uCameraPosition, this.cameraPosition);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      const haloCount = Math.min(QUALITY.high.sphere, Math.floor(q.sphere * Math.min(1, 0.54 + this.particleStrength * 0.34)));
      gl.uniform1f(this.uCelestial.uHaloPass, 2);
      gl.uniform1f(this.uCelestial.uIntensity, this.intensity * this.glowStrength * solRefinement * (0.21 + this.brightness * 0.12));
      gl.drawArrays(gl.POINTS, 0, haloCount);
      gl.uniform1f(this.uCelestial.uHaloPass, 1);
      gl.uniform1f(
        this.uCelestial.uIntensity,
        this.intensity * solRefinement * (0.78 + this.glowStrength * 0.34 + this.particleStrength * 0.13) * (0.88 + this.brightness * 0.16)
      );
      gl.drawArrays(gl.POINTS, 0, haloCount);

      gl.depthMask(true);
    }

    destroy() {
      this.stop();
      removeEventListener("resize", this.onResize);
      removeEventListener("pointermove", this.onPointer);
      document.removeEventListener("visibilitychange", this.onVisibility);
      const gl = this.gl;
      for (const group of [this.sphereData, this.starData, this.orbitData]) {
        for (const descriptor of Object.values(group || {})) gl.deleteBuffer(descriptor.buffer);
      }
      gl.deleteBuffer(this.bodyData.positions.buffer);
      gl.deleteBuffer(this.bodyData.indices);
      gl.deleteProgram(this.programStars);
      gl.deleteProgram(this.programBody);
      gl.deleteProgram(this.programCelestial);
      gl.deleteProgram(this.programOrbits);
    }
  }

  globalThis.STLCosmicRenderer = CosmicRenderer;
})();
