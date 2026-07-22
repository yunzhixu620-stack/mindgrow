const fs = require("fs");
const {
  createDeploymentFact,
  publicFactPath,
  validateDeploymentFact,
} = require("./deployment-fact");

if (process.argv.includes("--cleanup")) {
  fs.rmSync(publicFactPath, { force: true });
  console.log("Removed generated public/deployment.json source file");
} else {
  const fact = createDeploymentFact();
  const errors = validateDeploymentFact(fact);
  if (errors.length) throw new Error(errors.join("; "));
  fs.writeFileSync(publicFactPath, `${JSON.stringify(fact, null, 2)}\n`, "utf8");
  console.log(`Prepared deployment fact for ${fact.frontend.gitSha.slice(0, 7)} / API ${fact.api.expectedVersion}`);
}
