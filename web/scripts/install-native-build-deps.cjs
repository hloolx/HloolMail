const { execFileSync } = require('node:child_process');

const arch = { x64: 'x64', arm64: 'arm64' }[process.arch];

if (process.platform !== 'linux' || !arch) {
  process.exit(0);
}

const libc = process.report.getReport().header.glibcVersionRuntime ? 'gnu' : 'musl';
const rollupVersion = require('../node_modules/rollup/package.json').version;
const lightningVersion = require('../node_modules/lightningcss/package.json').version;
const tailwindOxideVersion = require('../node_modules/@tailwindcss/oxide/package.json').version;
const packages = [
  `@rollup/rollup-linux-${arch}-${libc}@${rollupVersion}`,
  `lightningcss-linux-${arch}-${libc}@${lightningVersion}`,
  `@tailwindcss/oxide-linux-${arch}-${libc}@${tailwindOxideVersion}`,
];

const missing = packages.filter((pkg) => {
  const name = pkg.slice(0, pkg.lastIndexOf('@'));
  try {
    require.resolve(`${name}/package.json`);
    return false;
  } catch {
    return true;
  }
});

if (missing.length > 0) {
  execFileSync('npm', ['install', '--no-save', ...missing], { stdio: 'inherit' });
}
