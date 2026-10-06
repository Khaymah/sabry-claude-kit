import { Environment, Lightformer } from "@react-three/drei";

/**
 * Procedural studio lighting: an environment map built from Lightformers, so
 * reflective materials have something to reflect. No HDR download, works offline.
 *
 * Deliberately asymmetric (cool key upper-left, warm rim right-back, violet floor
 * bounce) and made of broad panels: symmetric lights or a ring facing the camera
 * reflect as "eyes" on a shiny object and make it look like a face.
 */
export default function Studio() {
  return (
    <Environment resolution={256} frames={1}>
      <color attach="background" args={["#070812"]} />
      <Lightformer form="rect" intensity={1.6} position={[0, 5, -1]} rotation-x={Math.PI / 2} scale={[14, 7, 1]} />
      <Lightformer form="rect" intensity={3.2} color="#a9c8ff" position={[-5, 2.5, 3]} rotation-y={Math.PI / 3} scale={[5, 3, 1]} />
      <Lightformer form="rect" intensity={2.4} color="#ffb8d2" position={[5, -0.5, -2]} rotation-y={-Math.PI / 2.4} scale={[3, 9, 1]} />
      <Lightformer form="rect" intensity={0.55} color="#5a6dff" position={[0, -5, 1]} rotation-x={-Math.PI / 2} scale={[12, 12, 1]} />
    </Environment>
  );
}
