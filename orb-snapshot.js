// orb-snapshot.js — still pictures of the 3D voice portrait, for places that show many at once
// (the Archive gallery) or a small one (the ID card photo). A browser can only run a handful of
// live 3D views per page, so these are drawn one at a time with a single shared renderer and
// turned into images. The live, turnable version is on the Portrait page.
import * as THREE from "three";
import { buildOrb } from "./voice-orb.js?v=47";

let renderer = null;
const VIEW_RADIUS = 1.4; // same framing as the Portrait page

/** Returns { url, color } — a PNG data URL of this voice's portrait, and its core color. */
export function snapshot(take, size = 520) {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.NeutralToneMapping;
  }
  renderer.setSize(size, size, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const orb = buildOrb({ ...take, frames: take.frames || [] });
  scene.add(orb.group);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  const d = VIEW_RADIUS / Math.sin(THREE.MathUtils.degToRad(15));
  camera.position.set(0, d * 0.22, d).setLength(d);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/png");
  scene.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  return { url, color: `#${orb.coreColor.getHexString()}` };
}
