const { ethers } = require("hardhat");

async function main() {
  const C = await ethers.getContractFactory("BlockNexSupply");
  const c = await C.deploy();
  await c.waitForDeployment();
  console.log("BlockNexSupply deployed:", await c.getAddress());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});