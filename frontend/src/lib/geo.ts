/** Small geometry helpers with no map-library dependency (safe to import anywhere). */

export type BBox = [number, number, number, number];

/** Area of a lon/lat box in km² (spherical approximation; matches the backend's AOI sizing within ~1 %). */
export function bboxAreaKm2(b: BBox): number {
  const [minx, miny, maxx, maxy] = b;
  const latMid = ((miny + maxy) / 2) * (Math.PI / 180);
  return Math.abs((maxx - minx) * 111.32 * Math.cos(latMid) * (maxy - miny) * 110.574);
}
