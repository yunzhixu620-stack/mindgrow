const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const runtimePath = path.join(projectRoot, "fc-proxy", "index.js");
const mirrorPath = path.join(projectRoot, "docs", "api-version.txt");

function fail(message) {
  console.error(`API version check failed: ${message}`);
  process.exitCode = 1;
}

try {
  const runtimeSource = fs.readFileSync(runtimePath, "utf8");
  const matches = [...runtimeSource.matchAll(/\bconst\s+API_VERSION\s*=\s*(['"])(\d+\.\d+\.\d+)\1\s*;/g)];
  if (matches.length !== 1) {
    fail(`expected exactly one semver API_VERSION constant in ${path.relative(projectRoot, runtimePath)}, found ${matches.length}`);
  } else {
    const runtimeVersion = matches[0][2];
    const mirrorSource = fs.readFileSync(mirrorPath, "utf8");
    const mirrorMatch = mirrorSource.match(/^(\d+\.\d+\.\d+)(?:\r?\n)?$/);

    if (!mirrorMatch) {
      fail(`${path.relative(projectRoot, mirrorPath)} must contain exactly one x.y.z version line`);
    } else if (runtimeVersion !== mirrorMatch[1]) {
      fail(`runtime ${runtimeVersion} does not match mirror ${mirrorMatch[1]}`);
    } else {
      console.log(`API version ${runtimeVersion} matches the CI mirror`);
    }
  }
} catch (error) {
  fail(error.message);
}
