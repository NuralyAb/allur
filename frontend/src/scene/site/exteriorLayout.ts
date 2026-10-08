import type { XY } from '../../shared/types'

/** Shared by the visible access road and outbound vehicles; clears the OSM gatehouse. */
export const OUTBOUND_ROUTE: XY[] = [
  [157, -8], [157, -52], [418, -52], [418, 300], [395, 318], [200, 330], [160, 345],
]

export const ROAD_TURN_RADIUS = 16
