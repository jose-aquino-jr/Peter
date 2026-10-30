import animationJson from "./animations/vlibras-sim.animation.json";
import type { VlibrasAnimation } from "./vlibras-animation";
import { VLibrasSimBindings } from "./vlibras-animation";

export const VLibrasSimAnimation = animationJson as VlibrasAnimation;
export { VLibrasSimBindings };
