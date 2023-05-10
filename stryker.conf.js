/**
 * @type {import('@stryker-mutator/api/core').StrykerOptions}
 */
module.exports = {
  packageManager: "yarn",
  reporters: ["clear-text", "progress"],
  testRunner: "jest",
  coverageAnalysis: "off",
  tsconfigFile: "tsconfig.json",
  mutate: ["src/**/*.ts", "!src/__benchmarks__/*.ts", "!src/__tests__/*.ts"]
}

