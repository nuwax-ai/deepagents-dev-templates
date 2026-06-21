/**
 * travel-planner 拓扑（libs 层，零 surface 依赖）。
 * Map-reduce（Send 扇出）+ HITL：gather → research×4 → aggregate → confirm → finalize。
 */
export {
  createTravelGraph,
  TravelState,
  type TravelStateType,
  gatherNode,
  fanoutToResearch,
} from "./graph.js";
export { getTravelTopology } from "./topology.js";
export { travelRecipe } from "./recipe.js";
