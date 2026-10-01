import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_SUBMISSION_FILES, copyPublicSubmission, validatePublicEvidence } from "./publish-submission.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const original = JSON.parse(await readFile(path.join(root, "docs/submission/evidence.json"), "utf8"));

test("public evidence is complete and its recall sources match confirmed mainnet receipts", () => {
  assert.doesNotThrow(() => validatePublicEvidence(original));
});

test("credentials and unreviewed fields at every evidence level block publication", () => {
  for (const mutate of [
    proof => { proof.recoveryCode = "private-example"; },
    proof => { proof.stages.after.patientId = "private-example"; },
    proof => { proof.stages.after.memoryTrace.cookie = "private-example"; },
    proof => { proof.stages.save.receipts[0].apiKey = "private-example"; },
  ]) {
    const proof = structuredClone(original);
    mutate(proof);
    assert.throws(() => validatePublicEvidence(proof), /Unreviewed field/);
  }
});

test("mismatched evidence, non-mainnet receipts and private image paths block publication", () => {
  for (const mutate of [
    proof => { proof.stages.updated.memoryTrace.historyUsed = true; },
    proof => { proof.stages.after.prompt = "a different question"; },
    proof => { proof.stages.save.receipts[0].status = "pending"; },
    proof => { proof.stages.after.screenshot = "../../data/private.png"; },
    proof => { proof.stages.updated.sourceBlobIds = []; },
    proof => { proof.network = "testnet"; },
  ]) {
    const proof = structuredClone(original);
    mutate(proof);
    assert.throws(() => validatePublicEvidence(proof));
  }
});

test("the public build copies exactly the reviewed allowlist with unchanged bytes", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "vitarecall-submission-test-"));
  try {
    assert.equal(await copyPublicSubmission(root, output), PUBLIC_SUBMISSION_FILES.length);
    const files = await readdir(path.join(output, "submission"), { recursive: true, withFileTypes: true });
    const relative = files.filter(file => file.isFile()).map(file => path.relative(path.join(output, "submission"), path.join(file.parentPath, file.name)).replaceAll("\\", "/")).sort();
    assert.deepEqual(relative, [...PUBLIC_SUBMISSION_FILES].sort());
    for (const name of relative) {
      assert.deepEqual(await readFile(path.join(output, "submission", name)), await readFile(path.join(root, "docs/submission", name)));
      assert.doesNotMatch(name, /(?:^|\/)(?:data|\.env|private|node_modules)(?:\/|$|\.)/i);
    }
  } finally {
    // mkdtemp returned this exact task-owned directory, not an external path.
    assert.equal(path.dirname(output), path.resolve(tmpdir()));
    assert.ok(path.basename(output).startsWith("vitarecall-submission-test-"));
    await rm(output, { recursive: true, force: true });
  }
});

test("article references the public evidence and reproduction pages", async () => {
  const article = await readFile(path.join(root, "docs/submission/ARTICLE.md"), "utf8");
  assert.match(article, /https:\/\/vitarecall\.vercel\.app\/submission\/evidence\.html/);
  assert.match(article, /https:\/\/vitarecall\.vercel\.app\/submission\/demo\.html/);
  assert.doesNotMatch(article, /\]\((?:evidence\.html|DEMO\.md)\)/);
});
