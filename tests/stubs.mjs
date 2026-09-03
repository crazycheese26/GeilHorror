// Just enough Three.js, canvas and DOM for the simulation modules to run in
// node. The game never touches the renderer from map/player/enemy/items — it
// only builds meshes it then ignores — so a stub that swallows construction is
// enough to exercise the actual logic.

function makeVec() {
  const v = { x: 0, y: 0, z: 0, order: 'XYZ' };
  v.set = (x = 0, y = 0, z = 0) => { v.x = x; v.y = y; v.z = z; return v; };
  v.setScalar = s => v.set(s, s, s);
  v.copy = o => v.set(o.x, o.y, o.z);
  return v;
}

function makeColor() {
  const c = { r: 1, g: 1, b: 1, hex: 0xffffff };
  c.setHex = h => { c.hex = h; return c; };
  c.getHex = () => c.hex;
  c.setRGB = (r, g, b) => { c.r = r; c.g = g; c.b = b; return c; };
  c.setStyle = () => c;
  return c;
}

class StubObject {
  constructor(...args) {
    this.args = args;
    this.children = [];
    this.userData = {};

    this.position = makeVec();
    this.rotation = makeVec();
    this.scale = makeVec();
    this.repeat = makeVec();
    this.offset = makeVec();
    this.color = makeColor();

    this.visible = true;
    this.intensity = 0;
    this.distance = 0;
    this.opacity = 1;
    this.map = null;
    this.needsUpdate = false;
    this.castShadow = false;
    this.receiveShadow = false;
    this.renderOrder = 0;
    this.geometry = null;
    this.material = null;

    // Lights carry a shadow camera; the flashlight configures one.
    this.shadow = {
      mapSize: { width: 0, height: 0 },
      camera: { near: 0, far: 0 },
      bias: 0
    };

    // Options objects are passed straight into materials and textures.
    const opts = args.find(a => a && typeof a === 'object' && !Array.isArray(a) && !a.isStub);
    if (opts) Object.assign(this, opts);
    // Materials take colours as plain hex; the real ones expose a Color.
    if (typeof this.color === 'number') this.color = makeColor().setHex(this.color);

    // Mesh(geometry, material) and Sprite(material) hand both back on the
    // object, and the game reads them again when it disposes of something.
    const built = args.filter(a => (a && a.isStub) || Array.isArray(a));
    if (built.length >= 2) {
      this.geometry = built[0];
      this.material = built[1];
    } else if (built.length === 1) {
      this.material = built[0];
    }
    this.isStub = true;
  }

  add(...objs) { this.children.push(...objs); return this; }
  remove(...objs) {
    for (const o of objs) {
      const i = this.children.indexOf(o);
      if (i >= 0) this.children.splice(i, 1);
    }
    return this;
  }
  dispose() { this.disposed = true; }
  clone() { return new StubObject(); }
  lookAt() {}
  updateMatrixWorld() {}
  updateProjectionMatrix() {}
}

// Any THREE.Whatever resolves to the same stub class. Constants (DoubleSide,
// AdditiveBlending, …) come back as that class too, which is only ever used as
// an opaque value.
export const THREE = new Proxy({ Object3D: StubObject }, {
  get(target, key) {
    if (!(key in target)) target[key] = StubObject;
    return target[key];
  }
});

function makeContext() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      const fn = () => {
        if (key === 'createRadialGradient' || key === 'createLinearGradient') return gradient;
        if (key === 'getImageData') {
          return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
        }
        if (key === 'measureText') return { width: 8 };
        return undefined;
      };
      target[key] = fn;
      return fn;
    },
    set(target, key, value) { target[key] = value; return true; }
  });
}

function makeCanvas() {
  return {
    width: 0,
    height: 0,
    getContext: () => makeContext(),
    toDataURL: () => 'data:,',
    addEventListener() {},
    removeEventListener() {},
    requestPointerLock() {}
  };
}

export function installStubs() {
  globalThis.THREE = THREE;

  globalThis.document = {
    createElement: tag => (tag === 'canvas' ? makeCanvas() : { style: {}, appendChild() {} }),
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    pointerLockElement: null,
    body: { classList: { add() {}, remove() {}, toggle() {} }, dataset: {} }
  };

  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1
  };

  // The monster sketch never finishes loading here, which is the same path the
  // game takes when the PNG is missing.
  globalThis.Image = class {
    constructor() { this.src = ''; }
  };

  return { makeCanvas, StubObject };
}

export { makeCanvas, StubObject };
