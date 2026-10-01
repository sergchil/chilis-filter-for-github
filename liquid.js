// Slow liquid backdrop for the Liquid theme: chili red flowing through a dark or a warm light base.
(() => {
  const canvas = document.getElementById('liquid');
  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
  if (!gl) { canvas.classList.add('fallback'); return; }

  const PALETTES = {
    dark:  { base: [0.043, 0.043, 0.059], mid: [0.102, 0.047, 0.039], a: [0.788, 0.165, 0.071], b: [1.0, 0.302, 0.180], amount: 0.6 },
    light: { base: [0.984, 0.969, 0.957], mid: [0.965, 0.925, 0.902], a: [1.0, 0.741, 0.659], b: [1.0, 0.600, 0.490], amount: 0.7 },
  };

  const vert = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';
  const frag = `
    precision mediump float;
    uniform vec2 res;
    uniform float t;
    uniform vec2 mouse;
    uniform vec3 cBase, cMid, cA, cB;
    uniform float amount;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.02 + 3.1; a *= 0.5; }
      return v;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / res;
      vec2 p = (gl_FragCoord.xy - 0.5 * res) / min(res.x, res.y);
      p += (mouse - 0.5) * 0.08;

      // Domain warping gives the slow, viscous flow.
      vec2 q = vec2(fbm(p * 1.3 + t * 0.03), fbm(p * 1.3 - t * 0.025 + 5.2));
      vec2 r = vec2(fbm(p * 1.1 + 2.0 * q + vec2(1.7, 9.2) + t * 0.04), fbm(p * 1.1 + 2.0 * q + vec2(8.3, 2.8) - t * 0.035));
      float f = fbm(p + 2.2 * r);

      vec3 col = mix(cBase, cMid, smoothstep(0.25, 0.85, f));
      col = mix(col, cA, smoothstep(0.5, 0.92, r.x) * amount * smoothstep(1.3, 0.0, uv.y + 0.15));
      col = mix(col, cB, smoothstep(0.66, 0.98, r.x * r.y * 1.6) * amount);
      gl_FragColor = vec4(col, 1.0);
    }`;

  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, vert));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.classList.add('fallback'); return; }
  gl.useProgram(prog);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const u = (n) => gl.getUniformLocation(prog, n);
  const uRes = u('res'), uT = u('t'), uMouse = u('mouse');

  function setPalette(mode) {
    const pal = PALETTES[mode] || PALETTES.dark;
    gl.uniform3fv(u('cBase'), pal.base);
    gl.uniform3fv(u('cMid'), pal.mid);
    gl.uniform3fv(u('cA'), pal.a);
    gl.uniform3fv(u('cB'), pal.b);
    gl.uniform1f(u('amount'), pal.amount);
  }

  // Render at reduced resolution: the image is soft anyway and this keeps the GPU cool.
  const SCALE = 0.5;
  function resize() {
    canvas.width = Math.round(innerWidth * SCALE);
    canvas.height = Math.round(innerHeight * SCALE);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
  }

  const target = { x: 0.5, y: 0.5 }, mouse = { x: 0.5, y: 0.5 };
  addEventListener('pointermove', (e) => { target.x = e.clientX / innerWidth; target.y = 1 - e.clientY / innerHeight; });

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let running = false;
  let raf = 0;
  const start = performance.now();

  function draw(time) {
    mouse.x += (target.x - mouse.x) * 0.03;
    mouse.y += (target.y - mouse.y) * 0.03;
    gl.uniform1f(uT, time);
    gl.uniform2f(uMouse, mouse.x, mouse.y);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function frame(now) {
    if (!running) return;
    if (!document.hidden) draw(20 + (now - start) / 1000);
    raf = requestAnimationFrame(frame);
  }

  // Only the Liquid theme uses the canvas; other themes stop the loop entirely.
  function sync() {
    const on = document.documentElement.dataset.style === 'liquid';
    if (!on) { running = false; cancelAnimationFrame(raf); return; }
    setPalette(document.documentElement.dataset.mode);
    resize();
    if (still) { draw(20); }
    else if (!running) { running = true; raf = requestAnimationFrame(frame); }
    requestAnimationFrame(() => canvas.classList.add('ready'));
  }

  addEventListener('resize', () => { if (document.documentElement.dataset.style === 'liquid') { resize(); if (still) draw(20); } });
  addEventListener('ghx-theme', sync);
  sync();
})();
