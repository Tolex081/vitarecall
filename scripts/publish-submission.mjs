// Only reviewed, synthetic submission artifacts may enter the public build.
// Never recursively copy docs/, data/, environment files, or future additions.
import { copyFile, lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export const PUBLIC_SUBMISSION_FILES = Object.freeze([
  "index.html", "article.html", "evidence.html", "guide.html", "demo.html",
  "README.md", "ARTICLE.md", "ASSETS.md", "DEMO.md", "SUBMISSION-GUIDE.md",
  "ARTWORK-PROMPTS.json", "evidence.json",
  "assets/walrus-cover.png", "assets/walrus-changing-preferences.png",
  "assets/architecture.svg", "assets/architecture.png",
  "assets/before-answer.png", "assets/save-answer.png", "assets/after-answer.png",
  "assets/after-mobile.png", "assets/correct-answer.png", "assets/correct-receipts.png",
  "assets/updated-answer.png", "assets/updated-mobile.png",
]);

function allowedKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error(`Unreviewed field in ${label}; refusing public export.`);
}

export function validatePublicEvidence(proof) {
  allowedKeys(proof, ["schema", "origin", "startedAt", "appCommit", "model", "network", "design", "limitations", "stages"], "evidence");
  if (proof.schema !== "vitarecall.submission-demo.v1" || proof.network !== "mainnet") throw new Error("Unexpected evidence format/network.");
  const stages = ["before", "save", "after", "correct", "updated"];
  allowedKeys(proof.stages, stages, "stages");
  for (const key of stages) {
    const stage = proof.stages[key];
    allowedKeys(stage, ["capturedAt", "prompt", "response", "memoryTrace", "sourceBlobIds", "automaticSavingDuringExchange", "completedAt", "screenshot", "screenshotNote", "receipts"], `stage ${key}`);
    allowedKeys(stage.memoryTrace, ["status", "sourceCount", "historyUsed"], "memory trace");
    if (!stage.completedAt || stage.memoryTrace.historyUsed !== false) throw new Error("Evidence must be a completed fresh-conversation run.");
    if (!Array.isArray(stage.sourceBlobIds) || stage.sourceBlobIds.length !== stage.memoryTrace.sourceCount) throw new Error("Source count mismatch.");
    if (stage.screenshot && !PUBLIC_SUBMISSION_FILES.includes(stage.screenshot)) throw new Error("Unreviewed screenshot path.");
    for (const receipt of stage.receipts || []) {
      allowedKeys(receipt, ["status", "blobId", "jobId", "walrusScanUrl", "aggregatorStatus", "encryptedBytes", "encryptedSha256"], "receipt");
      if (receipt.status !== "stored" || receipt.aggregatorStatus !== 200 || !/^[A-Za-z0-9_-]{43}$/.test(receipt.blobId)) throw new Error("Unconfirmed or invalid mainnet receipt.");
      if (receipt.walrusScanUrl !== `https://walruscan.com/mainnet/blob/${receipt.blobId}`) throw new Error("Receipt explorer mismatch.");
    }
  }
  for (const key of ["after", "updated"]) {
    if (proof.stages[key].prompt !== proof.stages.before.prompt) throw new Error("Before/after prompts must match.");
  }
  for (const [saved, returned] of [["save", "after"], ["correct", "updated"]]) {
    const ids = (proof.stages[saved].receipts || []).map(receipt => receipt.blobId);
    if (!ids.length || !ids.every(id => proof.stages[returned].sourceBlobIds.includes(id))) throw new Error("Return sources do not match confirmed saves.");
  }
}

export async function copyPublicSubmission(projectRoot, outputDir) {
  const source = path.join(projectRoot, "docs", "submission");
  const target = path.join(outputDir, "submission");
  validatePublicEvidence(JSON.parse(await readFile(path.join(source, "evidence.json"), "utf8")));
  // Validate everything before beginning the copy, including symlink boundaries.
  if ((await lstat(source)).isSymbolicLink() || (await lstat(path.join(source, "assets"))).isSymbolicLink()) throw new Error("Submission directories must not be symlinks.");
  for (const name of PUBLIC_SUBMISSION_FILES) {
    const stat = await lstat(path.join(source, name));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Public artifact must be a regular file: ${name}`);
  }
  for (const name of PUBLIC_SUBMISSION_FILES) {
    await mkdir(path.dirname(path.join(target, name)), { recursive: true });
    await copyFile(path.join(source, name), path.join(target, name));
  }
  return PUBLIC_SUBMISSION_FILES.length;
}
