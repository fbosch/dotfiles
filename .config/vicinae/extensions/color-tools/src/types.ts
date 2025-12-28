export interface ColorEntry {
  id: string;
  name: string;
  hex: string;
  rgb: { r: number; g: number; b: number };
  category: string;
}

export interface ColorWithOpacity extends ColorEntry {
  opacity: number;
  hexWithOpacity: string;
  rgba: string;
}
