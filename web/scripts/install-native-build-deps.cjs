const { execFileSync } = require('node:child_process');

const arch = { x64: 'x64', arm64: 'arm64' }[process.arch];

if (process.platform !== 'linux' || !arch) {
  process.exit(0);
}

const libc = process.report.getReport().header.glibcVersionRuntime ? 'gnu' : 'musl';
const packages = [];

const getPackageVersion = (name) => {
  try {
    return require(`../node_modules/${name}/package.json`).version;
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND') {
      return null;
    }
    throw error;
  }
};

const rollupVersion = getPackageVersion('rollup');
if (rollupVersion) {
  packages.push(`@rollup/rollup-linux-${arch}-${libc}@${rollupVersion}`);
}

const rolldownVersion = getPackageVersion('rolldown');
if (rolldownVersion) {
  packages.push(`@rolldown/binding-linux-${arch}-${libc}@${rolldownVersion}`);
}

const lightningVersion = getPackageVersion('lightningcss');
if (lightningVersion) {
  packages.push(`lightningcss-linux-${arch}-${libc}@${lightningVersion}`);
}

const tailwindOxideVersion = getPackageVersion('@tailwindcss/oxide');
if (tailwindOxideVersion) {
  packages.push(`@tailwindcss/oxide-linux-${arch}-${libc}@${tailwindOxideVersion}`);
}

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
