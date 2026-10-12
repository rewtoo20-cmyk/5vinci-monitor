// Закрывает в программе лазейки Electron (запуск как обычный Node, подмена кода через переменные окружения, отладчик).
// Если что-то пойдёт не так, сборка не ломается: программа просто будет без этой защиты.
const path = require('path');
exports.default = async function (ctx) {
  try {
    if (ctx.electronPlatformName !== 'win32') return;
    const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
    const exe = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.exe');
    await flipFuses(exe, {
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    });
    console.log('  • защита Electron включена');
  } catch (e) {
    console.warn('  • защиту Electron включить не удалось: ' + (e && e.message));
  }
};
