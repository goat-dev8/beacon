import fs from "fs";

const rootEnv = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

let pk = rootEnv.DEPLOYER_PRIVATE_KEY || "";
if (pk.startsWith("0x")) pk = pk.slice(2);
const owner = rootEnv.DEPLOYER_ADDRESS;

const env = `LANGUAGE=go
PROXY_PRIVATE_KEY=${pk}
INITIAL_OWNER=${owner}
DEPLOYMENT_PRIVATE_KEY=${pk}
CHAIN_URL=https://coston2-api.flare.network/ext/C/rpc
ADDRESSES_FILE=./config/coston2/deployed-addresses.json
LOCAL_MODE=false
SIMULATED_TEE=true
NORMAL_PROXY_URL=https://tee-proxy-coston2-1.flare.rocks
EXT_PROXY_URL=http://localhost:6674
GOVERNANCE_SIGNERS=${owner}
GOVERNANCE_THRESHOLD=1
`;
fs.writeFileSync("fce-beacon/.env", env);

function fillToml(srcPath, destPath) {
  let t = fs.readFileSync(srcPath, "utf8");
  t = t.replace(/host = ".*"/, `host = "${rootEnv.COSTON2_INDEXER_DB_HOST}"`);
  t = t.replace(/port = \d+/, `port = ${rootEnv.COSTON2_INDEXER_DB_PORT || "3306"}`);
  t = t.replace(/database = ".*"/, `database = "${rootEnv.COSTON2_INDEXER_DB_NAME}"`);
  t = t.replace(/username = ".*"/, `username = "${rootEnv.COSTON2_INDEXER_DB_USERNAME}"`);
  t = t.replace(/password = ".*"/, `password = "${rootEnv.COSTON2_INDEXER_DB_PASSWORD}"`);
  fs.writeFileSync(destPath, t);
}

fillToml(
  "fce-beacon/config/proxy/extension_proxy.coston2.docker.toml.example",
  "fce-beacon/config/proxy/extension_proxy.coston2.docker.toml",
);
fillToml(
  "fce-beacon/config/proxy/extension_proxy.coston2.toml.example",
  "fce-beacon/config/proxy/extension_proxy.coston2.toml",
);

console.log("wrote fce-beacon .env + indexer toml");
