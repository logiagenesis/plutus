const fs = require("fs");
const path = require("path");
const webpack = require("/usr/share/nodejs/webpack");

const loaderPath = path.resolve(".test-loader.cjs");
if (!fs.existsSync(loaderPath)) {
  fs.writeFileSync(loaderPath, `
const babel = require("/usr/share/nodejs/@babel/core");
module.exports = function(source) {
  const result = babel.transformSync(source, {
    presets: ["/usr/share/nodejs/@babel/preset-typescript"],
    filename: this.resourcePath
  });
  return result.code;
};
`);
}

const compiler = webpack({
  entry: path.resolve("worker/index.ts"),
  target: "node18",
  experiments: { outputModule: true },
  output: {
    path: path.resolve(".test-build"),
    filename: "worker.mjs",
    chunkFormat: "module",
    library: { type: "module" }
  },
  resolve: {
    extensions: [".ts", ".js"]
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: [loaderPath]
      }
    ]
  }
});

compiler.run((err, stats) => {
  if (err) { console.error("Webpack err:", err); process.exit(1); }
  const info = stats.toJson();
  if (stats.hasErrors()) { console.error("Stats errs:", info.errors); process.exit(1); }
  console.log("Worker bundled to .test-build/worker.mjs");
});
