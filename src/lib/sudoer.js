import {tmpdir} from 'os';
import {watchFile, unwatchFile, unlink, createReadStream} from 'fs';

import {readFile, writeFile, exec, spawn} from './utils';

let {platform, env} = process;

class Sudoer {

    constructor(options) {
        this.platform = platform;
        this.options = options;
        this.cp = null;
        this.tmpdir = tmpdir();
    }

    joinEnv(options) {
        let {env} = options,
            spreaded = [];
        if (env && typeof env == 'object') {
            for (let key in env) {
                spreaded.push(key.concat('=', env[key]));
            }
        }
        return spreaded;
    }

    escapeDoubleQuotes(string) {
        return string.replace(/"/g, '\\"');
    }

    encloseDoubleQuotes(string) {
        return string.replace(/(.+)/g, '"$1"');
    }

    kill(pid) {
        if (!pid) {
            return;
        } else {
            return;
        }
    }
}

class SudoerUnix extends Sudoer {

    constructor(options={}) {
        super(options);
        if (!this.options.name) { this.options.name = 'Electron'; }
    }

    async reset() {
        await exec('/usr/bin/sudo -k');
    }
}

class SudoerDarwin extends SudoerUnix {

    constructor(options={}) {
        super(options);
        if (options.icns && typeof options.icns !== 'string') {
            throw new Error('options.icns must be a string if provided.');
        } else if (options.icns && options.icns.trim().length === 0) {
            throw new Error('options.icns must be a non-empty string if provided.');
        }
    }

    isValidName(name) {
        return /^[a-z0-9 ]+$/i.test(name) && name.trim().length > 0 && name.length < 70;
    }

    joinEnv(options) {
        let {env} = options,
            spreaded = [];
        if (env && typeof env == 'object') {
            for (let key in env) {
                spreaded.push(key.concat('=', env[key]));
            }
        }
        return spreaded;
    }

    async exec(command, options={}) {
        return new Promise(async (resolve, reject) => {
            let env = this.joinEnv(options);
            let sudoCommand = ['/usr/bin/sudo -n', env.join(' '), '-s', command].join(' ');
            await this.reset();
            try {
                let result = await exec(sudoCommand, options);
                resolve(result);
            } catch (err) {
                try {
                    // Prompt password
                    await this.prompt();
                    // Try once more
                    let result = await exec(sudoCommand, options);
                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            }
        });
    }

    async spawn(command, args, options={}) {
        return new Promise(async (resolve, reject) => {
            let bin = '/usr/bin/sudo',
                cp;
            await this.reset();
            // Prompt password
            await this.prompt();
            cp = spawn(bin, ['-n', '-s', '-E', [command, ...args].join(' ')], options);
            cp.on('error', async (err) => {
                reject(err);
            });
            this.cp = cp;
            resolve(cp);
        });
    }

    async prompt() {
        return new Promise(async (resolve, reject) => {
            if (!this.tmpdir) {
                return reject(
                    new Error('Requires os.tmpdir() to be defined.')
                );
            }
            if (!env.USER) {
                return reject(
                    new Error('Requires env[\'USER\'] to be defined.')
                );
            }
            try {
                // Open UI dialog with password prompt
                await this.open();
            } catch (err) {
                return reject(err);
            }
            return resolve();
        });
    }

    async open() {
        return new Promise(async (resolve, reject) => {
            try {
                let result = await exec(`osascript -e 'do shell script "mkdir -p /var/db/sudo/$USER; touch /var/db/sudo/$USER" with administrator privileges'`);
                return resolve(result);
            } catch (err) {
                return reject(err);
            }
        });
    }
}

class SudoerLinux extends SudoerUnix {

    constructor(options={}) {
        super(options);
        this.binary = '/usr/bin/pkexec';
    }

    async exec(command, options={}) {
        return new Promise(async (resolve, reject) => {
            if (options.env instanceof Object && !options.env.DISPLAY) {
                // Force DISPLAY variable with default value which is required for UI dialog
                options.env = Object.assign(options.env, {DISPLAY: ':0'});
            }
            let flags = '--disable-internal-agent';
            command = `${this.binary} ${flags} ${command}`;
            try {
                let result = await exec(command, options);
                return resolve(result);
            } catch (err) {
                return reject(err);
            }
        });
    }

    async spawn(command, args, options={}) {
        return new Promise(async (resolve, reject) => {
            if (options.env instanceof Object && !options.env.DISPLAY) {
                // Force DISPLAY variable with default value which is required for UI dialog
                options.env = Object.assign(options.env, {DISPLAY: ':0'});
            }
            let sudoArgs = ['--disable-internal-agent'];
            sudoArgs.push(command);
            sudoArgs.push(args);
            try {
                let cp = spawn(this.binary, sudoArgs, options);
                return resolve(cp);
            } catch (err) {
                return reject(err);
            }
        });
    }
}

class SudoerWin32 extends Sudoer {

    constructor(options={}) {
        super(options);
        this.binary = null;
    }

    async writeBatch(command, args, options) {
        let tmpDir = (await exec('echo %temp%'))
                .stdout.toString()
                .replace(/\r\n$/, ''),
            tmpBatchFile = `${tmpDir}\\batch-${Math.random()}.bat`,
            tmpOutputFile = `${tmpDir}\\output-${Math.random()}`,
            env = this.joinEnv(options),
            batch = `setlocal enabledelayedexpansion\r\n`;
        if (env.length) {
            batch += `set ${env.join('\r\nset ')}\r\n`;
        }
        if (args && args.length) {
            batch += `${command} ${args.join(' ')}`;
        } else {
            batch += command;
        }
        await writeFile(tmpBatchFile, `${batch} > ${tmpOutputFile} 2>&1`);
        await writeFile(tmpOutputFile, '');
        return {
            batch: tmpBatchFile, output: tmpOutputFile
        };
    }

    async watchOutput(cp) {
        let output = await readFile(cp.files.output);
        // If we have process then emit watched and stored data to stdout
        cp.stdout.emit('data', output);
        let watcher = watchFile(
            cp.files.output, {persistent: true, interval: 1},
            () => {
                let stream = createReadStream(
                        cp.files.output,
                        {start: watcher.last}
                    ),
                    size = 0;
                stream.on('data', (data) => {
                    size += data.length;
                    if (cp) { cp.stdout.emit('data', data); }
                });
                stream.on('close', () => {
                    cp.last += size;
                });
            }
        );
        cp.last = output.length;
        cp.on('exit', () => {
            this.clean(cp);
        });
        return cp;
    }

    async exec(command, options={}) {
        let files, output;
        return new Promise(async (resolve, reject) => {
            try {
                files = await this.writeBatch(command, [], options);
                command = `powershell -Command "Start-Process cmd -Verb RunAs -WindowStyle hidden -Wait -ArgumentList '/c ${files.batch}'"`;
                // No need to wait exec output because output is redirected to temporary file
                await exec(command, options);
                // Read entire output from redirected file on process exit
                output = await readFile(files.output);
                return resolve(output);
            } catch (err) {
                return reject(err);
            }
        });
    }

    async spawn(command, args, options={}) {
        let files = await this.writeBatch(command, args, options);
        let sudoArgs = ['-Command', `"Start-Process cmd -Verb RunAs -WindowStyle hidden -Wait -ArgumentList '/c ${files.batch}'"`];
        let cp = spawn('powershell', sudoArgs, options, {wait: false});
        cp.files = files;
        await this.watchOutput(cp);
        return cp;
    }

    clean (cp) {
        unwatchFile(cp.files.output);
        unlink(cp.files.batch);
        unlink(cp.files.output);
    }
}

export {SudoerDarwin, SudoerLinux, SudoerWin32};
