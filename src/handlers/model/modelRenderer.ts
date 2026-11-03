/** App-owned Three.js scene construction (Step 07g T3/D4).
 *
 * The main window never imports a format loader. It receives validated
 * arrays, builds BufferGeometry itself, and uses only app-owned materials.
 * Textures are leased PNGs loaded through an Image element, never a
 * Three.js FileLoader. */
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Texture,
  WebGLRenderer,
  type Material,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SafeSceneData, SceneMaterial } from "../../services/specialViews";
import type { Bounds, Vec3 } from "./modelCamera";

export interface RendererBundle {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  resize: (width: number, height: number) => void;
  dispose: () => void;
}

export interface BuiltModel {
  root: Group;
  geometries: BufferGeometry[];
  materials: MeshStandardMaterial[];
  textures: Texture[];
  dispose: () => void;
}

export function createRenderer(canvas: HTMLCanvasElement): RendererBundle {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 1, 0.001, 1e9);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  scene.add(new AmbientLight(0xffffff, 1.1));
  const light = new DirectionalLight(0xffffff, 1.6);
  light.position.set(1, 2, 1);
  scene.add(light);
  return {
    renderer,
    scene,
    camera,
    controls,
    resize(width, height) {
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    dispose() {
      controls.dispose();
      renderer.dispose();
    },
  };
}

function appMaterial(material: SceneMaterial): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(material.rgba[0], material.rgba[1], material.rgba[2]),
    opacity: material.rgba[3],
    transparent: material.rgba[3] < 1,
    metalness: material.metallic,
    roughness: material.roughness,
    side: material.double_sided ? DoubleSide : FrontSide,
  });
}

/** Build one shared attribute set and one geometry draw range per primitive.
 * Attributes are shared; only the draw range and material differ. */
export function buildModel(scene: SafeSceneData, textureUrls: readonly (string | null)[]): BuiltModel {
  const geometries: BufferGeometry[] = [];
  const materials = scene.materials.map(appMaterial);
  const textures: Texture[] = [];
  const root = new Group();
  const objects = new Map<number, Group>();

  const base = new BufferGeometry();
  base.setAttribute("position", new BufferAttribute(scene.positions, 3));
  if (scene.normals) base.setAttribute("normal", new BufferAttribute(scene.normals, 3));
  if (scene.uv) base.setAttribute("uv", new BufferAttribute(scene.uv, 2));
  base.setIndex(new BufferAttribute(scene.indices, 1));

  for (const node of scene.nodes) {
    const group = new Group();
    group.name = node.name;
    group.matrixAutoUpdate = false;
    group.matrix.fromArray(node.matrix);
    objects.set(node.id, group);
    const parent = node.parent === null ? null : objects.get(node.parent);
    (parent ?? root).add(group);
  }

  for (const node of scene.nodes) {
    if (node.primitive_id === null) continue;
    const primitive = scene.primitives.find((item) => item.id === node.primitive_id);
    if (!primitive) continue;
    const geometry = new BufferGeometry();
    for (const [name, attribute] of Object.entries(base.attributes)) {
      geometry.setAttribute(name, attribute);
    }
    if (base.index) geometry.setIndex(base.index);
    geometry.setDrawRange(primitive.first_index, primitive.index_count);
    const mesh = new Mesh(geometry, materials[primitive.material_id] ?? new MeshStandardMaterial({ color: 0xb3b3b3 }));
    mesh.name = `${node.name} primitive ${primitive.id}`;
    objects.get(node.id)?.add(mesh);
    geometries.push(geometry);
  }

  materialTextures(scene, materials, textureUrls, textures);
  return {
    root,
    geometries,
    materials,
    textures,
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      base.dispose();
    },
  };
}

function materialTextures(scene: SafeSceneData, materials: MeshStandardMaterial[], urls: readonly (string | null)[], textures: Texture[]): void {
  const cache = new Map<number, Texture>();
  scene.materials.forEach((material, index) => {
    if (material.texture_index === null) return;
    const url = urls[material.texture_index];
    if (!url) return;
    let texture = cache.get(material.texture_index);
    if (!texture) {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      texture = new Texture(image);
      texture.needsUpdate = true;
      cache.set(material.texture_index, texture);
      textures.push(texture);
    }
    (materials[index] as MeshStandardMaterial & { map?: Texture }).map = texture;
    materials[index].needsUpdate = true;
  });
}

export function setWireframe(built: BuiltModel, wireframe: boolean): void {
  for (const material of built.materials) {
    material.wireframe = wireframe;
    material.needsUpdate = true;
  }
}

export function updateCamera(bundle: RendererBundle, position: Vec3, target: Vec3): void {
  bundle.camera.position.set(position[0], position[1], position[2]);
  bundle.controls.target.set(target[0], target[1], target[2]);
  bundle.controls.update();
}

export function applyBounds(bundle: RendererBundle, bounds: Bounds): void {
  const center: Vec3 = [(bounds[0] + bounds[3]) / 2, (bounds[1] + bounds[4]) / 2, (bounds[2] + bounds[5]) / 2];
  bundle.controls.target.set(center[0], center[1], center[2]);
  bundle.camera.lookAt(center[0], center[1], center[2]);
  bundle.controls.update();
}

export type FrameScheduler = {
  request: (callback: (time: number) => void) => number;
  cancel: (handle: number) => void;
  now: () => number;
};

export const browserScheduler: FrameScheduler = {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle),
  now: () => performance.now(),
};

/** Renders on request and keeps a RAF alive only until 500 ms after the
 * last interaction. Hiding the tab stops it immediately. */
export class RenderLoop {
  private handle: number | null = null;
  private active = true;
  private dirty = false;
  private lastRequest = 0;

  constructor(
    private readonly render: () => void,
    private readonly scheduler: FrameScheduler = browserScheduler,
    private readonly idleMs = 500,
  ) {}

  request(): void {
    this.dirty = true;
    this.lastRequest = this.scheduler.now();
    if (this.active && this.handle === null) this.schedule();
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active) {
      if (this.handle !== null) this.scheduler.cancel(this.handle);
      this.handle = null;
      return;
    }
    if (this.dirty) this.schedule();
  }

  dispose(): void {
    this.active = false;
    if (this.handle !== null) this.scheduler.cancel(this.handle);
    this.handle = null;
  }

  private schedule(): void {
    this.handle = this.scheduler.request(() => this.tick());
  }

  private tick(): void {
    this.handle = null;
    this.dirty = false;
    this.render();
    if (this.active && this.scheduler.now() - this.lastRequest < this.idleMs) {
      this.schedule();
    }
  }
}

export type { Material };
