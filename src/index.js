const {SudoerDarwin, SudoerWin32, SudoerLinux} = require('./lib/sudoer');

module.exports = (() => {
    let {platform} = process;
    switch (platform) {
        case 'darwin':
            return SudoerDarwin;
        case 'win32':
            return SudoerWin32;
        case 'linux':
            return SudoerLinux;
        default:
            throw new Error(`Unsupported platform: ${platform}`);
    }
})();
