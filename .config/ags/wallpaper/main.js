import {
  ShaderFitOptions,
  ShaderMount,
  getShaderColorFromString,
  getShaderNoiseTexture,
  paperTextureFragmentShader,
} from "../node_modules/@paper-design/shaders/dist/index.js";

const wallpaperUri = new URL(window.location.href).searchParams.get("wallpaper");
const container = document.querySelector("#shader");

if (!wallpaperUri || !container) {
  throw new Error("Paper wallpaper requires a source image and shader container");
}

const image = new Image();
image.src = wallpaperUri;
await image.decode();

new ShaderMount(
  container,
  paperTextureFragmentShader,
  {
    u_image: image,
    u_noiseTexture: getShaderNoiseTexture(),
    u_imageAspectRatio: image.naturalWidth / image.naturalHeight,
    u_colorFront: getShaderColorFromString("#e8e2d7"),
    u_colorBack: getShaderColorFromString("#1d1a17"),
    u_contrast: 0.35,
    u_roughness: 0.12,
    u_fiber: 0.2,
    u_fiberSize: 0.4,
    u_crumples: 0.08,
    u_crumpleSize: 0.25,
    u_foldCount: 3,
    u_folds: 0.08,
    u_fade: 0.15,
    u_drops: 0.03,
    u_seed: 1,
    u_fit: ShaderFitOptions.cover,
    u_scale: 1,
    u_rotation: 0,
    u_offsetX: 0,
    u_offsetY: 0,
    u_originX: 0.5,
    u_originY: 0.5,
    u_worldWidth: image.naturalWidth,
    u_worldHeight: image.naturalHeight,
  },
  undefined,
  0,
);
