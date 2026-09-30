import { createFunctionHandler } from "../server/runtime.js";

// vercel.json routes every /api request here. Keep its original URL intact so
// the same Express routes, cookies and CSRF checks work locally and on Vercel.
export default createFunctionHandler();
