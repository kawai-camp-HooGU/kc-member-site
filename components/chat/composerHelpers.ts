export { MAX_ATTACH_BYTES } from "../../lib/chatStorage";
import { fmtSize } from "./chatUtils";
export const fmtSizeGuard = (b: number): string => fmtSize(b);
