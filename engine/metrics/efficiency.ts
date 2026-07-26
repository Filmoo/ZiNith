/** IOE. Chording lets this exceed 100%, which is the point. */
export function efficiency(threeBVValue: number, clicks: number): number {
  return clicks === 0 ? 0 : threeBVValue / clicks
}

export function threeBVPerSecond(threeBVValue: number, ms: number): number {
  return ms <= 0 ? 0 : threeBVValue / (ms / 1000)
}
