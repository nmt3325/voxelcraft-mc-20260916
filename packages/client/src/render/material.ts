import { RENDER_LAYER, type RenderLayer } from '@voxelcraft/core-types'
import * as THREE from 'three'
import { TINT_COUNT } from '../mesher/appearance'

/**
 * WebGL2 materials for the three render layers.
 *
 * The vertex stream is fully packed (see `mesher/greedy.ts`), so the shaders do
 * the unpacking:
 * - position is in 1/16 block units, divided by 16 here
 * - UVs come from the two tangent components of the position, which makes a
 *   merged w x h quad tile its texture w x h times (`RepeatWrapping`)
 * - lane 5 carries normal id, corner id and AO
 * - lane 6 carries `(skyLight << 4) | blockLight`
 * - lane 7 indexes the tint palette (grass, foliage, water, lava)
 *
 * These materials ask for `THREE.GLSL3`, so three only injects the
 * `#define attribute in` / `#define varying out|in` aliases: unlike its GLSL1
 * upgrade path it declares no fragment output and no `gl_FragColor` alias, so
 * the fragment shader declares `fragColor` itself. `position` must not be
 * redeclared because three already declares it for `ShaderMaterial`.
 */

const VERTEX_SHADER = /* glsl */ `
precision highp float;

attribute float aTexLayer;
attribute float aNormalAo;
attribute float aLight;
attribute float aTint;

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uAmbient;
uniform vec3 uTintColors[${TINT_COUNT}];

varying vec2 vUv;
varying float vLayer;
varying vec3 vColor;
varying float vFogDepth;

void main() {
	vec3 blockPos = position / 16.0;

	float normalId = floor(aNormalAo / 16.0);
	float rest = aNormalAo - normalId * 16.0;
	float uvCorner = floor(rest / 4.0);
	float ao = rest - uvCorner * 4.0;

	if (normalId < 1.5) {
		vUv = vec2(blockPos.y, blockPos.z);
	} else if (normalId < 3.5) {
		vUv = vec2(blockPos.z, blockPos.x);
	} else {
		vUv = vec2(blockPos.x, blockPos.y);
	}
	vLayer = aTexLayer;

	float sky = floor(aLight / 16.0);
	float blockLight = aLight - sky * 16.0;
	float daylight = clamp(uSunDir.y * 0.5 + 0.5, 0.12, 1.0);
	float aoTerm = 0.55 + 0.15 * ao;
	vec3 skyTerm = uSunColor * (uAmbient + (1.0 - uAmbient) * (sky / 15.0) * daylight);
	vec3 torchTerm = vec3(1.0, 0.82, 0.55) * (blockLight / 15.0) * 0.9;
	vColor = uTintColors[int(aTint + 0.5)] * (skyTerm + torchTerm) * aoTerm;

	vec4 viewPos = modelViewMatrix * vec4(blockPos, 1.0);
	vFogDepth = -viewPos.z;
	gl_Position = projectionMatrix * viewPos;
}
`

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray uAtlas;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uUnderwater;

varying vec2 vUv;
varying float vLayer;
varying vec3 vColor;
varying float vFogDepth;

layout(location = 0) out vec4 fragColor;

void main() {
	vec4 texel = texture(uAtlas, vec3(vUv, vLayer));
	#ifdef CUTOUT
	if (texel.a < 0.5) discard;
	#endif

	vec3 color = texel.rgb * vColor;
	color = mix(color, uFogColor, smoothstep(uFogNear, uFogFar, vFogDepth));
	color = mix(color, vec3(0.13, 0.32, 0.58), uUnderwater * 0.45);

	#ifdef TRANSLUCENT
	float alpha = texel.a * 0.78;
	#else
	float alpha = texel.a;
	#endif

	fragColor = vec4(color, alpha);
}
`

export interface LayerMaterials {
	readonly opaque: THREE.ShaderMaterial
	readonly cutout: THREE.ShaderMaterial
	readonly translucent: THREE.ShaderMaterial
	materialFor(layer: RenderLayer): THREE.ShaderMaterial
	setAtlas(texture: THREE.DataArrayTexture): void
	/** `sunDir.y > 0` is daytime. */
	setSun(sunDir: THREE.Vector3, sunColor: THREE.Color, ambient: number): void
	setFog(color: THREE.Color, near: number, far: number): void
	setUnderwater(underwater: boolean): void
	dispose(): void
}

export function createLayerMaterials(): LayerMaterials {
	const tintColors = [
		new THREE.Color(1, 1, 1),
		new THREE.Color(0.57, 0.79, 0.38),
		new THREE.Color(0.43, 0.69, 0.31),
		new THREE.Color(0.32, 0.53, 0.95),
		new THREE.Color(1, 0.62, 0.24),
	]

	const uniforms: Record<string, THREE.IUniform> = {
		uAtlas: { value: null },
		uSunDir: { value: new THREE.Vector3(0.35, 0.9, 0.25).normalize() },
		uSunColor: { value: new THREE.Color(1, 0.98, 0.94) },
		uAmbient: { value: 0.3 },
		uFogColor: { value: new THREE.Color(0.66, 0.8, 0.98) },
		uFogNear: { value: 48 },
		uFogFar: { value: 128 },
		uUnderwater: { value: 0 },
		uTintColors: { value: tintColors },
	}

	const make = (
		defines: Record<string, boolean>,
		extra: THREE.ShaderMaterialParameters,
	): THREE.ShaderMaterial =>
		new THREE.ShaderMaterial({
			glslVersion: THREE.GLSL3,
			uniforms,
			defines,
			vertexShader: VERTEX_SHADER,
			fragmentShader: FRAGMENT_SHADER,
			...extra,
		})

	const opaque = make({}, { side: THREE.FrontSide })
	const cutout = make({ CUTOUT: true }, { side: THREE.DoubleSide })
	const translucent = make(
		{ TRANSLUCENT: true },
		{ side: THREE.DoubleSide, transparent: true, depthWrite: false },
	)

	return {
		opaque,
		cutout,
		translucent,
		materialFor(layer: RenderLayer): THREE.ShaderMaterial {
			if (layer === RENDER_LAYER.Cutout) return cutout
			if (layer === RENDER_LAYER.Translucent) return translucent
			return opaque
		},
		setAtlas(texture: THREE.DataArrayTexture): void {
			uniforms.uAtlas.value = texture
		},
		setSun(sunDir: THREE.Vector3, sunColor: THREE.Color, ambient: number): void {
			;(uniforms.uSunDir.value as THREE.Vector3).copy(sunDir).normalize()
			;(uniforms.uSunColor.value as THREE.Color).copy(sunColor)
			uniforms.uAmbient.value = ambient
		},
		setFog(color: THREE.Color, near: number, far: number): void {
			;(uniforms.uFogColor.value as THREE.Color).copy(color)
			uniforms.uFogNear.value = near
			uniforms.uFogFar.value = far
		},
		setUnderwater(underwater: boolean): void {
			uniforms.uUnderwater.value = underwater ? 1 : 0
		},
		dispose(): void {
			opaque.dispose()
			cutout.dispose()
			translucent.dispose()
		},
	}
}
