import * as THREE from "three";

/** The slice of camera-controls we drive when snapping orientation. */
interface SnapControls {
  distance: number;
  getTarget: (out: THREE.Vector3) => THREE.Vector3;
  setLookAt: (
    px: number,
    py: number,
    pz: number,
    tx: number,
    ty: number,
    tz: number,
    enableTransition?: boolean,
  ) => Promise<void>;
}

const SIZE = 125; // on-screen widget size in px
const HANDLE = 0.34; // sprite radius in gizmo-space
const AXIS_LEN = 1; // distance of each handle from origin

interface AxisDef {
  dir: THREE.Vector3;
  label: string;
  color: string;
  positive: boolean;
}

// X red, Y green, Z blue (Y is up). Positive ends are labelled + solid;
// negative ends are hollow rings.
const AXES: AxisDef[] = [
  { dir: new THREE.Vector3(1, 0, 0), label: "X", color: "#ef4444", positive: true },
  { dir: new THREE.Vector3(-1, 0, 0), label: "X", color: "#ef4444", positive: false },
  { dir: new THREE.Vector3(0, 1, 0), label: "Y", color: "#22c55e", positive: true },
  { dir: new THREE.Vector3(0, -1, 0), label: "Y", color: "#22c55e", positive: false },
  { dir: new THREE.Vector3(0, 0, 1), label: "Z", color: "#3b82f6", positive: true },
  { dir: new THREE.Vector3(0, 0, -1), label: "Z", color: "#3b82f6", positive: false },
];

/** Draw an axis handle onto a small canvas and return it as a sprite texture. */
function handleTexture(axis: AxisDef): THREE.CanvasTexture {
  const px = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d")!;
  const r = px / 2 - 4;

  ctx.beginPath();
  ctx.arc(px / 2, px / 2, r, 0, Math.PI * 2);
  if (axis.positive) {
    ctx.fillStyle = axis.color;
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 30px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(axis.label, px / 2, px / 2 + 1);
  } else {
    ctx.fillStyle = "#0a0a0a";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = axis.color;
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A navigation gimbal rendered into a small overlay canvas at the lower-left of
 * the viewport. It mirrors the main camera's orientation; clicking an axis
 * handle snaps the camera to look down that world axis (keeping target + dolly).
 */
export class Gizmo {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
  private group = new THREE.Group();
  private handles: THREE.Sprite[] = [];
  private raycaster = new THREE.Raycaster();

  constructor(
    private getCamera: () => THREE.Camera,
    private controls: SnapControls,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = SIZE;
    Object.assign(this.canvas.style, {
      position: "absolute",
      right: "12px",
      bottom: "12px",
      width: `${SIZE}px`,
      height: `${SIZE}px`,
      cursor: "pointer",
      zIndex: "10",
      display: "none", // shown only once a model is loaded
    });

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(SIZE, SIZE, false);

    this.camera.position.set(0, 0, 5);
    this.scene.add(this.group);
    this.buildAxes();

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
  }

  private buildAxes() {
    // Lines from origin to each positive end, colored per axis.
    for (const axis of AXES) {
      if (!axis.positive) continue;
      const end = axis.dir.clone().multiplyScalar(AXIS_LEN);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), end]),
        new THREE.LineBasicMaterial({ color: axis.color }),
      );
      this.group.add(line);
    }

    for (const axis of AXES) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: handleTexture(axis),
          depthTest: false,
          transparent: true,
        }),
      );
      sprite.position.copy(axis.dir).multiplyScalar(AXIS_LEN);
      sprite.scale.setScalar(HANDLE);
      sprite.userData.dir = axis.dir;
      sprite.renderOrder = 1;
      this.group.add(sprite);
      this.handles.push(sprite);
    }
  }

  /** Show or hide the gimbal (hidden until a model is loaded). */
  setVisible(visible: boolean) {
    this.canvas.style.display = visible ? "block" : "none";
    if (visible) this.update();
  }

  /** Re-orient the gimbal to the main camera and redraw. Call on camera move. */
  update = () => {
    this.group.quaternion.copy(this.getCamera().quaternion).invert();
    this.renderer.render(this.scene, this.camera);
  };

  private onPointerDown = (event: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.handles)[0];
    if (!hit) return;

    event.stopPropagation();
    this.snapTo(hit.object.userData.dir as THREE.Vector3);
  };

  /** Move the camera onto `dir`, looking back at the current target. */
  private snapTo(dir: THREE.Vector3) {
    const target = this.controls.getTarget(new THREE.Vector3());
    const dist = this.controls.distance;
    const pos = target.clone().addScaledVector(dir, dist);
    void this.controls.setLookAt(
      pos.x,
      pos.y,
      pos.z,
      target.x,
      target.y,
      target.z,
      true,
    );
  }

  dispose() {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.remove();
    this.handles.forEach((s) => {
      s.material.map?.dispose();
      s.material.dispose();
    });
    this.renderer.dispose();
  }
}
