import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS, FACE_INFO, MOVE_INFO, parseMove, rotateVector } from './cube-state.mjs';
import { TurnMotion, dragSnap } from './turn-motion.mjs';
import { FrameStats } from './frame-stats.mjs';

const zAxis = new THREE.Vector3(0, 0, 1);
const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), zAxis];

export class CubeView {
  constructor(container, onTurn, canTurn, onInteractionChange = () => {}) {
    this.container = container;
    this.onTurn = onTurn;
    this.canTurn = canTurn;
    this.onInteractionChange = onInteractionChange;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, .1, 100);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.setAttribute('aria-label', '可旋转的三阶魔方');
    this.renderer.domElement.setAttribute('role', 'img');
    container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, .04);
    this.scene.environment = this.environment.texture;
    room.dispose(); pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8c9a73, 1.2));
    const key = new THREE.DirectionalLight(0xfffcf2, 2);
    key.position.set(-3, 8, 6);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdceffb, .9); fill.position.set(5, 2, -5); this.scene.add(fill);

    const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 128;
    const ctx = shadowCanvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 5, 64, 64, 63);
    gradient.addColorStop(0, 'rgba(65,85,52,0.19)'); gradient.addColorStop(.45, 'rgba(65,85,52,0.09)'); gradient.addColorStop(1, 'rgba(65,85,52,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(7, 5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }));
    contact.rotation.x = -Math.PI / 2; contact.position.y = -2.12; this.scene.add(contact);

    this.root = new THREE.Group(); this.scene.add(this.root);
    const paint = (geometry, color) => {
      const rgb = new THREE.Color(color);
      const colors = new Float32Array(geometry.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) { colors[i] = rgb.r; colors[i + 1] = rgb.g; colors[i + 2] = rgb.b; }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); return geometry;
    };
    this.bodyGeometry = paint(new RoundedBoxGeometry(.965, .965, .965, 2, .066), '#171e1e');
    this.cubieMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .35, metalness: .02, envMapIntensity: .45 });
    const shape = new THREE.Shape(); const h = .406, r = .065;
    shape.moveTo(-h + r, -h); shape.lineTo(h - r, -h); shape.quadraticCurveTo(h, -h, h, -h + r);
    shape.lineTo(h, h - r); shape.quadraticCurveTo(h, h, h - r, h); shape.lineTo(-h + r, h);
    shape.quadraticCurveTo(-h, h, -h, h - r); shape.lineTo(-h, -h + r); shape.quadraticCurveTo(-h, -h, -h + r, -h);
    this.stickerGeometry = new THREE.ExtrudeGeometry(shape, { depth: .012, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .009, bevelThickness: .009, curveSegments: 4 });
    this.faceGeometries = Object.fromEntries(Object.entries(FACE_INFO).map(([face, info]) => {
      const normal = new THREE.Vector3(...info.normal);
      const rotation = new THREE.Quaternion().setFromUnitVectors(zAxis, normal);
      const geometry = paint(this.stickerGeometry.clone(), COLORS[face]);
      geometry.applyQuaternion(rotation); geometry.translate(...normal.multiplyScalar(.488).toArray());
      return [face, geometry];
    }));
    this.labels = Object.fromEntries(Object.keys(COLORS).map(face => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
      const c = canvas.getContext('2d'); c.font = '500 64px Segoe UI, sans-serif'; c.fillStyle = face === 'U' || face === 'D' ? '#626b604d' : '#ffffff66';
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(face, 64, 66);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      return [face, new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })];
    }));
    this.labelGeometry = new THREE.PlaneGeometry(.42, .42);
    this.build();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = .09; this.controls.enablePan = false;
    this.controls.minDistance = 7; this.controls.maxDistance = 15;
    this.controls.minPolarAngle = .12; this.controls.maxPolarAngle = Math.PI - .12;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    this.resetView();
    this.installDrag();
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container); this.resize();
    this.frameStats = new URLSearchParams(location.search).has('stats') ? new FrameStats(container, this.renderer) : null;
    this.loop = this.loop.bind(this); this.renderer.setAnimationLoop(this.loop);
  }

  build() {
    this.needsRender = true;
    this.cubies?.forEach(cubie => cubie.userData.mesh.geometry.dispose());
    this.root.clear(); this.cubies = []; this.stickers = [];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      if (x === 0 && y === 0 && z === 0) continue;
      const cubie = new THREE.Group(); cubie.position.set(x, y, z); cubie.userData.grid = [x, y, z];
      const parts = [this.bodyGeometry];
      for (const [face, info] of Object.entries(FACE_INFO)) {
        if ([x, y, z][info.axis] !== info.layer) continue;
        const normal = new THREE.Vector3(...info.normal);
        parts.push(this.faceGeometries[face]);
        // Invisible pick surfaces share the rendered sticker positions. Each
        // cubie's visible plastic and stickers are batched into one draw call.
        const sticker = new THREE.Mesh(this.stickerGeometry, this.cubieMaterial);
        sticker.visible = false;
        sticker.quaternion.setFromUnitVectors(zAxis, normal); sticker.position.copy(normal).multiplyScalar(.488);
        sticker.userData = { cubie, normal, face }; cubie.add(sticker); this.stickers.push(sticker);
        if ([x, y, z].filter(n => n !== 0).length === 1) {
          const label = new THREE.Mesh(this.labelGeometry, this.labels[face]);
          label.position.copy(normal).multiplyScalar(.513); label.quaternion.copy(sticker.quaternion); cubie.add(label);
        }
      }
      const mesh = new THREE.Mesh(mergeGeometries(parts), this.cubieMaterial);
      cubie.add(mesh); cubie.userData.mesh = mesh;
      this.root.add(cubie); this.cubies.push(cubie);
    }
  }

  resetView() { this.camera.position.set(6.7, 5.5, 8); this.controls.target.set(0, -.1, 0); this.controls.update(); this.needsRender = true; }
  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    this.camera.aspect = width / Math.max(1, height);
    this.camera.fov = width < 430 ? 41 : 34;
    this.camera.updateProjectionMatrix(); this.renderer.setSize(width, height, false);
    this.needsRender = true;
  }
  reset() { if (this.animation) throw new Error('不能在转动中重置'); this.build(); }

  get isInteracting() { return Boolean(this.dragging || this.animation); }

  makeLayer(axis, layer) {
    const group = new THREE.Group(); this.root.add(group); this.root.updateMatrixWorld(true);
    const members = this.cubies.filter(c => c.userData.grid[axis] === layer);
    members.forEach(c => group.attach(c));
    return { group, members, axis, layer, angle: 0, targetAngle: 0 };
  }

  settle(layer, quarter, duration, resolve) {
    const target = quarter * Math.PI / 2;
    const remaining = target - layer.angle;
    const initialSlope = Math.abs(remaining) < .00001 ? 0 : (layer.velocity || 0) * duration / remaining;
    this.animation = { ...layer, quarter, fromAngle: layer.angle, angle: target,
      motion: new TurnMotion(duration, null, initialSlope), resolve };
    this.preview = null;
  }

  turn(move, duration = 900) {
    if (this.animation) return Promise.reject(new Error('转动尚未结束'));
    const { axis, layer, quarter } = parseMove(move);
    const moving = this.preview || this.makeLayer(axis, layer);
    const remaining = Math.abs(quarter * Math.PI / 2 - moving.angle) / (Math.PI / 2);
    const settleDuration = this.preview ? Math.max(100, Math.min(duration, 520) * remaining * .65) : duration;
    return new Promise(resolve => this.settle(moving, quarter, settleDuration, resolve));
  }

  loop(now) {
    const frameStart = performance.now();
    const dt = Math.min(50, Math.max(0, now - (this.lastFrameTime ?? now)));
    this.lastFrameTime = now;
    if (this.preview && this.dragging) {
      const previousAngle = this.preview.angle;
      this.preview.angle += (this.preview.targetAngle - this.preview.angle) * (1 - Math.exp(-dt / 28));
      this.preview.velocity = dt > 0 ? (this.preview.angle - previousAngle) / dt : 0;
      this.preview.group.quaternion.setFromAxisAngle(axes[this.preview.axis], this.preview.angle);
    }
    const animation = this.animation;
    if (animation) {
      const { eased, done } = animation.motion.advance(now);
      const renderedAngle = animation.fromAngle + (animation.angle - animation.fromAngle) * eased;
      this.frameStats?.trace(animation, now, renderedAngle, done);
      animation.group.quaternion.setFromAxisAngle(axes[animation.axis], renderedAngle);
      if (done) {
        animation.group.updateMatrixWorld(true);
        for (const cubie of animation.members) {
          this.root.attach(cubie);
          cubie.userData.grid = rotateVector(cubie.userData.grid, animation.axis, animation.quarter);
          cubie.position.set(...cubie.userData.grid);
          // Snap the orientation to an exact signed permutation matrix after each quarter turn.
          const rotation = new THREE.Matrix4().makeRotationFromQuaternion(cubie.quaternion);
          [0, 1, 2, 4, 5, 6, 8, 9, 10].forEach(i => { rotation.elements[i] = Math.round(rotation.elements[i]); });
          cubie.quaternion.setFromRotationMatrix(rotation).normalize();
        }
        this.root.remove(animation.group); this.animation = null; animation.resolve();
      }
    }
    const cameraChanged = this.controls.update();
    if (animation || this.preview || cameraChanged || this.needsRender) {
      this.renderer.render(this.scene, this.camera);
      this.afterRender?.();
      this.needsRender = false;
    }
    this.frameStats?.sample(now, performance.now() - frameStart, Boolean(animation || this.preview));
  }

  installDrag() {
    const canvas = this.renderer.domElement;
    const raycaster = new THREE.Raycaster(); let drag = null;
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary) return;
      const rect = canvas.getBoundingClientRect();
      const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      this.scene.updateMatrixWorld(true); raycaster.setFromCamera(pointer, this.camera);
      const hit = raycaster.intersectObjects(this.stickers, false)[0]; if (!hit) return;
      // A new gesture on a moving layer must not fall through to OrbitControls
      // and unexpectedly rotate the camera instead.
      if (!this.canTurn()) { event.stopImmediatePropagation(); return; }
      const { cubie, normal } = hit.object.userData;
      const worldNormal = normal.clone().applyQuaternion(cubie.quaternion).round();
      const candidates = axes.flatMap((axis, i) => {
        const layer = cubie.userData.grid[i];
        if (Math.abs(worldNormal.dot(axis)) > .5) return [];
        const tangent = new THREE.Vector3().crossVectors(axis, hit.point);
        const p0 = hit.point.clone().project(this.camera), p1 = hit.point.clone().addScaledVector(tangent, .01).project(this.camera);
        const screen = new THREE.Vector2((p1.x - p0.x) * rect.width / .02, -(p1.y - p0.y) * rect.height / .02);
        const face = Object.keys(MOVE_INFO).find(f => MOVE_INFO[f].axis === i && MOVE_INFO[f].layer === layer);
        return screen.lengthSq() < 1 ? [] : [{ face, axis: i, layer, screen }];
      });
      if (!candidates.length) return;
      drag = { x: event.clientX, y: event.clientY, id: event.pointerId, candidates, choice: null };
      this.dragging = true; this.onInteractionChange();
      this.controls.enabled = false; canvas.setPointerCapture(event.pointerId); event.stopImmediatePropagation();
    }, true);
    canvas.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const delta = new THREE.Vector2(event.clientX - drag.x, event.clientY - drag.y);
      if (!drag.choice) {
        if (delta.length() < 6) return;
        const direction = delta.clone().normalize();
        const alignment = choice => Math.abs(choice.screen.clone().normalize().dot(direction));
        drag.choice = [...drag.candidates].sort((a, b) => alignment(b) - alignment(a))[0];
        if (alignment(drag.choice) < .45) { drag.choice = null; return; }
        this.preview = this.makeLayer(drag.choice.axis, drag.choice.layer);
      }
      const angle = delta.dot(drag.choice.screen) / drag.choice.screen.lengthSq();
      this.preview.targetAngle = THREE.MathUtils.clamp(angle, -Math.PI / 2, Math.PI / 2);
    });
    const release = event => {
      if (!drag || event.pointerId !== drag.id) return;
      const choice = drag.choice;
      drag = null; this.dragging = false; this.controls.enabled = true;
      if (!this.preview) { this.onInteractionChange(); return; }
      const target = dragSnap(this.preview.targetAngle, event.type !== 'pointerup');
      if (target === 0) {
        this.settle(this.preview, 0, 220, this.onInteractionChange);
        this.onInteractionChange();
      } else {
        const clockwise = Math.sign(target) === Math.sign(parseMove(choice.face).quarter);
        this.onTurn(choice.face + (clockwise ? '' : "'"));
      }
    };
    canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release); canvas.addEventListener('lostpointercapture', release);
    canvas.addEventListener('contextmenu', event => event.preventDefault());
  }
}
